import { needsBacklinks, backlinkPriority, LOOP_STEPS, type LoopFacts } from '@shared/fix-loop'
import type { MetricsResult } from '@shared/metrics'
import {
  answerShape,
  overviewShape,
  suggestAnchor,
  type AnswerShape,
  type BacklinkAsk,
  type OutlineLine,
  type PageChangeNote,
  type PageDates,
  type ReportExtras
} from '@shared/report/review/extras'
import { sameTargetPage } from '@shared/target-page'
import { buildLedger } from '../../engine/fix-loop/ledger'
import { loadAnswerExtras } from './answer-extras'
import type { SqliteDatabase } from '../../storage/database'
import { enabledPromptCounts } from '../../engine/allpages/rows'
import { readActivePrompts } from '../../questions/reads'
import { latestPageRead, listPageChanges } from '../../storage/page-history'
import { listPages } from '../../storage/pages'
import type { ProjectRecord } from '../../storage/records'
import { getReportBranding } from '../../storage/report-branding'
import { loadChangedExtras } from './extras-changed'
import { loadAiPages, loadQuestionTargets, loadSiteKinds } from './extras-compete'
import { loadVisibilityExtras } from './visibility-extras'

/**
 * A ready report's extras (src/shared/report/review/extras.ts) from the project
 * database: answer shapes from the stored answer text of every row the metrics name,
 * the backlink ask list and the round's owners from the changes ledger, the latest page
 * change of each page that lost ground, and the "Prepared for" line. Read-only.
 */
export function loadReportExtras(
  db: SqliteDatabase,
  project: ProjectRecord,
  metrics: MetricsResult,
  now: Date
): ReportExtras {
  const ledger = buildLedger(db, project, now.toISOString())
  const anchors = new Map(ledger.anchors.map((item) => [item.pageId, item.text]))
  const backlinks: BacklinkAsk[] = ledger.rows
    .filter((row) => row.latestOnPage)
    .flatMap((row) => {
      const facts: LoopFacts = {
        status: row.status,
        daysLive: row.daysLive,
        index: row.index?.state ?? null
      }
      if (!needsBacklinks(facts)) return []
      const saved = anchors.get(row.pageId) ?? null
      return [
        {
          url: row.url,
          title: row.title,
          priority: backlinkPriority(facts),
          reason:
            row.status === 'lost'
              ? 'Lost ground'
              : row.status === 'not_cited'
                ? 'Not cited yet'
                : 'Not indexed',
          anchor: saved ?? suggestAnchor(row.url, row.title),
          anchorSaved: saved !== null,
          daysLive: row.daysLive
        }
      ]
    })
    .sort(
      (a, b) =>
        (a.priority === b.priority ? 0 : a.priority === 'first' ? -1 : 1) ||
        (b.daysLive ?? -Infinity) - (a.daysLive ?? -Infinity)
    )
  return {
    shapes: loadAnswerShapes(db, metrics),
    backlinks,
    changes: changesOf(db, project, metrics),
    owners: LOOP_STEPS.map((step) => ({ step, owner: ledger.owners[step] })),
    nextCheckAt: ledger.schedule.paused ? null : ledger.schedule.nextCheckAt,
    intervalDays: ledger.schedule.paused ? null : ledger.schedule.intervalDays,
    branding: getReportBranding(db),
    ...loadChangedExtras(db, project, metrics),
    ...publishedFacts(db, project, metrics),
    questionTargets: loadQuestionTargets(db, project, metrics),
    siteKinds: loadSiteKinds(db, metrics),
    aiPages: loadAiPages(db, metrics),
    visibility: loadVisibilityExtras(db, project, metrics),
    answers: loadAnswerExtras(db, metrics)
  }
}

/**
 * For each published page: the questions written for it (topic questions targeting it,
 * plus a tracked page's own questions) and the dates it states (its newest read).
 */
