import type { PageSummary } from '@shared/domain'
import type {
  GoogleQuestions,
  PageIdRequest,
  ProjectIdRequest,
  QuestionTarget,
  QuestionTargets
} from '@shared/ipc'
import { listStoredCheckRuns } from '../storage/check-records'
import { listPageMarkets, listPageMarketSchedules, listPagesOfKind } from '../storage/pages'
import { listMarkets } from '../storage/project-profile'
import { searchesLeftFor } from '../topics/drafts'
import { enabledKeywordCounts, enabledPromptCounts } from './allpages/rows'
import { scheduledNextChecks, scorePass } from './checks/glance'
import { seenOnGoogle } from './checks/google-search'
import { filterFor, isFullRun } from './checks/results'
import type { EngineHost } from './host'
import { requirePage } from './page-access'
import { withProject } from './project-db'

/** `prompts:addTargets`. Reads saved data only. */
export function questionTargets(
  host: EngineHost,
  request: ProjectIdRequest
): Promise<QuestionTargets> {
  return withProject(host, request.projectId, 'prompts:addTargets', (opened) => {
    const { db, project } = opened
    const now = host.now()
    const counts = enabledPromptCounts(db)
    const keywords = enabledKeywordCounts(db)
    const markets = listPageMarketSchedules(db)
    const next = scheduledNextChecks(scorePass(host.storage, now, systemTimeZone()), project.id)
    const toTarget = (page: PageSummary, topic: boolean): QuestionTarget => ({
      id: page.id,
      kind: topic ? 'topic' : 'page',
      name: (topic ? page.title : (page.label ?? page.title)) ?? page.url ?? page.id,
      url: page.url,
      status: page.status,
      questions: counts.get(page.id) ?? 0,
      keywords: keywords.get(page.id) ?? 0,
      samples: page.samples,
      marketIds: (markets.get(page.id) ?? []).map((market) => market.marketId),
      nextCheckAt: next.get(page.id) ?? null,
      intervalDays: page.intervalDays
    })
    const listed = (kind: 'page' | 'topic'): QuestionTarget[] =>
      listPagesOfKind(db, project.id, kind)
        .filter((page) => page.status !== 'removed')
        .map((page) => toTarget(page, kind === 'topic'))
    return {
      projectId: project.id,
      markets: listMarkets(db),
      searchesLeft: searchesLeftFor(host.storage, db, project.id, now),
      targets: [...listed('page'), ...listed('topic')]
    }
  })
}

/**
 * `prompts:googleQuestions`: "Seen on Google" in Add questions, from the latest full
 * check of the page or topic in each of its markets. Reads saved data only.
 */
export function googleQuestions(
  host: EngineHost,
  request: PageIdRequest
): Promise<GoogleQuestions> {
  return withProject(host, request.projectId, 'prompts:googleQuestions', (opened) => {
    const { db, project } = opened
    const page = requirePage(db, request.pageId, project.id, 'prompts:googleQuestions')
    const runIds = listPageMarkets(db, page.id).flatMap((market) => {
      const latest = listStoredCheckRuns(db, filterFor(project.id, page.id, market.marketId))
        .filter(isFullRun)
        .at(-1)
      return latest === undefined ? [] : [latest.id]
    })
    return { pageId: page.id, questions: seenOnGoogle(db, runIds) }
  })
}

function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}
