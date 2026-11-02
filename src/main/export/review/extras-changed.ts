import type { MetricsResult } from '@shared/metrics'
import type { BrandClaim, PageChangeNote, ReportExtras } from '@shared/report/review/extras'
import {
  ANSWER_SHAPE_LABELS,
  overviewHash,
  shapeFingerprint
} from '../../analytics/answer-shape/vocabulary'
import { getAnswerShapes } from '../../storage/answer-shapes'
import type { SqliteDatabase } from '../../storage/database'
import { listPageChanges } from '../../storage/page-history'
import { toPageEdit } from '../../storage/page-edits'
import { listPages } from '../../storage/pages'
import type { ProjectRecord } from '../../storage/records'
import { questionTargetPages } from '../../topics/question-targets'

/**
 * The What changed report's extras (src/shared/report/review/extras.ts): each row's
 * target pages, page history changes and saved page edits per page, and the stored
 * answer blocks of each Google AI Overview. Read-only; never calls CiteFox AI.
 */
export type ChangedExtras = Pick<
  ReportExtras,
  'targets' | 'pageChanges' | 'pageEdits' | 'blocks' | 'blockLabels' | 'claims'
>

/** `engine:runId:promptId` → `{ runId, promptId }`. */
function partsOf(rowId: string): { runId: string; promptId: string } | null {
  const parts = rowId.split(':')
  if (parts.length < 3) return null
  return { runId: parts[1] ?? '', promptId: parts.slice(2).join(':') }
}

export function loadChangedExtras(
  db: SqliteDatabase,
  project: ProjectRecord,
  metrics: MetricsResult
): ChangedExtras {
  const pages = listPages(db, project.id)
  return {
    targets: targetsOf(db, pages, metrics),
    pageChanges: pageChangesOf(db, pages),
    pageEdits: pageEditsOf(db),
    blocks: blocksOf(db, metrics),
    blockLabels: ANSWER_SHAPE_LABELS,
    claims: claimsOf(db, metrics)
  }
}

const POLARITIES = new Set(['positive', 'neutral', 'negative'])

/**
 * The claims about your own brand in each Google AI Overview row (successful readings
 * only), by metrics row id. A claim read from several samples of one question counts once.
 */
function claimsOf(db: SqliteDatabase, metrics: MetricsResult): Record<string, BrandClaim[]> {
  const runs = [
    ...new Set(
      Object.values(metrics.rows)
        .filter((row) => row.engine === 'google_aio')
        .map((row) => row.checkId)
    )
  ]
  const out: Record<string, BrandClaim[]> = {}
  if (runs.length === 0) return out
  let rows: {
    run_id: string
    prompt_id: string
    polarity: string
    sentence: string
    theme: string
  }[]
  try {
    rows = db
      .prepare<unknown[], (typeof rows)[number]>(
        `SELECT s.run_id, s.prompt_id, c.polarity, c.sentence, c.theme
           FROM claims c
           JOIN sentiment_reads r ON r.id = c.read_id
           JOIN serp_results s ON s.id = c.serp_result_id
          WHERE c.is_own = 1 AND r.ok = 1 AND s.run_id IN (${runs.map(() => '?').join(', ')})
          ORDER BY r.read_at ASC, c.position ASC`
      )
      .all(...runs)
  } catch {
    // A project file written before brand sentiment: no claims.
    return out
  }
  for (const row of rows) {
    const id = `google_aio:${row.run_id}:${row.prompt_id}`
    if (metrics.rows[id] === undefined || !POLARITIES.has(row.polarity)) continue
    const list = (out[id] ??= [])
    if (list.some((claim) => claim.sentence === row.sentence)) continue
    list.push({
      polarity: row.polarity as BrandClaim['polarity'],
      sentence: row.sentence,
      theme: row.theme
    })
  }
  return out
}

