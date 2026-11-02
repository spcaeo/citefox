import type { ProjectFix, SavedCompetitor, StartJourney, TopicResults } from '@shared/ipc'
import type { TopicSummary } from '@shared/domain'
import { rollupPageFixes, type PageFixKind, type ProjectSearches } from '@shared/page-fixes'
import { knownPlatform } from '@shared/site-role'
import { hasAioState } from '@shared/topic-scoring'
import type { GuideFacts } from '../types'

export const NO_FACTS: GuideFacts = {
  hasResults: false,
  topic: null,
  prompt: null,
  citesOwn: 0,
  noPage: null,
  rival: null,
  pageFix: { improve: null, owner: null, create: null },
  loggedFix: null,
  topics: 0,
  competitors: 0
}

/**
 * The page fixes the Fix a page lesson opens (one of each kind, most searches
 * first, as What to fix lists them) and the newest logged fix.
 */
export function fixFacts(
  searches: Pick<ProjectSearches, 'searches'> | null,
  fixes: readonly Pick<ProjectFix, 'fix'>[]
): Pick<GuideFacts, 'pageFix' | 'loggedFix'> {
  const rollup = searches ? rollupPageFixes(searches.searches, null) : null
  const first = (kind: PageFixKind): string | null =>
    [...(rollup?.fixes ?? [])]
      .filter((fix) => fix.kind === kind)
      .sort((a, b) => b.searches.length - a.searches.length)[0]?.id ?? null
  const newest = [...fixes].sort((a, b) => b.fix.goLiveAt.localeCompare(a.fix.goLiveAt))[0]
  return {
    pageFix: { improve: first('improve'), owner: first('owner'), create: first('new') },
    loggedFix: newest?.fix.id ?? null
  }
}

/** The topic the lessons use: the first-run topic when it was checked, else the first checked one. */
export function focusTopic(
  topics: readonly TopicSummary[],
  journeyTopicId: string | null
): TopicSummary | null {
  const live = topics.filter((topic) => topic.status !== 'removed')
  const checked = live.filter((topic) => topic.checkedAt !== null)
  return (
    checked.find((topic) => topic.id === journeyTopicId) ??
    checked[0] ??
    live.find((topic) => topic.id === journeyTopicId) ??
    null
  )
}

function label(row: { kind: string; number: number }): string {
  return `${row.kind === 'question' ? 'Q' : 'K'}${row.number}`
}

function bare(domain: string): string {
  return domain.toLowerCase().replace(/^www\./u, '')
}

/**
 * What the guide knows about the project, from data CiteFox already has: the
 * journey, the focus topic's results and the saved competitors. No search runs.
 */
export function factsFrom(input: {
  journey: Pick<StartJourney, 'hasResults'> | null
  topics: readonly TopicSummary[]
  results: TopicResults | null
  competitors: readonly Pick<SavedCompetitor, 'domain' | 'aliases'>[]
  /** What to fix's searches (`fixes:searches`); absent or null: no page fixes known. */
  searches?: Pick<ProjectSearches, 'searches'> | null
  /** Logged fixes (`fixes:listProject`). */
  fixes?: readonly Pick<ProjectFix, 'fix'>[]
}): GuideFacts {
  const { results } = input
  const hasResults =
    (input.journey?.hasResults ?? false) || input.topics.some((topic) => topic.checkedAt !== null)
  const fixes = fixFacts(input.searches ?? null, input.fixes ?? [])
  const counts = {
    topics: input.topics.filter((topic) => topic.status !== 'removed').length,
    competitors: input.competitors.length
  }
  if (!results) return { ...NO_FACTS, ...fixes, ...counts, hasResults }
  const lead = results.topic.questions > 0 ? 'question' : 'keyword'
  const shown = results.rows.filter((row) => row.kind === lead && hasAioState(row.state))
  // Likeliest wins first, the ones not cited by the right page before the ones that are.
  const ranked = [...shown].sort(
    (a, b) =>
      Number(a.state === 'right_page') - Number(b.state === 'right_page') ||
      (b.winOdds?.score ?? -1) - (a.winOdds?.score ?? -1) ||
      a.number - b.number
  )
  const first = ranked[0]
  const noPage = ranked.find((row) => row.state === 'no_page')
  const saved = new Set(
    input.competitors.flatMap((item) =>
      [item.domain, ...item.aliases].filter((value): value is string => Boolean(value)).map(bare)
    )
  )
  const tally = new Map<string, { answers: number; promptId: string }>()
  for (const row of shown) {
    for (const domain of new Set(row.citedInstead.map(bare))) {
      if (saved.has(domain) || knownPlatform(`https://${domain}/`) !== null) continue
      const seen = tally.get(domain)
      tally.set(domain, {
        answers: (seen?.answers ?? 0) + 1,
        promptId: seen?.promptId ?? row.promptId
      })
    }
  }
  const top = [...tally.entries()].sort(
    (a, b) => b[1].answers - a[1].answers || a[0].localeCompare(b[0])
  )[0]
  return {
    hasResults: hasResults || results.topic.checkedAt !== null,
    topic: {
      id: results.topic.id,
      name: results.topic.name,
      marketId: results.topic.marketId,
      targetPage: results.topic.targetPage
    },
    prompt: first ? { id: first.promptId, label: label(first) } : null,
    citesOwn: shown.filter((row) => row.citedOwnUrl !== null).length,
    noPage: noPage ? { id: noPage.promptId, label: label(noPage) } : null,
    rival: top ? { domain: top[0], answers: top[1].answers, promptId: top[1].promptId } : null,
    ...fixes,
    ...counts
  }
}
