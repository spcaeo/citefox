import { bareDomain } from '../../engine/checks/url'
import { buildAnswerShape } from './answer-shape'
import { buildCompetition } from './competition'
import { buildContentGaps } from './content-gaps'
import { DrillRegistry } from './drills'
import { DEFAULT_BRAND_COLOR, type ReportBuildInput } from './input'
import { buildOverview, windowOf } from './overview'
import { buildPagesSection } from './pages'
import { buildPerspectives } from './perspectives'
import { buildRecommendations } from './recommendations'
import { collectScope, reportMarket, trackedPage, type ScopeData } from './rows'
import { buildSources } from './sources'
import { buildTrends } from './trends'
import { buildUniverse } from './universe'
import {
  REPORT_MODEL_VERSION,
  type Count,
  type ReportBuildContext,
  type ReportCover,
  type ReportMarket,
  type ReportModel,
  type ReportPage,
  type ReputationSection
} from './types'

const CSS_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Builds the report model every output renders (Docs/REPORT-SPEC.md). Deterministic for
 * the same input: no clock, database or network access here.
 */
export function buildReportModel(input: ReportBuildInput): ReportModel {
  const drills = new DrillRegistry()
  const scope = collectScope(input.pages)
  const ownDomain = bareDomain(input.project.domain)
  const tracked = input.pages.map((prepared) => trackedPage(prepared.page))
  const markets = marketsOf(input, scope)
  const projectScope = input.scope === 'project'
  const pagesBuilt = buildPagesSection(scope, tracked, drills)
  const pages: ReportPage[] = [...tracked, ...pagesBuilt.otherOwnPages]
  const context: ReportBuildContext = {
    rows: scope.rows,
    references: scope.references,
    pages,
    markets,
    ownDomain,
    brands: input.project.brandNames,
    competitors: input.project.competitors,
    count: (token: string, ids: readonly string[]): Count => drills.count(token, ids)
  }
  const builders = input.builders ?? {}
  const overview = buildOverview(scope, tracked, projectScope, drills, input.timeZone)
  const competition = buildCompetition(scope, ownDomain, drills, {
    competitors: input.project.competitors,
    siteKinds: input.siteKinds ?? {}
  })
  const reputation = builders.reputation?.(context) ?? emptyReputation()
  const trends = buildTrends(scope, input.timeZone, drills, builders.verdicts?.(context))
  const universe = buildUniverse(scope, pages, markets, drills, builders.groups?.(context) ?? null)
  const baseSources = buildSources(scope, ownDomain, drills)
  const sources = builders.sources?.(context, baseSources) ?? baseSources
  const answerShape = buildAnswerShape(scope, input.answerShapes, drills)
  const singlePage = input.scope === 'page' && input.pages.length === 1 ? input.pages[0] : undefined
  const topicSubject = singlePage?.page.kind === 'topic'
  // Content gaps compare one page's text with its prompts; a topic has no page text.
  const contentGaps = topicSubject
    ? topicContentGaps()
    : buildContentGaps(scope, singlePage?.page ?? null)
  const topicCoverage = input.sections.includes('topic_coverage')
    ? (builders.topicCoverage?.(context) ?? null)
    : null
  const prompts = {
    empty:
      scope.rows.length === 0
        ? {
            title: 'Not measured yet',
            message: 'No full check has finished in this data window.',
            nextStep: 'Run a check to fill the prompts table.'
          }
        : null,
    all: drills.count(
      'all',
      scope.rows.map((row) => row.id)
    )
  }
  const reportCover = cover(input, scope, tracked, ownDomain)
  const topicPageIds = new Set(
    input.pages.filter((item) => item.page.kind === 'topic').map((item) => item.page.pageId)
  )
  const perspectives = buildPerspectives({
    scope,
    drills,
    timeZone: input.timeZone,
    brand: input.project.brandNames[0] ?? input.project.name,
    overview,
    competition,
    trends,
    cover: reportCover,
    markets,
    topicPageIds
  })
  const recommendations = buildRecommendations({
    rows: scope.rows,
    references: scope.references,
    pages,
    contentGaps,
    ownDomain,
    topicPageIds,
    drills
  })
  return {
    version: REPORT_MODEL_VERSION,
    cover: reportCover,
    // Topic coverage renders only when a topic is in scope, so a page file is unchanged.
    sections: input.sections.filter((id) => id !== 'topic_coverage' || topicCoverage !== null),
    markets,
    pages,
    rows: scope.rows,
    drills: drills.toRecord(),
    overview,
    pagesSection: pagesBuilt.section,
    competition,
    reputation,
    trends,
    universe,
    sources,
    answerShape,
    contentGaps,
    prompts,
    ...perspectives,
    recommendations,
    references: scope.references,
    ...(topicCoverage === null ? {} : { topicCoverage })
  }
}

