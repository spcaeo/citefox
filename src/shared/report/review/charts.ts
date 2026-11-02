import type {
  BucketColumnsInput,
  GainersLosersInput,
  HistoryStripInput,
  PairedBarsInput,
  PositionChartInput,
  RankedBarsInput,
  SplitBarInput
} from '../../charts'
import { signedTenths } from './items'
import type { BarItem, MoverItem, ReviewReport, SiteItem } from './types'

/**
 * The chart inputs of a ready report, shared by the app (ui/chart/ReportCharts) and the
 * downloaded file (shared SVG builders), so both draw the same marks with the same
 * drill ids. Width and tooltips are each renderer's own.
 */
type Input<T> = Omit<T, 'width' | 'titles'>

export function groupsChart(report: ReviewReport): Input<PairedBarsInput> {
  return pairedOf(report, report.verdict.groups, 'Where your citations come from')
}

export function pagesChart(report: ReviewReport): Input<PairedBarsInput> {
  return { ...pairedOf(report, report.pages.bars, 'Your pages: before and after'), columns: 2 }
}

export function structureChart(report: ReviewReport): Input<PairedBarsInput> {
  return {
    ...pairedOf(
      report,
      report.whatChanged.structure?.blocks ?? [],
      'Which answer blocks gained ground'
    ),
    emptyText: 'No answer blocks read at both checks'
  }
}

function pairedOf(
  report: ReviewReport,
  items: readonly BarItem[],
  label: string
): Input<PairedBarsInput> {
  return {
    label,
    beforeLabel: report.fromLabel ?? 'Before',
    nowLabel: report.toLabel,
    emptyText: 'No citations at either end yet',
    items: items.map((item) => ({
      id: item.nowDrill,
      beforeId: item.beforeDrill,
      label: item.label,
      ...(item.sub ? { sub: item.sub } : {}),
      before: item.before,
      now: item.now,
      tone: item.tone ?? 'target'
    }))
  }
}

export function speedChart(report: ReviewReport): Input<BucketColumnsInput> {
  return {
    label: 'How fast new pages get cited',
    valueWords: 'questions citing them',
    emptyText: 'No published pages yet',
    items: report.verdict.speed.map((bucket) => ({
      id: bucket.drill,
      label: bucket.label,
      value: bucket.value,
      sub: bucket.sub,
      tone: 'target'
    }))
  }
}

export function splitChart(report: ReviewReport): Input<SplitBarInput> | null {
  const split = report.verdict.split
  if (split === null) return null
  return {
    label: 'Market vs your work',
    signedValues: true,
    parts: [
      {
        id: split.marketDrill,
        label: 'Market',
        value: split.marketTenths / 10,
        tone: 'muted',
        note: `${signedTenths(split.marketTenths)} from more or fewer AI answers`
      },
      {
        id: split.workDrill,
        label: 'Your work',
        value: split.workTenths / 10,
        tone: 'target',
        note: `${signedTenths(split.workTenths)} from your share of answers`
      }
    ]
  }
}

function moverOf(site: SiteItem): GainersLosersInput['items'][number] {
  return {
    id: site.nowDrill,
    label: site.own ? `${site.domain} (you)` : site.domain,
    before: site.before ?? 0,
    now: site.now,
    highlight: site.own
  }
}

export function moversChart(report: ReviewReport): Input<GainersLosersInput> {
  return {
    label: 'Who gained and lost ground',
    gainedTitle: 'Gained ground',
    lostTitle: 'Lost ground',
    gainedEmpty: 'No site gained ground',
    lostEmpty: 'No site lost ground',
    items: [...report.competitors.gained, ...report.competitors.lost].map(moverOf)
  }
}

export function rankedChart(report: ReviewReport): Input<RankedBarsInput> {
  return {
    label: `Most cited sites, ${report.toLabel}`,
    nowLabel: report.toLabel,
    ...(report.fromLabel ? { previousLabel: report.fromLabel } : {}),
    items: report.competitors.ranked.map((site) => ({
      id: site.nowDrill,
      label: site.own ? `${site.domain} (you)` : site.domain,
      value: site.now,
      previous: site.before,
      highlight: site.own
    }))
  }
}

export function positionsChart(report: ReviewReport): Input<PositionChartInput> {
  return {
    label: 'Where you sit among the sources',
    positions: report.standing.positions,
    notCited: report.standing.notCited,
    idPrefix: 'pos'
  }
}

export function historyChart(mover: MoverItem): HistoryStripInput {
  return {
    label: `History of: ${mover.question.text}`,
    cells: mover.cells.map((cell) => ({
      date: cell.date,
      state: cell.state,
      position: cell.position
    }))
  }
}

/** Deep dives: answers with a list, steps, a table or many words, before and now. */
export function shapesChart(report: ReviewReport): Input<PairedBarsInput> {
  return {
    ...pairedOf(report, report.deep.shapes?.items ?? [], 'How the shape of answers changed'),
    emptyText: 'No stored answer text to read'
  }
}

/** Deep dives: your source position, #1 to #6 or lower, before and now. */
export function spreadChart(report: ReviewReport): Input<PairedBarsInput> {
  return {
    ...pairedOf(report, report.deep.spread, 'Where you sit among the sources'),
    emptyText: 'No answer cites you yet'
  }
}

/** Deep dives: questions by how many engines cite you. */
export function agreeChart(report: ReviewReport): Input<BucketColumnsInput> {
  return {
    label: 'Do the engines agree?',
    valueWords: 'questions',
    emptyText: 'Pick All engines with two or more engines on',
    items: (report.deep.agree?.buckets ?? []).map((bucket, index, all) => ({
      id: bucket.drill,
      label: bucket.label,
      value: bucket.value,
      sub: bucket.sub,
      tone: index === 0 ? ('not-cited' as const) : index === all.length - 1 ? 'target' : 'muted'
    }))
  }
}
