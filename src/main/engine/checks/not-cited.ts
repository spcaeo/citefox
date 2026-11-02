import type { NotCitedList, NotCitedMarket, NotCitedPage, NotCitedRequest } from '@shared/ipc'
import { listStoredCheckRuns, type StoredCheckRun } from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { getPage, listPageMarkets } from '../../storage/pages'
import { nextPromptIds } from '../../storage/prompt-lineage'
import { getLatestPromptSet } from '../../storage/prompt-set-records'
import { readProjectProfile } from '../../storage/project-profile'
import { runPromptRows } from './results'

/** Pages per runs query, so a 2,000-page scope stays under SQLite's bound-value limit. */
const CHUNK = 400
/** Prompt-set versions followed forward from a checked question to the current one. */
const MAX_LINEAGE_STEPS = 50

/**
 * `checks:notCited`: per page, the questions whose last result in the asked
 * markets was anything but "cites this page", together and per market (a
 * question cited in the US but not in the UK is listed for the UK only, so
 * Check now never re-checks it where it is cited). The last result is the latest
 * full check, then any later follow-up of the same question set (a follow-up
 * that got a question cited takes it off the list). Ids are mapped forward to
 * the page's current question set, so `checks:start` can take them as
 * `promptIds`; a question removed since is left out.
 */
export function loadNotCited(db: SqliteDatabase, request: NotCitedRequest): NotCitedList {
  const brands = readProjectProfile(db)?.brandNames ?? []
  const wanted = request.marketIds === null ? null : new Set(request.marketIds)
  const pageIds = request.pageIds.filter((id) => getPage(db, id, request.projectId) !== null)
  const runsByPage = new Map<string, StoredCheckRun[]>()
  for (let at = 0; at < pageIds.length; at += CHUNK) {
    const runs = listStoredCheckRuns(db, {
      projectId: request.projectId,
      pageIds: pageIds.slice(at, at + CHUNK),
      marketId: null,
      from: null,
      to: null,
      runId: null,
      promptId: null
    })
    for (const run of runs) {
      if (run.status !== 'finished') continue
      const list = runsByPage.get(run.pageId) ?? []
      list.push(run)
      runsByPage.set(run.pageId, list)
    }
  }

  const pages: NotCitedPage[] = []
  for (const pageId of pageIds) {
    const runs = runsByPage.get(pageId) ?? []
    const markets = listPageMarkets(db, pageId)
      .map((market) => market.marketId)
      .filter((id) => wanted === null || wanted.has(id))
    const current = getLatestPromptSet(db, pageId, brands)?.prompts ?? []
    const currentIds = new Set(current.map((prompt) => prompt.id))
    const inOrder = (ids: ReadonlySet<string>): string[] =>
      current.filter((prompt) => ids.has(prompt.id)).map((prompt) => prompt.id)
    const all = new Set<string>()
    const byMarket: NotCitedMarket[] = []
    let checked = false
    for (const marketId of markets) {
      const statuses = lastStatuses(
        db,
        request.projectId,
        runs.filter((run) => run.marketId === marketId)
      )
      if (statuses === null) continue
      checked = true
      const mapped = new Set<string>()
      for (const [promptId, cited] of statuses) {
        if (cited) continue
        const id = currentIdOf(db, promptId, currentIds)
        if (id !== null) mapped.add(id)
      }
      if (mapped.size === 0) continue
      for (const id of mapped) all.add(id)
      byMarket.push({ marketId, promptIds: inOrder(mapped) })
    }
    pages.push({ pageId, promptIds: inOrder(all), markets: byMarket, checked })
  }
  return { pages }
}

/**
 * Prompt id → cited, from the latest full run and the follow-ups after it on
 * the same question set. Null when the market has no full run.
 */
function lastStatuses(
  db: SqliteDatabase,
  projectId: string,
  runs: readonly StoredCheckRun[]
): Map<string, boolean> | null {
  const full = runs.filter((run) => !run.partial).at(-1)
  if (full === undefined) return null
  const statuses = new Map<string, boolean>()
  const later = runs.filter(
    (run) => run.partial && run.promptSetId === full.promptSetId && run.startedAt >= full.startedAt
  )
  for (const run of [full, ...later]) {
    for (const row of runPromptRows(db, projectId, run)) {
      statuses.set(row.promptId, row.status === 'page_cited')
    }
  }
  return statuses
}

/** The id `promptId` carries in the current set, following saved versions forward. */
function currentIdOf(
  db: SqliteDatabase,
  promptId: string,
  currentIds: ReadonlySet<string>
): string | null {
  let id: string | undefined = promptId
  for (let step = 0; id !== undefined && step < MAX_LINEAGE_STEPS; step += 1) {
    if (currentIds.has(id)) return id
    id = nextPromptIds(db, id).at(-1)
  }
  return null
}
