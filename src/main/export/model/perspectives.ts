import type { CitationChange } from '@shared/report/diff'
import { oneLineHeadline } from '@shared/report/headline'
import { checkAgreement, METHOD_COPY, sampleWarning } from '@shared/report/method'
import { buildVerdict, type VerdictSet } from '@shared/report/verdict'
import { calendarDay } from '../timezone'
import { DrillRegistry } from './drills'
import { reportMetrics } from './metric-rows'
import { formatShortDate } from './format'
import { urlPath, type ScopeData } from './rows'
import type {
  CompetitionSection,
  Count,
  MethodSection,
  OverviewSection,
  ReportCover,
  ReportMarket,
  TrendsSection,
  VerdictModel,
  VerdictPartModel,
  WhatChangedRow,
  WhatChangedSection
} from './types'

/**
 * The headline, the verdict, "What changed" and "How this report was made"
 * (Docs/REPORT-SPEC.md). Built from the same rows and drills as the other sections, so a
 * number in a finding is the same number, opening the same prompts, as its KPI tile.
 */

interface ChangeSets {
  change: ReadonlyMap<string, CitationChange | null>
  gained: Count
  kept: Count
  lost: Count
  never: Count
  noEarlier: Count
  /** The shared metrics' verdict sets (`verdictSetsOf`), by row id. */
  verdict: Record<VerdictSet, string[]>
}

function changeSets(scope: ScopeData, drills: DrillRegistry): ChangeSets {
  const metrics = reportMetrics(scope)
  const { movement } = metrics
  return {
    change: metrics.change,
    gained: drills.count('change:gained', movement.gained.ids),
    kept: drills.count('change:kept', movement.kept.ids),
    lost: drills.count('change:lost', movement.lost.ids),
    never: drills.count('change:never', movement.never.ids),
    noEarlier: drills.count('change:none', metrics.notCompared),
    verdict: metrics.verdictSets
  }
}

/** "the 3 Oct 2026 check" when every earlier full check is from one day. */
export function compareLabel(scope: ScopeData, timeZone: string): string | null {
  const earlier = scope.slices.flatMap((slice) =>
    slice.previous === null ? [] : [slice.previous.finishedAt]
  )
  if (earlier.length === 0) return null
  const days = new Set(earlier.map((at) => calendarDay(at, timeZone)))
  if (days.size > 1) return 'the previous full check'
  const at = [...earlier].sort().at(-1) ?? ''
  return `the ${formatShortDate(at, timeZone)} check`
}

export interface PerspectiveInput {
  scope: ScopeData
  drills: DrillRegistry
  timeZone: string
  brand: string
  overview: OverviewSection
  competition: CompetitionSection
  trends: TrendsSection
  cover: ReportCover
  markets: readonly ReportMarket[]
  /** Page ids that are topics: their rows are the topic side of the agreement. */
  topicPageIds: ReadonlySet<string>
}

export interface Perspectives {
  headline: string
  verdict: VerdictModel
  whatChanged: WhatChangedSection
  method: MethodSection
}

export function buildPerspectives(input: PerspectiveInput): Perspectives {
  const sets = changeSets(input.scope, input.drills)
  return {
    headline: buildHeadline(input, sets),
    verdict: buildVerdictModel(input, sets),
    whatChanged: buildWhatChanged(input, sets),
    method: buildMethod(input)
  }
}

/** The one sentence at the top of the report, from the verdict's own counts. */
function buildHeadline(input: PerspectiveInput, sets: ChangeSets): string {
  const { scope, overview } = input
  const label = compareLabel(scope, input.timeZone)
  const compared = scope.rows.some((row) => sets.change.get(row.id) !== null)
  const rival = input.competition.rival
  return oneLineHeadline({
    tracked: overview.tracked.n,
    measured: overview.measured,
    aio: overview.aio.n,
    cited: overview.cited.n,
    noun:
      new Set(scope.rows.map((row) => row.marketId)).size > 1
        ? 'buyer prompt checks'
        : 'buyer prompts',
    topSite: rival === null ? null : { name: rival.domain, count: rival.prompts.n },
    change: compared && label !== null ? { gained: sets.gained.n, lost: sets.lost.n, label } : null
  })
}

