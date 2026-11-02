import type { MetricsResult } from '../../metrics/types'
import { backlinksView, lostGroundView, roundView, type AgencyInput } from './agency'
import { driverFindings, isWaiting, whatChangedView, winBackStep } from './changed'
import { competitionView } from './compete'
import { deepView } from './deep'
import { EMPTY_EXTRAS, type ReportExtras } from './extras'
import { impactView } from './impact'
import { emptyLines, reportNeeds, sectionsOf } from './needs'
import { pageStory, type StoryReport } from './page-story'
import type { PageStory } from './impact-types'
import { DrillBook, pageItems, questionItems, toIdsOf } from './items'
import {
  changedView,
  competitorsView,
  methodView,
  notIndexedView,
  pagesView,
  publishedView,
  questionsView,
  standingView,
  topicsView,
  type SectionInput
} from './sections'
import { namedKpi, namedView } from './named'
import type { PageItem, ReportContext, ReportKind, ReviewReport, ReviewSectionId } from './types'
import { readyView } from './ready'
import { buildVerdict } from './verdict'
import { visibilityPageItems, visibilityView } from './visibility'
import { EMPTY_VISIBILITY } from './visibility-extras'
import { shapeView } from './shape'
import { sourcesView } from './sources'
import { EMPTY_ANSWER_EXTRAS } from './sources-types'

export const REPORT_TITLES: Readonly<Record<ReportKind, string>> = {
  visibility: 'Visibility report',
  changed: 'What changed',
  impact: 'Impact review',
  pitch: 'Pitch / audit',
  content: 'Content plan',
  rival: 'Head-to-head'
}

export const SECTION_TITLES: Readonly<Record<ReviewSectionId, string>> = {
  standing: 'Where you stand',
  verdict: 'Verdict',
  published: 'Published pages',
  changed: 'What changed',
  questions: 'Questions',
  competitors: 'Competitors',
  pages: 'Pages',
  lost: 'Lost ground',
  topics: 'Topics',
  deep: 'Deep dives',
  reputation: 'Reputation',
  sources: 'Sources',
  shape: 'Answer shape',
  notindexed: 'Not indexed',
  backlinks: 'Backlinks',
  next: 'Next round',
  method: 'How we measured',
  summary: 'Summary',
  plan: 'Plan',
  writeplan: 'Plan',
  h2h: 'Head-to-head'
}

/** The sections of each ready report, in order (the mock-up's tabs). */
export const REPORT_SECTIONS: Readonly<Record<ReportKind, readonly ReviewSectionId[]>> = {
  visibility: [
    'standing',
    'questions',
    'competitors',
    'pages',
    'topics',
    'deep',
    'sources',
    'shape',
    'reputation',
    'notindexed',
    'backlinks',
    'method'
  ],
  changed: [
    'verdict',
    'changed',
    'questions',
    'competitors',
    'pages',
    'published',
    'lost',
    'topics',
    'deep',
    'next',
    'method'
  ],
  impact: [
    'verdict',
    'published',
    'changed',
    'questions',
    'competitors',
    'pages',
    'lost',
    'topics',
    'deep',
    'notindexed',
    'backlinks',
    'next',
    'method'
  ],
  // The short ready reports: seven tabs or fewer each.
  pitch: ['summary', 'competitors', 'plan', 'method'],
  content: ['writeplan', 'topics', 'shape', 'sources', 'method'],
  rival: ['h2h', 'questions', 'method']
}

/** The check a window end stands for: the latest check at or before that moment. */
function endAt(metrics: MetricsResult, moment: string | null): string | null {
  if (moment === null) return metrics.checks.at(-1)?.at ?? null
  let at: string | null = null
  for (const check of metrics.checks) if (check.at <= moment) at = check.at
  return at ?? moment
}

/**
 * One ready report from one `MetricsResult`: every section's numbers, sentences and
 * drills. Pure, so the app and the downloaded file give identical numbers.
 */