function targetsOf(
  db: SqliteDatabase,
  pages: ReturnType<typeof listPages>,
  metrics: MetricsResult
): Record<string, string[]> {
  const urlOf = new Map(pages.map((page) => [page.id, page.url]))
  const byTopic = new Map<string, Map<string, readonly string[]>>()
  const out: Record<string, string[]> = {}
  for (const row of Object.values(metrics.rows)) {
    if (row.engine === 'all') continue
    const ids = partsOf(row.id)
    if (ids === null) continue
    if (row.sourceKind === 'page') {
      const url = urlOf.get(row.sourceId)
      if (url) out[row.id] = [url]
      continue
    }
    let topic = byTopic.get(row.sourceId)
    if (topic === undefined) {
      try {
        topic = questionTargetPages(db, row.sourceId)
      } catch {
        topic = new Map()
      }
      byTopic.set(row.sourceId, topic)
    }
    const list = topic.get(ids.promptId) ?? []
    if (list.length > 0) out[row.id] = [...list]
  }
  return out
}

function pageChangesOf(
  db: SqliteDatabase,
  pages: ReturnType<typeof listPages>
): Record<string, PageChangeNote[]> {
  const words = db.prepare<[string], { word_count: number }>(
    'SELECT word_count FROM snapshots WHERE id = ?'
  )
  const out: Record<string, PageChangeNote[]> = {}
  for (const page of pages) {
    if (page.url === null || page.status === 'removed') continue
    const list = listPageChanges(db, page.id, 10).filter((change) => change.dismissedAt === null)
    if (list.length === 0) continue
    out[page.url] = list.map((change) => ({
      url: page.url ?? '',
      changedAt: change.changedAt,
      sectionsAdded: change.counts.sectionsAdded,
      sectionsRemoved: change.counts.sectionsRemoved,
      headingsChanged: change.counts.headingsChanged,
      textChanged: change.counts.textChanged,
      sections: change.sections,
      wordsBefore: words.get(change.fromSnapshotId)?.word_count ?? null,
      wordsAfter: words.get(change.toSnapshotId)?.word_count ?? null
    }))
  }
  return out
}

function pageEditsOf(db: SqliteDatabase): Record<string, { changes: number; savedAt: string }> {
  const out: Record<string, { changes: number; savedAt: string }> = {}
  let rows: { edit_json: string }[]
  try {
    rows = db
      .prepare<unknown[], { edit_json: string }>(
        'SELECT edit_json FROM page_edits ORDER BY saved_at ASC'
      )
      .all()
  } catch {
    // A project file written before page edits: nothing saved.
    return out
  }
  for (const row of rows) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.edit_json)
    } catch {
      continue
    }
    const edit = toPageEdit(parsed)
    if (edit === null) continue
    out[edit.url] = { changes: edit.changes.length, savedAt: edit.savedAt }
  }
  return out
}

function blocksOf(db: SqliteDatabase, metrics: MetricsResult): Record<string, string[]> {
  const texts = new Map<string, string>()
  const read = db.prepare<[string, string], { text: string | null }>(
    `SELECT aio_text AS text FROM serp_results
     WHERE run_id = ? AND prompt_id = ? AND aio_text IS NOT NULL
     ORDER BY sample_no LIMIT 1`
  )
  for (const row of Object.values(metrics.rows)) {
    if (row.engine !== 'google_aio') continue
    const ids = partsOf(row.id)
    if (ids === null) continue
    const text = read.get(ids.runId, ids.promptId)?.text
    if (typeof text === 'string' && text.trim().length > 0) texts.set(row.id, text)
  }
  if (texts.size === 0) return {}
  let shapes: ReturnType<typeof getAnswerShapes>
  try {
    shapes = getAnswerShapes(
      db,
      [...texts.values()].map((text) => overviewHash(text))
    )
  } catch {
    // A project file written before the answer_shapes table: no blocks to compare.
    return {}
  }
  const out: Record<string, string[]> = {}
  for (const [rowId, text] of texts) {
    const shape = shapes.get(overviewHash(text))
    if (shape === undefined || shape.blocks.length === 0) continue
    out[rowId] = shapeFingerprint(shape.blocks)
  }
  return out
}
