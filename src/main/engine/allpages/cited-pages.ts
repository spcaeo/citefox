import type { AioReference, PageSummary } from '@shared/domain'
import type {
  CitedOverviewRef,
  CitedPageRow,
  CitedPagesData,
  CitedQuestionRef,
  CitedWhose
} from '@shared/ipc'
import { bareDomain } from '@shared/own-site'
import { listPages } from '../../storage/pages'
import { readProjectProfile } from '../../storage/project-profile'
import { runBuiltPrompts } from '../checks/results'
import { AIO_STATUSES } from '../checks/score'
import { normalizeUrl } from '../checks/url'
import { competitorContext } from '../competitor-context'
import { pickRuns } from '../competitors/share'
import { siteId, siteOf, type SiteLens } from '../competitors/tally'
import type { AllPagesPass } from './pass'

/** The pages and topics whose latest checks count: the ones `allpages:citations` reviews. */
const COUNTED = new Set(['tracked', 'paused'])

const WHOSE: Readonly<Record<ReturnType<typeof siteOf>['kind'], CitedWhose>> = {
  you: 'yours',
  competitor: 'competitor',
  other: 'other'
}

interface Building {
  row: Omit<CitedPageRow, 'marketIds' | 'questions' | 'overviews'>
  markets: Set<string>
  questions: Map<string, CitedQuestionRef>
  overviews: CitedOverviewRef[]
}

/**
 * `allpages:citedPages`. Every page Google's AI Overviews cite in the latest full
 * check of each tracked page and topic, in each market, and whose it is. Each
 * question's winning sample is read as Results scores it, every URL once per
 * overview (as Competitors counts links), and the one site rule (`siteOf`) says
 * whether the page is yours, a saved competitor's or someone else's.
 */
export function loadCitedPages(pass: AllPagesPass): CitedPagesData {
  const { db, project } = pass
  const all = listPages(db, project.id)
  const pages = all.filter((page) => COUNTED.has(page.status))
  const pageById = new Map(pages.map((page) => [page.id, page]))
  const titles = ownTitles(all)
  const profile = readProjectProfile(db)
  const context = competitorContext(db, {})
  const lens: SiteLens = {
    ownDomain: project.domain,
    includeSubdomains: profile?.includeSubdomains ?? false,
    lists: { direct: context.direct, partial: context.partial }
  }
  const { current } = pickRuns(db, project.id, pages, null, pass.now.toISOString())
  const rows = new Map<string, Building>()
  const questions = new Set<string>()
  let checkedAt: string | null = null
  for (const run of current) {
    const page = pageById.get(run.pageId)
    if (page === undefined) continue
    if (run.finishedAt !== null && (checkedAt === null || run.finishedAt > checkedAt)) {
      checkedAt = run.finishedAt
    }
    for (const item of runBuiltPrompts(db, project.id, run)) {
      const winning = item.winning
      if (winning === null || !AIO_STATUSES.has(item.row.status)) continue
      questions.add(`${page.id}|${item.row.promptId}`)
      const seen = new Set<string>()
      for (const reference of winning.references) {
        if (seen.has(reference.normalizedUrl)) continue
        seen.add(reference.normalizedUrl)
        const building = rows.get(reference.normalizedUrl) ?? start(reference, lens, titles)
        rows.set(reference.normalizedUrl, building)
        const ref = {
          pageId: page.id,
          pageKind: page.kind === 'topic' ? ('topic' as const) : ('page' as const),
          pageLabel: pageLabel(page),
          promptId: item.row.promptId,
          promptLabel: item.row.label,
          promptText: item.row.text
        }
        const key = `${page.id}|${item.row.promptId}`
        building.overviews.push({
          id: `${run.id}|${item.row.promptId}`,
          questionId: key,
          marketId: run.marketId,
          runId: run.id,
          position: reference.position
        })
        building.markets.add(run.marketId)
        const found = building.questions.get(key)
        building.questions.set(
          key,
          found === undefined
            ? {
                ...ref,
                id: key,
                marketId: run.marketId,
                runId: run.id,
                marketIds: [run.marketId],
                position: reference.position
              }
            : {
                ...found,
                marketIds: found.marketIds.includes(run.marketId)
                  ? found.marketIds
                  : [...found.marketIds, run.marketId],
                position: Math.min(found.position, reference.position)
              }
        )
      }
    }
  }
  const list: CitedPageRow[] = [...rows.values()].map((building) => ({
    ...building.row,
    marketIds: [...building.markets],
    questions: [...building.questions.values()],
    overviews: building.overviews
  }))
  list.sort(
    (left, right) =>
      right.overviews.length - left.overviews.length ||
      right.questions.length - left.questions.length ||
      left.url.localeCompare(right.url)
  )
  return {
    projectId: project.id,
    ownDomain: bareDomain(project.domain),
    checks: current.filter((run) => pageById.has(run.pageId)).length,
    questions: questions.size,
    checkedAt,
    rows: list
  }
}

function start(
  reference: AioReference,
  lens: SiteLens,
  titles: ReadonlyMap<string, string>
): Building {
  const site = siteOf(reference, lens)
  const whose = WHOSE[site.kind]
  return {
    row: {
      id: siteId(`u:${reference.normalizedUrl}`),
      url: reference.url,
      title:
        (whose === 'yours' ? titles.get(reference.normalizedUrl) : undefined) ?? reference.title,
      domain: site.host,
      domainId: siteId(`h:${site.host}`),
      whose,
      competitor: site.kind === 'competitor' ? site.name : null
    },
    markets: new Set(),
    questions: new Map(),
    overviews: []
  }
}

/** Normalized URL → the project page's title, for own pages the overview names differently. */
function ownTitles(pages: readonly PageSummary[]): Map<string, string> {
  const titles = new Map<string, string>()
  for (const page of pages) {
    if (page.url === null || page.title === null || page.title === '') continue
    const normalized = normalizeUrl(page.url)
    if (normalized !== null) titles.set(normalized, page.title)
  }
  return titles
}

function pageLabel(page: PageSummary): string {
  return page.label ?? page.title ?? page.url ?? page.id
}