export function buildReport(
  metrics: MetricsResult,
  ctx: ReportContext,
  extras: ReportExtras = EMPTY_EXTRAS
): ReviewReport {
  const comparing = metrics.comparison !== null
  const toAt = endAt(metrics, metrics.window.to)
  const fromMoment =
    metrics.window.from === null || metrics.window.from === 'previous' ? null : metrics.window.from
  const fromAt = comparing ? (fromMoment === null ? null : endAt(metrics, fromMoment)) : null
  const toLabel = toAt === null ? 'the latest check' : ctx.day(toAt)
  const fromLabel = comparing ? (fromAt === null ? 'the previous check' : ctx.day(fromAt)) : null
  const book = new DrillBook()
  const toIds = toIdsOf(metrics)
  const questions = questionItems(metrics, comparing, extras.questionTargets)
  const published = new Set(metrics.pages.published.ids)
  const pages = pageItems(metrics, published)
  const input: SectionInput = { metrics, book, toIds, ctx, questions, pages, fromLabel, toLabel }
  const verdict = buildVerdict(input)
  const notIndexed = notIndexedView(input)
  const agency: AgencyInput = { ...input, extras }
  const lostGround = lostGroundView(agency)
  const backlinks = backlinksView(agency)
  const competitors = competitorsView(input)
  const round = roundView(agency)
  const named = namedView(input)
  const pagesByUrl: Record<string, PageItem> = Object.fromEntries(
    pages.map((item) => [item.url, item])
  )
  const report: Omit<ReviewReport, 'drills' | 'sections' | 'whatChanged' | 'visibility' | 'ready'> =
    {
      kind: ctx.kind,
      title: REPORT_TITLES[ctx.kind],
      engine: metrics.engine,
      windowLabel: fromLabel === null ? toLabel : `${fromLabel} → ${toLabel}`,
      fromLabel,
      toLabel,
      comparing,
      standing: standingView(input),
      verdict: {
        ...verdict,
        // Brand named is the second headline: its tile follows the citing tiles.
        kpis: comparing
          ? verdict.kpis.some((kpi) => kpi.label === 'Brand named')
            ? verdict.kpis.map((kpi) => (kpi.label === 'Brand named' ? namedKpi(named, true) : kpi))
            : [...verdict.kpis, namedKpi(named, true)]
          : verdict.kpis
      },
      published: publishedView(input),
      changed: changedView(input),
      questions: questionsView(input),
      competitors,
      competition: competitionView(agency, competitors),
      pages: pagesView(input),
      topics: topicsView(input),
      notIndexed,
      lostGround,
      backlinks,
      round,
      deep: deepView(agency),
      sources: sourcesView(input, extras.answers ?? EMPTY_ANSWER_EXTRAS),
      answerShape: shapeView(input, extras.answers ?? EMPTY_ANSWER_EXTRAS),
      branding: extras.branding,
      method: methodView(input),
      named,
      impact: impactView({ ...agency, fromAt, toAt, competitors, lostGround, round }),
      // What changed draws its own "needs a second check" panel (whatChanged.waiting).
      needs: ctx.kind === 'changed' ? null : reportNeeds(ctx.kind, metrics, extras, ctx),
      questionsById: Object.fromEntries(questions.map((item) => [item.id, item])),
      pagesByUrl
    }
  const visibility = visibilityView({
    ...input,
    extras: extras.visibility ?? EMPTY_VISIBILITY,
    standing: report.standing,
    topics: report.topics
  })
  for (const page of visibilityPageItems(visibility, pages)) pagesByUrl[page.url] = page
  const ready = readyView({ ...agency, report: { ...report, visibility } })
  const stories: Record<string, PageStory> = {}
  for (const page of pages) {
    if (!page.published && page.status !== 'lost') continue
    const story = pageStory(report as StoryReport, metrics, page.url, ctx.day)
    if (story !== null) stories[page.url] = story
  }
  report.impact = { ...report.impact, stories }
  // Built last: its drills reuse the ids (and lists) the sections above registered.
  const changedInput = { ...agency, fromAt, toAt, schedule: round.schedule }
  const whatChanged = whatChangedView(changedInput)
  const waiting = ctx.kind === 'changed' && isWaiting(changedInput)
  if (ctx.kind === 'changed' && !waiting) {
    const win = winBackStep(whatChanged.drivers, fromLabel)
    report.verdict = {
      ...report.verdict,
      findings: [...report.verdict.findings.slice(0, 4), ...driverFindings(whatChanged.drivers)],
      next: win === null ? report.verdict.next : [win, ...report.verdict.next]
    }
  }
  const extraPages = Object.fromEntries(
    whatChanged.pages.rows
      .filter((row) => report.pagesByUrl[row.page.url] === undefined)
      .map((row) => [row.page.url, row.page])
  )
  const alerts = new Set<ReviewSectionId>([
    ...(notIndexed.rows.length > 0 ? (['notindexed'] as const) : []),
    ...(lostGround.items.length > 0 ? (['lost'] as const) : [])
  ])
  // With one check, What changed shows one panel: it needs a second check.
  const ids: readonly ReviewSectionId[] = waiting ? ['changed'] : REPORT_SECTIONS[ctx.kind]
  return {
    ...report,
    whatChanged,
    visibility,
    ready,
    pagesByUrl: { ...report.pagesByUrl, ...extraPages },
    sections: sectionsOf(
      ids,
      SECTION_TITLES,
      // The waiting panel is What changed's content, not an empty tab.
      waiting ? {} : emptyLines({ ...report, whatChanged, visibility, ready }, metrics),
      alerts
    ),
    drills: book.drills
  }
}
