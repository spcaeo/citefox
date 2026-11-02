import type { PromptSource } from '@shared/domain'
import { percent } from '@shared/report-copy'
import type { DrillRegistry } from './drills'
import { STAGE_LABELS, STAGE_ORDER } from './overview'
import type { ScopeData } from './rows'
import type {
  ReportMarket,
  ReportPage,
  ReportRow,
  UniverseDimension,
  UniverseRow,
  UniverseSection
} from './types'

/** Segments with fewer prompts than this are not named best or weakest. */
export const MIN_SEGMENT_PROMPTS = 5

const FUNNEL_ORDER = ['TOFU', 'MOFU', 'BOFU'] as const

const FUNNEL_LABELS: Record<(typeof FUNNEL_ORDER)[number], string> = {
  TOFU: 'TOFU · problem and trigger',
  MOFU: 'MOFU · solution and comparison',
  BOFU: 'BOFU · objection'
}

/** Source groups from the owner's method: title/meta/H1, trigger event, objection or detail. */
const SOURCE_GROUP: Record<PromptSource, string> = {
  title_meta_h1: 'title_meta_h1',
  trigger_event: 'trigger_event',
  objection: 'objection_detail',
  detail_check: 'objection_detail',
  written_by_user: 'written_by_user'
}

const SOURCE_LABELS: Record<string, string> = {
  title_meta_h1: 'Title, meta description and H1',
  trigger_event: 'Trigger event',
  objection_detail: 'Objection or detail',
  written_by_user: 'Written by you'
}

const SOURCE_ORDER = ['title_meta_h1', 'trigger_event', 'objection_detail', 'written_by_user']

/** Section 7, Universe. */
export function buildUniverse(
  scope: ScopeData,
  pages: readonly ReportPage[],
  markets: readonly ReportMarket[],
  drills: DrillRegistry,
  extra: UniverseDimension | null
): UniverseSection {
  const rows = scope.rows
  const dimension = (
    id: UniverseDimension['id'],
    title: string,
    keyOf: (row: ReportRow) => string | null,
    order: readonly string[],
    labelOf: (key: string) => string
  ): UniverseDimension => {
    const groups = new Map<string, ReportRow[]>()
    for (const row of rows) {
      const key = keyOf(row)
      if (key === null) continue
      const list = groups.get(key)
      if (list === undefined) groups.set(key, [row])
      else list.push(row)
    }
    const keys = [...groups.keys()].sort(
      (left, right) => rank(order, left) - rank(order, right) || left.localeCompare(right)
    )
    return {
      id,
      title,
      rows: keys.map((key) =>
        segment(`dim:${id}=${key}`, labelOf(key), key, groups.get(key) ?? [], drills)
      )
    }
  }
  const stage = dimension(
    'stage',
    'By intent stage',
    (row) => row.stage,
    STAGE_ORDER,
    (key) => (key in STAGE_LABELS ? STAGE_LABELS[key as keyof typeof STAGE_LABELS] : key)
  )
  const dimensions: UniverseDimension[] = [
    stage,
    dimension(
      'funnel',
      'By funnel stage',
      (row) => row.funnel,
      FUNNEL_ORDER,
      (key) => (key in FUNNEL_LABELS ? FUNNEL_LABELS[key as keyof typeof FUNNEL_LABELS] : key)
    ),
    dimension(
      'source',
      'By source',
      (row) => SOURCE_GROUP[row.source],
      SOURCE_ORDER,
      (key) => SOURCE_LABELS[key] ?? key
    )
  ]
  const tracked = pages.filter((page) => page.role === 'tracked')
  if (tracked.length > 1) {
    dimensions.push(
      dimension(
        'page',
        'By page',
        (row) => row.pageId,
        tracked.map((page) => page.id),
        (key) => tracked.find((page) => page.id === key)?.path ?? key
      )
    )
  }
  if (extra !== null && extra.rows.length > 0) dimensions.push(extra)
  if (markets.length > 1) {
    dimensions.push(
      dimension(
        'market',
        'By market',
        (row) => row.marketId,
        markets.map((market) => market.id),
        (key) => {
          const market = markets.find((item) => item.id === key)
          return market === undefined ? key : `${market.flag} ${market.label}`.trim()
        }
      )
    )
  }
  const segments = stage.rows
  const largest = [...segments].sort((left, right) => right.prompts.n - left.prompts.n)[0]
  const rated = segments.filter(
    (row): row is UniverseRow & { citedRate: number } =>
      row.prompts.n >= MIN_SEGMENT_PROMPTS && row.citedRate !== null
  )
  const best = [...rated].sort((left, right) => right.citedRate - left.citedRate)[0]
  const weakest = [...rated].sort((left, right) => left.citedRate - right.citedRate)[0]
  return {
    empty:
      rows.length === 0
        ? {
            title: 'Not measured yet',
            message: 'The universe is built from measured prompts.',
            nextStep: 'Run a check to fill this.'
          }
        : null,
    segments: segments.length,
    largest: largest === undefined ? null : { label: largest.label, prompts: largest.prompts.n },
    best: best === undefined ? null : { label: best.label, rate: best.citedRate },
    weakest:
      weakest === undefined || weakest === best || rated.length < 2
        ? null
        : { label: weakest.label, rate: weakest.citedRate },
    dimensions
  }
}

function segment(
  token: string,
  label: string,
  key: string,
  rows: readonly ReportRow[],
  drills: DrillRegistry
): UniverseRow {
  const ids = (predicate: (row: ReportRow) => boolean): string[] =>
    rows.filter(predicate).map((row) => row.id)
  const aio = drills.count(
    `${token}:aio`,
    ids((row) => row.aio)
  )
  const cited = drills.count(
    `${token}:cited`,
    ids((row) => row.cited)
  )
  return {
    key,
    label,
    prompts: drills.count(
      token,
      ids(() => true)
    ),
    aio,
    cited,
    named: drills.count(
      `${token}:named`,
      ids((row) => row.named)
    ),
    citedRate: percent(cited.n, aio.n)
  }
}

function rank(order: readonly string[], key: string): number {
  const index = order.indexOf(key)
  return index === -1 ? order.length : index
}