function buildVerdictModel(input: PerspectiveInput, sets: ChangeSets): VerdictModel {
  const { scope, drills, overview } = input
  const label = compareLabel(scope, input.timeZone)
  const hasChanges = scope.rows.some((row) => (sets.change.get(row.id) ?? null) !== null)
  const rival = input.competition.rival
  const counts: Record<VerdictSet, Count> = {
    tracked: overview.tracked,
    aio: overview.aio,
    cited: overview.cited,
    named: overview.named,
    not_visible: overview.notVisible,
    cited_before: drills.count('change:cited-before', sets.verdict.cited_before),
    cited_after: drills.count('change:cited-after', sets.verdict.cited_after),
    named_before: drills.count('change:named-before', sets.verdict.named_before),
    named_after: drills.count('change:named-after', sets.verdict.named_after),
    gained: sets.gained,
    kept: sets.kept,
    lost: sets.lost,
    top_site: rival?.prompts ?? DrillRegistry.plain(0)
  }
  const verdict = buildVerdict({
    brand: input.brand,
    compareLabel: hasChanges ? label : null,
    tracked: overview.tracked.n,
    aio: overview.aio.n,
    cited: overview.cited.n,
    named: overview.named.n,
    notVisible: overview.notVisible.n,
    changes: hasChanges
      ? {
          gained: sets.gained.n,
          kept: sets.kept.n,
          lost: sets.lost.n,
          never: sets.never.n,
          unmatched: sets.noEarlier.n
        }
      : null,
    namedBefore: hasChanges ? counts.named_before.n : null,
    namedAfter: hasChanges ? counts.named_after.n : null,
    topSite: rival === null ? null : { name: rival.domain, count: rival.prompts.n },
    // The report says "buyer prompt" in its headline and cover; the verdict matches.
    noun:
      new Set(scope.rows.map((row) => row.marketId)).size > 1
        ? 'buyer prompt check'
        : 'buyer prompt'
  })
  return {
    status: verdict.status,
    label: verdict.label,
    tone: verdict.tone,
    compareLabel: hasChanges ? label : null,
    previousAt: input.trends.previousAt,
    currentAt: input.trends.currentAt,
    findings: verdict.findings.map((finding) => ({
      id: finding.id,
      tone: finding.tone,
      lead: finding.lead,
      parts: finding.parts.map((part): VerdictPartModel =>
        typeof part === 'string'
          ? part
          : {
              set: part.set,
              label: part.label,
              n: counts[part.set].n,
              drill: counts[part.set].drill
            }
      )
    }))
  }
}

const CHANGE_ORDER: Readonly<Record<CitationChange, number>> = {
  gained: 0,
  lost: 1,
  kept: 2,
  never: 3
}

function buildWhatChanged(input: PerspectiveInput, sets: ChangeSets): WhatChangedSection {
  const { scope } = input
  const pagePath = new Map(
    scope.slices.map((slice) => [
      slice.page.pageId,
      slice.page.kind === 'topic' ? (slice.page.title ?? 'Topic') : urlPath(slice.page.url)
    ])
  )
  const anyEarlier = scope.slices.some((slice) => slice.previous !== null)
  const rows: WhatChangedRow[] = scope.rows
    .map((row) => {
      const prior = scope.previous.get(row.id)
      return {
        rowId: row.id,
        prompt: row.text,
        pagePath: pagePath.get(row.pageId) ?? '',
        marketId: row.marketId,
        change: sets.change.get(row.id) ?? null,
        positionBefore: prior?.cited === true ? prior.position : null,
        positionNow: row.cited ? row.position : null,
        citedThrough: row.cited && row.citedUrl !== null ? urlPath(row.citedUrl) : null,
        ownPageCited: row.status === 'error' ? null : row.pageCited
      }
    })
    .map((row, index) => ({ row, index }))
    .sort(
      (left, right) =>
        (left.row.change === null ? 4 : CHANGE_ORDER[left.row.change]) -
          (right.row.change === null ? 4 : CHANGE_ORDER[right.row.change]) ||
        left.index - right.index
    )
    .map((item) => item.row)
  return {
    empty:
      scope.rows.length === 0 || !anyEarlier
        ? {
            title: 'Nothing to compare yet',
            message:
              'What changed compares each prompt’s latest full check with the full check before it.',
            nextStep: 'Run another full check; this section fills after it.'
          }
        : null,
    previousAt: input.trends.previousAt,
    currentAt: input.trends.currentAt,
    gained: sets.gained,
    kept: sets.kept,
    lost: sets.lost,
    never: sets.never,
    noEarlier: sets.noEarlier,
    rows
  }
}

function buildMethod(input: PerspectiveInput): MethodSection {
  const { scope, drills, cover } = input
  const agreement = checkAgreement(
    scope.rows
      .filter((row) => row.status !== 'error')
      .map((row) => ({
        id: row.id,
        text: row.text,
        marketId: row.marketId,
        source: input.topicPageIds.has(row.pageId) ? ('topic' as const) : ('page' as const),
        cited: row.cited
      }))
  )
  return {
    scopeLabel: cover.scopeLabel,
    sampleWarning: sampleWarning(input.overview.measured),
    questions: input.overview.tracked,
    marketIds: input.markets.map((market) => market.id),
    trackedPages: cover.trackedPages,
    windowFrom: cover.windowFrom,
    windowTo: cover.windowTo,
    previousAt: input.trends.previousAt,
    currentAt: input.trends.currentAt,
    copy: { ...METHOD_COPY },
    agreement:
      agreement === null
        ? null
        : {
            total: drills.count('agree:both', agreement.totalIds),
            agree: drills.count('agree:same', agreement.agreeIds),
            percent: agreement.percent
          }
  }
}
