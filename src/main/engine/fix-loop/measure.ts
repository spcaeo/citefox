import type { PageSummary, PromptCheckRow } from '@shared/domain'
import {
  citedTrend,
  citesOwnSite,
  citesPage,
  type FixControl,
  type FixMeasure,
  type FixQuestion,
  type FixQuestionCheck,
  type TrendSnapshot
} from '@shared/fix-verdict'
import { sameTargetPage } from '@shared/target-page'
import { listStoredCheckRuns, type StoredCheckRun } from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import type { FixFollowUpRecord } from '../../storage/fix-follow-ups'
import { listPages } from '../../storage/pages'
import { filterFor, isFullRun } from '../checks/results'
import { endOf, promptRowCache } from './runs'

/**
 * What a fix did, from stored checks only (no searches): each of its searches before
 * go-live and now, from whichever page or topic asks it, in the fix's market. The
 * verdict itself is `fixVerdict` (src/shared/fix-verdict.ts), read by main and the
 * renderer alike.
 *
 * - A search's "before" is the last finished check of its page or topic that ended
 *   before go-live and holds it; "now" is the latest one that started from go-live on
 *   (a follow-up's partial check counts: it asks exactly these searches).
 * - Untouched searches are the same pages' and topics' other searches, compared
 *   between the last full check before go-live and the latest full check since.
 */
export interface FixMeasureReader {
  measure(fix: FixFollowUpRecord): FixMeasure
  /** The page address a fix is about: its own, else its page's. Null for a bare topic. */
  urlOf(fix: FixFollowUpRecord): string | null
}

/** Checks of one page or topic a trend reads at most. */
const TREND_RUNS = 12

export function fixMeasureReader(db: SqliteDatabase, projectId: string): FixMeasureReader {
  const pages = new Map(listPages(db, projectId).map((page) => [page.id, page]))
  const rowsOf = promptRowCache(db, projectId)
  const runsCache = new Map<string, StoredCheckRun[]>()
  const owners = promptOwners(db)

  function runsOf(pageId: string, marketId: string): StoredCheckRun[] {
    const key = `${pageId}\0${marketId}`
    const cached = runsCache.get(key)
    if (cached !== undefined) return cached
    const runs = listStoredCheckRuns(db, filterFor(projectId, pageId, marketId)).filter(
      (run) => run.status === 'finished' && run.pageId === pageId && run.marketId === marketId
    )
    runsCache.set(key, runs)
    return runs
  }

  /** The fix's market on a source: the fix's own when the source was checked in it. */
  function marketFor(source: PageSummary, marketId: string): string {
    if (runsOf(source.id, marketId).length > 0 || source.defaultMarketId === null) return marketId
    return source.defaultMarketId
  }

  function urlOf(fix: FixFollowUpRecord): string | null {
    if (fix.url !== null) return fix.url
    const subject = pages.get(fix.pageId)
    return subject === undefined || subject.kind === 'topic' ? null : subject.url
  }

  function measure(fix: FixFollowUpRecord): FixMeasure {
    const url = urlOf(fix)
    const subject = pages.get(fix.pageId)
    const marketId =
      subject?.defaultMarketId && fix.marketIds.includes(subject.defaultMarketId)
        ? subject.defaultMarketId
        : (fix.marketIds[0] ?? subject?.defaultMarketId ?? null)
    const targeted = new Set(fix.promptIds)
    const bySource = new Map<string, string[]>()
    for (const promptId of fix.promptIds) {
      const owner = owners.get(promptId) ?? fix.pageId
      bySource.set(owner, [...(bySource.get(owner) ?? []), promptId])
    }
    const questions: FixQuestion[] = []
    const snapshots: TrendSnapshot[] = []
    const control = { questions: 0, citedBefore: 0, citedNow: 0 }
    let compared = false
    for (const [sourceId, promptIds] of bySource) {
      const source = pages.get(sourceId)
      if (source === undefined || marketId === null) {
        for (const promptId of promptIds)
          questions.push(unchecked(db, promptId, sourceId, marketId))
        continue
      }
      const market = marketFor(source, marketId)
      const runs = runsOf(source.id, market)
      const before = runs.filter((run) => endOf(run) < fix.goLiveAt)
      const after = runs.filter((run) => run.startedAt >= fix.goLiveAt)
      for (const promptId of promptIds) {
        const was = latestHolding(before, promptId)
        const now = latestHolding(after, promptId)
        const row = now?.row ?? was?.row ?? null
        questions.push({
          promptId,
          sourceId: source.id,
          sourceKind: source.kind === 'topic' ? 'topic' : 'page',
          sourceName: source.label ?? source.title ?? source.url ?? 'Untitled',
          marketId: market,
          label: row?.label ?? storedPrompt(db, promptId).label,
          text: row?.text ?? storedPrompt(db, promptId).text,
          before: was === null ? null : checkOf(was.run, was.row, url),
          now: now === null ? null : checkOf(now.run, now.row, url)
        })
      }
      // The trend: the last full check before go-live, then every check since.
      const start = before.filter(isFullRun).at(-1) ?? before.at(-1)
      for (const run of [...(start ? [start] : []), ...after].slice(-TREND_RUNS)) {
        const states = rowsOf(run)
          .filter((item) => targeted.has(item.promptId) && item.status !== 'error')
          .map((item) => [item.promptId, citesPage(item, url)] as const)
        if (states.length > 0) snapshots.push({ at: endOf(run), states })
      }
      // Untouched searches of this source, full check before → latest full check since.
      const fullBefore = before.filter(isFullRun).at(-1)
      const fullNow = after.filter(isFullRun).at(-1)
      if (fullBefore && fullNow) {
        compared = true
        const was = new Map(rowsOf(fullBefore).map((item) => [item.promptId, item]))
        for (const item of rowsOf(fullNow)) {
          const old = was.get(item.promptId)
          if (targeted.has(item.promptId) || old === undefined) continue
          if (item.status === 'error' || old.status === 'error') continue
          control.questions += 1
          if (citesOwnSite(old)) control.citedBefore += 1
          if (citesOwnSite(item)) control.citedNow += 1
        }
      }
    }
    // The order the fix lists them (a page fix: best odds first).
    const order = new Map(fix.promptIds.map((id, index) => [id, index]))
    questions.sort(
      (left, right) => (order.get(left.promptId) ?? 0) - (order.get(right.promptId) ?? 0)
    )
    return {
      url,
      questions,
      control: compared ? (control satisfies FixControl) : null,
      trend: citedTrend(snapshots)
    }
  }

  function latestHolding(
    runs: readonly StoredCheckRun[],
    promptId: string
  ): { run: StoredCheckRun; row: PromptCheckRow } | null {
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      const run = runs[index] as StoredCheckRun
      const row = rowsOf(run).find((item) => item.promptId === promptId)
      if (row !== undefined && row.status !== 'error') return { run, row }
    }
    return null
  }

  return { measure, urlOf }
}

