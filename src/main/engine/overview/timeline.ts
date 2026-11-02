import type { PageSummary, PromptCheckRow } from '@shared/domain'
import type { SqliteDatabase } from '../../storage/database'
import { listStoredMarketPrompts, type StoredCheckRun } from '../../storage/check-records'
import { listPageMarkets } from '../../storage/pages'
import { stableKeys, topicPromptMetas } from '../../topics/results'
import { checkCompetitors, type CompetitorLists } from '../checks/competitor-match'
import { liveCheckOf, orderAt, readableRuns } from '../checks/live-runs'
import { isFullRun, runPromptRows } from '../checks/results'
import type { LiveCheck } from '@shared/ipc'

/**
 * Each tracked page's and topic's question outcomes over time, read the way
 * their own screens read them:
 *
 * - a page shows its latest full check (Results): the state at a moment is the
 *   rows of the newest full run finished by then;
 * - a topic keeps each question's latest outcome across its runs, batches
 *   included (Topic results `currentOutcomes`), for the active, enabled questions.
 *
 * A question keeps one key across prompt-set versions: a topic's stable key, or
 * the first prompt id of a page prompt's lineage.
 *
 * A check still running, or one that stopped part-way, adds the questions it has
 * scored on top (`live-runs.ts`): the latest answer per question counts at once.
 */

/** One question's outcome in one check. */
export interface QuestionOutcome {
  /** `pageId|key`, unique across the project. */
  key: string
  pageId: string
  /** The prompt id in the run the outcome comes from. */
  promptId: string
  runId: string
  marketId: string
  /** ISO-8601 UTC finish of that run. */
  checkedAt: string
  /** The question as the active set words it (topics), else as that run did. */
  text: string
  row: PromptCheckRow
}

export interface SourceTimeline {
  page: PageSummary
  kind: 'page' | 'topic'
  /** The market read. Null when the page has no default market and none was asked for. */
  marketId: string | null
  /** Markets the page or topic is checked in (Check now runs them all). */
  marketCount: number
  enabledPrompts: number
  competitors: CompetitorLists
  /** Finished checks read, oldest first. */
  runs: readonly StoredCheckRun[]
  /** The check running now, or the newest one if it stopped part-way. Null otherwise. */
  live: LiveCheck | null
  /** Outcomes by key as of `at` (ISO-8601 UTC). Null when nothing had been checked by then. */
  stateAt: (at: string) => Map<string, QuestionOutcome> | null
  /**
   * Outcomes as of just before the latest check: the previous full check of a page, a
   * topic's outcomes from every run but the latest. Null with fewer than two checks.
   */
  stateBefore: () => Map<string, QuestionOutcome> | null
  /**
   * Questions a state of this source set out to measure, for the 90% coverage rule
   * (`coverageComparable`): a page's enabled prompts in the run the state comes from; a
   * topic's questions searched so far (its batches check a few questions at a time, and a
   * question added since has no result yet), so only failed searches thin a topic.
   */
  planned: (state: ReadonlyMap<string, QuestionOutcome>) => number
}

const WORKING = new Set(['tracked', 'setting_up', 'paused'])

/** Tracked, setting-up and paused pages and topics. */
export function isWorkingPage(page: PageSummary): boolean {
  return WORKING.has(page.status)
}