function publishedFacts(
  db: SqliteDatabase,
  project: ProjectRecord,
  metrics: MetricsResult
): { questionsFor: Record<string, number>; pageDates: Record<string, PageDates> } {
  const urls = metrics.pages.published.ids
  if (urls.length === 0) return { questionsFor: {}, pageDates: {} }
  const pages = listPages(db, project.id).filter(
    (page) => page.url !== null && page.kind !== 'topic' && page.status !== 'removed'
  )
  const prompts = readActivePrompts(db, metrics.marketId).filter((prompt) => prompt.enabled)
  const counts = enabledPromptCounts(db)
  const questionsFor: Record<string, number> = {}
  const pageDates: Record<string, PageDates> = {}
  for (const url of urls) {
    const page = pages.find((item) => sameTargetPage(item.url, url))
    const targeted = prompts.filter(
      (prompt) => prompt.targetUrl !== null && sameTargetPage(prompt.targetUrl, url)
    ).length
    questionsFor[url] = targeted + (page === undefined ? 0 : (counts.get(page.id) ?? 0))
    const read = page === undefined ? null : latestPageRead(db, page.id)
    if (read !== null && (read.publishedAt !== null || read.modifiedAt !== null)) {
      pageDates[url] = { publishedAt: read.publishedAt, modifiedAt: read.modifiedAt }
    }
  }
  return { questionsFor, pageDates }
}

/** A snapshot's h2 and h3 headings, in page order (at most 40). */
function outlineOf(db: SqliteDatabase, snapshotId: string): OutlineLine[] {
  const row = db
    .prepare<[string], { outline_json: string }>('SELECT outline_json FROM snapshots WHERE id = ?')
    .get(snapshotId)
  if (row === undefined) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(row.outline_json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: OutlineLine[] = []
  for (const entry of parsed) {
    const record = entry as { level?: unknown; text?: unknown } | null
    const level = Number(String(record?.level ?? '').replace(/\D/g, ''))
    const text = typeof record?.text === 'string' ? record.text.trim() : ''
    if ((level === 2 || level === 3) && text.length > 0)
      out.push({ level, text: text.slice(0, 160) })
    if (out.length >= 40) break
  }
  return out
}

/** `engine:runId:promptId` → its stored answer text's shape. */
export function loadAnswerShapes(
  db: SqliteDatabase,
  metrics: MetricsResult
): Record<string, AnswerShape> {
  const google = db.prepare<[string, string], { text: string | null; raw: string | null }>(
    `SELECT aio_text AS text, raw_aio_json AS raw FROM serp_results
     WHERE run_id = ? AND prompt_id = ? AND (aio_text IS NOT NULL OR raw_aio_json IS NOT NULL)
     ORDER BY sample_no LIMIT 1`
  )
  const engine = db.prepare<[string, string, string], { text: string | null }>(
    `SELECT COALESCE(answer_markdown, answer_text) AS text FROM engine_answers
     WHERE run_id = ? AND prompt_id = ? AND engine = ? ORDER BY sample_no LIMIT 1`
  )
  const out: Record<string, AnswerShape> = {}
  for (const row of Object.values(metrics.rows)) {
    if (row.engine === 'all') continue
    const parts = row.id.split(':')
    if (parts.length < 3) continue
    const runId = parts[1] ?? ''
    const promptId = parts.slice(2).join(':')
    let shape: AnswerShape | null
    if (row.engine === 'google_aio') {
      const stored = google.get(runId, promptId)
      shape = stored === undefined ? null : overviewShape(stored.raw, stored.text)
    } else {
      shape = answerShape(engine.get(runId, promptId, row.engine)?.text)
    }
    if (shape !== null) out[row.id] = shape
  }
  return out
}

/** The newest change CiteFox saw on each published page, by address. */
function changesOf(
  db: SqliteDatabase,
  project: ProjectRecord,
  metrics: MetricsResult
): Record<string, PageChangeNote> {
  const wanted = metrics.pages.rows.filter((row) => row.status === 'lost')
  if (wanted.length === 0) return {}
  const pages = listPages(db, project.id).filter((page) => page.url !== null)
  const words = db.prepare<[string], { word_count: number }>(
    `SELECT word_count FROM snapshots WHERE id = ?`
  )
  const out: Record<string, PageChangeNote> = {}
  for (const row of wanted) {
    const page = pages.find((item) => sameTargetPage(item.url, row.url))
    if (page === undefined) continue
    const change = listPageChanges(db, page.id, 20).find((item) => item.dismissedAt === null)
    if (change === undefined) continue
    out[row.url] = {
      url: row.url,
      changedAt: change.changedAt,
      sectionsAdded: change.counts.sectionsAdded,
      sectionsRemoved: change.counts.sectionsRemoved,
      headingsChanged: change.counts.headingsChanged,
      textChanged: change.counts.textChanged,
      sections: change.sections,
      wordsBefore: words.get(change.fromSnapshotId)?.word_count ?? null,
      wordsAfter: words.get(change.toSnapshotId)?.word_count ?? null,
      outlineBefore: outlineOf(db, change.fromSnapshotId),
      outlineAfter: outlineOf(db, change.toSnapshotId)
    }
  }
  return out
}