function topicContentGaps(): ReportModel['contentGaps'] {
  return {
    empty: {
      title: 'Page scope only',
      message: 'Content gaps compare one page with its buyer prompts. A topic has no single page.',
      nextStep: 'See Topic coverage for the to-do, or export a target page for its gaps.'
    },
    pageRead: null,
    matrix: [],
    summary: '',
    oneByOne: [],
    pageWide: []
  }
}

function cover(
  input: ReportBuildInput,
  scope: ScopeData,
  tracked: readonly ReportPage[],
  ownDomain: string
): ReportCover {
  const window = windowOf(scope)
  const first = input.pages[0]?.page
  const page = input.scope === 'page' && input.pages.length === 1 ? tracked[0] : undefined
  const topic = page !== undefined && first?.kind === 'topic'
  const brandColor =
    input.project.brandColor !== null && CSS_COLOR.test(input.project.brandColor)
      ? input.project.brandColor
      : DEFAULT_BRAND_COLOR
  return {
    title:
      page === undefined
        ? `AI visibility report — ${input.project.name}`
        : `AI visibility report — ${page.title ?? page.path}`,
    domain: ownDomain,
    projectName: input.project.name,
    clientName: input.project.clientName,
    scope: page === undefined ? 'project' : 'page',
    scopeLabel:
      page === undefined
        ? `Project · ${tracked.length} tracked ${tracked.length === 1 ? 'page' : 'pages'}`
        : topic
          ? `Topic · ${page.title ?? page.id}`
          : `Page · ${page.path}`,
    scopeSlug: page === undefined ? 'all-pages' : (first?.slug ?? 'page'),
    builtAt: input.builtAt.toISOString(),
    windowFrom: window.from,
    windowTo: window.to,
    timeZone: input.timeZone,
    promptsTracked: scope.rows.length,
    brands: input.project.brandNames,
    competitors: input.project.competitors,
    trackedPages: tracked.length,
    templates: input.templates,
    brandColor
  }
}

function marketsOf(input: ReportBuildInput, scope: ScopeData): ReportMarket[] {
  const seen = new Map<string, ReportMarket>()
  for (const prepared of input.pages) {
    for (const market of prepared.markets) {
      if (seen.has(market.marketId)) continue
      seen.set(market.marketId, reportMarket(market.marketId, market.code, input.markets))
    }
  }
  for (const row of scope.rows) {
    if (!seen.has(row.marketId))
      seen.set(row.marketId, reportMarket(row.marketId, row.marketId, input.markets))
  }
  return [...seen.values()]
}

/** Reputation until the brand-sentiment builder supplies it. */
export function emptyReputation(): ReputationSection {
  const zero: Count = { n: 0, drill: null }
  return {
    empty: {
      title: 'Not measured yet',
      message: 'Brand sentiment reads the AI Overviews that name your brand.',
      nextStep: 'Run a check with brand sentiment on to fill this.'
    },
    positive: zero,
    neutral: zero,
    negative: zero,
    analysed: 0,
    net: null,
    trend: [],
    issues: [],
    answers: []
  }
}