export function buildTimeline(
  db: SqliteDatabase,
  input: {
    projectId: string
    page: PageSummary
    /** Null: the page's default market. */
    marketId: string | null
    enabledPrompts: number
    lineage: ReadonlyMap<string, string>
  }
): SourceTimeline | null {
  const { page } = input
  const kind = page.kind === 'topic' ? 'topic' : 'page'
  const markets = listPageMarkets(db, page.id).map((market) => market.marketId)
  if (input.marketId !== null && !markets.includes(input.marketId)) return null
  const marketId = input.marketId ?? page.defaultMarketId
  const competitors = checkCompetitors(db, { id: page.id, kind })
  const base = {
    page,
    kind,
    marketId,
    marketCount: markets.length,
    enabledPrompts: input.enabledPrompts,
    competitors
  } as const
  if (marketId === null) {
    return {
      ...base,
      runs: [],
      live: null,
      stateAt: () => null,
      stateBefore: () => null,
      planned: () => 0
    }
  }
  const readable = readableRuns(db, { projectId: input.projectId, pageId: page.id, marketId })
  const runs = readable
    .filter((item) => item.state === 'finished' && item.run.finishedAt !== null)
    .map((item) => item.run)
    .filter((run) => kind === 'topic' || isFullRun(run))
    .sort((left, right) => (left.finishedAt ?? '').localeCompare(right.finishedAt ?? ''))
  const liveRuns = readable.filter((item) => item.state !== 'finished').map((item) => item.run)
  const newest = readable.at(-1)
  const live = newest === undefined ? null : (liveCheckOf(db, newest)?.live ?? null)
  /** Live runs that count at `at`, newer than `after` (a page's full check then). */
  const liveBy = (at: string, after: string | null): StoredCheckRun[] =>
    liveRuns.filter((run) => orderAt(run) <= at && (after === null || orderAt(run) > after))
  const rowsCache = new Map<string, PromptCheckRow[]>()
  const rowsOf = (run: StoredCheckRun): PromptCheckRow[] => {
    const cached = rowsCache.get(run.id)
    if (cached !== undefined) return cached
    const rows = runPromptRows(db, input.projectId, run)
    rowsCache.set(run.id, rows)
    return rows
  }
  const outcome = (
    run: StoredCheckRun,
    row: PromptCheckRow,
    key: string,
    text: string
  ): QuestionOutcome => ({
    key: `${page.id}|${key}`,
    pageId: page.id,
    promptId: row.promptId,
    runId: run.id,
    marketId,
    checkedAt: run.finishedAt ?? run.startedAt,
    text,
    row
  })

  if (kind === 'page') {
    const pageState = (
      run: StoredCheckRun | undefined,
      overlays: readonly StoredCheckRun[] = []
    ): Map<string, QuestionOutcome> | null => {
      if (run === undefined && overlays.length === 0) return null
      const state = new Map<string, QuestionOutcome>()
      for (const read of run === undefined ? overlays : [run, ...overlays]) {
        for (const row of rowsOf(read)) {
          const key = lineageRoot(input.lineage, row.promptId)
          const item = outcome(read, row, key, row.text)
          state.set(item.key, item)
        }
      }
      return state
    }
    const plannedByRun = new Map<string, number>()
    const plannedOf = (runId: string): number => {
      const cached = plannedByRun.get(runId)
      if (cached !== undefined) return cached
      const run = [...runs, ...liveRuns].find((item) => item.id === runId)
      const count =
        run === undefined
          ? 0
          : listStoredMarketPrompts(db, run.promptSetId, marketId).filter(
              (prompt) => prompt.enabled
            ).length
      plannedByRun.set(runId, count)
      return count
    }
    return {
      ...base,
      runs,
      live,
      stateAt: (at) => {
        const full = runs.filter((item) => (item.finishedAt ?? '') <= at).at(-1)
        return pageState(full, liveBy(at, full?.finishedAt ?? null))
      },
      stateBefore: () => pageState(runs.at(-2)),
      planned: (state) => {
        for (const item of state.values()) {
          if (item.pageId === page.id) return plannedOf(item.runId)
        }
        return 0
      }
    }
  }

  const keys = stableKeys(db, page.id)
  const active = new Map(
    topicPromptMetas(db, page.id, marketId).map((meta) => [meta.stableKey, meta.text])
  )
  const topicState = (upTo: readonly StoredCheckRun[]): Map<string, QuestionOutcome> | null => {
    if (upTo.length === 0) return null
    const state = new Map<string, QuestionOutcome>()
    for (const run of upTo) {
      for (const row of rowsOf(run)) {
        const key = keys.get(row.promptId)
        if (key === undefined) continue
        const text = active.get(key)
        if (text === undefined) continue
        const item = outcome(run, row, key, text)
        state.set(item.key, item)
      }
    }
    return state
  }
  const ordered = [...runs, ...liveRuns].sort((a, b) => orderAt(a).localeCompare(orderAt(b)))
  return {
    ...base,
    runs,
    live,
    stateAt: (at) => topicState(ordered.filter((item) => orderAt(item) <= at)),
    stateBefore: () => topicState(runs.slice(0, -1)),
    planned: (state) => {
      let count = 0
      for (const item of state.values()) if (item.pageId === page.id) count += 1
      return count
    }
  }
}

/** Prompt id → the prompt it was carried from, for every page prompt (project migration 036). */
export function readLineage(db: SqliteDatabase): Map<string, string> {
  return new Map(
    db
      .prepare<unknown[], { prompt_id: string; previous_prompt_id: string }>(
        'SELECT prompt_id, previous_prompt_id FROM prompt_lineage'
      )
      .all()
      .map((row) => [row.prompt_id, row.previous_prompt_id])
  )
}

/** The first prompt of a lineage. Stops on a loop. */
export function lineageRoot(lineage: ReadonlyMap<string, string>, promptId: string): string {
  let current = promptId
  const seen = new Set<string>([current])
  for (;;) {
    const previous = lineage.get(current)
    if (previous === undefined || seen.has(previous)) return current
    seen.add(previous)
    current = previous
  }
}