function checkOf(run: StoredCheckRun, row: PromptCheckRow, url: string | null): FixQuestionCheck {
  const cited = citesPage(row, url)
  const reference =
    url === null ? undefined : row.references.find((item) => sameTargetPage(item.url, url))
  return {
    runId: run.id,
    checkedAt: endOf(run),
    cited,
    position: !cited ? null : (reference?.position ?? row.position)
  }
}

function unchecked(
  db: SqliteDatabase,
  promptId: string,
  sourceId: string,
  marketId: string | null
): FixQuestion {
  const stored = storedPrompt(db, promptId)
  return {
    promptId,
    sourceId,
    sourceKind: 'page',
    sourceName: '',
    marketId: marketId ?? '',
    label: stored.label,
    text: stored.text,
    before: null,
    now: null
  }
}

/** Which page or topic each prompt belongs to (its prompt set's page). */
function promptOwners(db: SqliteDatabase): Map<string, string> {
  const rows = db
    .prepare<unknown[], { id: string; page_id: string }>(
      `SELECT prompts.id, prompt_sets.page_id FROM prompts
       JOIN prompt_sets ON prompt_sets.id = prompts.prompt_set_id`
    )
    .all()
  return new Map(rows.map((row) => [row.id, row.page_id]))
}

function storedPrompt(db: SqliteDatabase, promptId: string): { label: string; text: string } {
  const row = db
    .prepare<unknown[], { label: string; text: string | null }>(
      `SELECT prompts.label,
              (SELECT text FROM prompt_variants WHERE prompt_id = prompts.id
               ORDER BY market_id ASC LIMIT 1) AS text
       FROM prompts WHERE prompts.id = ?`
    )
    .get(promptId)
  return { label: row?.label ?? 'Search no longer tracked', text: row?.text ?? '' }
}
