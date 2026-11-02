import type { ProjectScoreSummary } from '@shared/domain'
import type { AllPageRow, AllPagesData } from '@shared/ipc'
import { searchesLeft as keySearchesLeft } from '../../connection-status'
import type { SqliteDatabase } from '../../storage/database'
import { listPageMarketSchedules } from '../../storage/pages'
import { listMarkets, readProjectProfile } from '../../storage/project-profile'
import { usageMonth } from '../../keys/present'
import { withCountedSearches } from '../../storage/key-usage'
import { listApiKeys } from '../../storage/records'
import { loadProjectPageScores } from '../checks/glance'
import { pageHistoryByPage } from '../page-changes'
import type { AllPagesPass } from './pass'
import { readMemberships } from './structure'

/** Same as `ProjectDetail.trackedPageCount`: set up, tracked, or paused. */
const WORKING = new Set(['setting_up', 'tracked', 'paused'])

/**
 * `allpages:list` (FR-20.1, FR-20.2, FR-20.7). Every found page with its
 * default-market score, change, page-cited count, citations and schedule.
 * The numbers come from the same Results loads the page screens draw, so they
 * match Results (NFR-14). Each table is read once for the whole project.
 */
export function loadAllPages(pass: AllPagesPass): AllPagesData {
  const { storage, project, db } = pass
  const scores = loadProjectPageScores(storage, project, db, pass.scorePass, true)
  const memberships = readMemberships(db)
  const enabled = enabledPromptCounts(db)
  const marketSchedules = listPageMarketSchedules(db)
  const scoreById = new Map(scores.pages.map((page) => [page.pageId, page]))
  const history = pageHistoryByPage(db)
  const rows = scores.listed.map((page): AllPageRow => {
    const score = scoreById.get(page.id)
    const run = scores.results.get(page.id)?.run ?? null
    const read = history.get(page.id)
    return {
      id: page.id,
      // `listed` holds pages only (topics are scored apart).
      url: page.url ?? '',
      title: page.title,
      label: page.label,
      folder: page.folder,
      status: page.status,
      setupStep: page.setupStep,
      pinned: page.pinned,
      intervalDays: page.intervalDays,
      samples: page.samples,
      promptCount: enabled.get(page.id) ?? page.promptCount,
      defaultMarketId: page.defaultMarketId,
      marketIds: (marketSchedules.get(page.id) ?? []).map((market) => market.marketId),
      score: page.score,
      change: score?.change ?? null,
      pageCited: run?.pageCited ?? null,
      aioPrompts: run?.promptsWithAio ?? null,
      citations: run?.citationsThisPage ?? null,
      lastCheckedAt: score?.lastCheckedAt ?? null,
      nextCheckAt: score?.nextCheckAt ?? null,
      runId: run?.runId ?? null,
      clusters: memberships.clusters === null ? null : (memberships.clusters.get(page.id) ?? []),
      groups: memberships.groups === null ? null : (memberships.groups.get(page.id) ?? []),
      publishedAt: read?.publishedAt ?? null,
      modifiedAt: read?.modifiedAt ?? null,
      lastReadAt: read?.readAt ?? null,
      unloggedChanges: read?.unlogged ?? 0
    }
  })
  const profile = readProjectProfile(db)
  return {
    projectId: project.id,
    domain: project.domain,
    foundPageCount: rows.length,
    trackedPageCount: rows.filter((row) => WORKING.has(row.status)).length,
    markets: listMarkets(db),
    defaultMarketId: profile?.market?.id ?? null,
    summary: scores.summary,
    searchesLeft: searchesLeftFor(pass, scores.summary),
    groups: memberships.groupList,
    rows
  }
}

/** The project cap's remainder or the keys' remainder, whichever is lower. */
export function searchesLeftFor(
  pass: Pick<AllPagesPass, 'storage'> & { now?: Date },
  budget: Pick<ProjectScoreSummary, 'searchesUsed' | 'searchCap'>
): number | null {
  const db = pass.storage.db
  const fromKeys = keySearchesLeft(
    withCountedSearches(db, listApiKeys(db), usageMonth(pass.now ?? new Date()))
  )
  const cap = budget.searchCap
  const fromCap = cap === null ? null : Math.max(0, cap - budget.searchesUsed)
  if (fromKeys === null) return fromCap
  if (fromCap === null) return fromKeys
  return Math.min(fromKeys, fromCap)
}

/** Enabled prompts in each page's active set, in one query. */
/**
 * Page or topic id → enabled prompts of its active set that are topic keywords
 * (`topic_prompts.kind = 'keyword'`): short searches, counted apart from questions.
 */
export function enabledKeywordCounts(db: SqliteDatabase): Map<string, number> {
  const rows = db
    .prepare<unknown[], { page_id: string; keywords: number }>(
      `SELECT prompt_sets.page_id AS page_id, COUNT(prompts.id) AS keywords
         FROM prompt_sets
         JOIN prompts ON prompts.prompt_set_id = prompt_sets.id AND prompts.enabled = 1
         JOIN topic_prompts ON topic_prompts.prompt_id = prompts.id
                           AND topic_prompts.kind = 'keyword'
        WHERE prompt_sets.is_active = 1
        GROUP BY prompt_sets.page_id`
    )
    .all()
  return new Map(rows.map((row) => [row.page_id, row.keywords]))
}

export function enabledPromptCounts(db: SqliteDatabase): Map<string, number> {
  const rows = db
    .prepare<unknown[], { page_id: string; prompts: number }>(
      `SELECT prompt_sets.page_id AS page_id, COUNT(prompts.id) AS prompts
         FROM prompt_sets
         JOIN prompts ON prompts.prompt_set_id = prompt_sets.id AND prompts.enabled = 1
        WHERE prompt_sets.is_active = 1
        GROUP BY prompt_sets.page_id`
    )
    .all()
  return new Map(rows.map((row) => [row.page_id, row.prompts]))
}
