import {
  fixVerdictLabel,
  type PageResults,
  type PromptSetView,
  type FixMarketOutcome,
  type FixOtherPrompts,
  type FixPlanPreview,
  type FixPromptResult,
  type FixPromptState,
  type FixRecheckRule,
  type LoggedFix
} from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { formatMoment, formatWhen } from '../m3/model'
import type { LocalChartMarker } from '../visibility/trends'
import { errorText } from '../components/errorText'
import { withDrawerOpened } from '../shell/drawerUrl'

/** View helpers for Progress → Fixes (FR-14.3, FR-14.5 to FR-14.8). Pure. */

export const MS_PER_DAY = 86_400_000

/** "Page cited · 3", "Other own page · 2", "Brand mentioned", "Not cited", "No AI Overview". */
export function stateLabel(state: FixPromptState | null): string {
  if (state === null) return 'Not checked'
  const position = state.position === null ? '' : ` · ${Math.round(state.position)}`
  switch (state.status) {
    case 'page_cited':
      return `Page cited${position}`
    case 'other_own_page':
      return `Other own page${position}`
    case 'brand_mentioned':
      return 'Brand mentioned'
    case 'not_cited':
      return 'Not cited'
    case 'no_aio':
      return 'No AI Overview'
    case 'error':
      return 'Error'
  }
}

export function resultLabel(result: FixPromptResult): string {
  if (result === 'worked') return 'Worked'
  if (result === 'got_worse') return 'Got worse'
  if (result === 'no_change') return 'No change'
  return 'Not checked'
}

export function outcomeLabel(outcome: FixMarketOutcome): string {
  return fixVerdictLabel(outcome.verdict, outcome.worked, outcome.compared)
}

/** "prompt 4", "prompts 4 and 6", "prompts 4, 6 and 9". */
export function promptList(numbers: readonly number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b)
  if (sorted.length === 0) return 'no questions'
  if (sorted.length === 1) return `question ${sorted[0]}`
  return `questions ${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`
}

/** Calendar days between two instants in the computer's zone (Oct 8 → Oct 12 is 4), never negative. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.max(0, Math.round((end - start) / MS_PER_DAY))
}

/** "Live Oct 8 · targets prompts 4, 6 and 9 · checked Oct 19, 11 days later · 🇺🇸 US · EN". */
export function fixSummaryLine(
  fix: LoggedFix,
  outcome: FixMarketOutcome | undefined,
  positions: readonly number[],
  place: string,
  now: Date
): string {
  const parts = fixSummaryParts(fix, outcome, place, now)
  return [parts.live, `targets ${promptList(positions)}`, ...parts.rest].join(' · ')
}

/**
 * The summary line around its prompt list, so the card can draw each prompt
 * number as a link: `live` · targets … · `rest`.
 */
export function fixSummaryParts(
  fix: LoggedFix,
  outcome: FixMarketOutcome | undefined,
  place: string,
  now: Date
): { live: string; rest: readonly string[] } {
  const live =
    Date.parse(fix.goLiveAt) > now.getTime()
      ? `Goes live ${formatWhen(fix.goLiveAt)}`
      : `Live ${formatWhen(fix.goLiveAt)}`
  const rest: string[] = []
  if (outcome?.afterAt) {
    const days = daysBetween(fix.goLiveAt, outcome.afterAt)
    rest.push(
      `checked ${formatMoment(outcome.afterAt)}, ${pluralize(days, 'day')} later${outcome.afterPartial ? ' (follow-up)' : ''}`
    )
  } else {
    rest.push(followUpPhrase(fix))
  }
  rest.push(place)
  return { live, rest }
}

/**
 * The targeted prompts the verdict counts: worked for "Worked" and "Partly
 * worked · N of M" (N is the worked count), the matching result otherwise.
 * Empty while waiting.
 */
export function verdictPromptIds(outcome: FixMarketOutcome): string[] {
  const result: FixPromptResult | null =
    outcome.verdict === 'worked' || outcome.verdict === 'partly'
      ? 'worked'
      : outcome.verdict === 'waiting'
        ? null
        : outcome.verdict
  if (result === null) return []
  return outcome.prompts.filter((prompt) => prompt.result === result).map((p) => p.promptId)
}

/** Where the follow-up stands, for a fix with no after check yet. */
export function followUpPhrase(fix: LoggedFix): string {
  if (fix.status === 'started') return 'follow-up check running'
  if (fix.status === 'completed') return 'follow-up checked'
  if (fix.followUpAt === null) return 'follow-up at the next scheduled check'
  return `follow-up check planned for ${formatWhen(fix.followUpAt)}`
}

/**
 * FR-14.7 comparison line. Never claims the edit caused anything.
 * Null `others` means no full check has run since go-live.
 */
export function othersLine(others: FixOtherPrompts | null): string {
  if (others === null) {
    return 'The questions you didn’t target haven’t had a full check since this fix went live, so there is nothing to compare yet.'
  }
  if (others.total === 0) return 'There were no other questions to compare in the same period.'
  return `${others.moved} of the ${pluralize(others.total, 'question')} you didn’t target also moved in the same period. Google’s overviews shift on their own, so treat one check as a signal, not proof.`
}

/** The outcome shown first: the selected market when the fix covers it, else its first market. */
export function outcomeFor(fix: LoggedFix, marketId: string | null): FixMarketOutcome | undefined {
  return fix.markets.find((item) => item.marketId === marketId) ?? fix.markets[0]
}

export type FixFilter = 'all' | 'worked' | 'no_change' | 'got_worse' | 'planned'

export const FIX_FILTERS: readonly { id: FixFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'worked', label: 'Worked' },
  { id: 'no_change', label: 'No change' },
  { id: 'got_worse', label: 'Got worse' },
  { id: 'planned', label: 'Planned' }
]

/** One targeted prompt of one fix, in the market shown. The unit the filter counts. */
export interface FixRow {
  fixId: string
  promptId: string
  filter: Exclude<FixFilter, 'all'>
}

/** A targeted prompt with an after result counts by result; one still waiting counts as planned. */
export function fixRows(fixes: readonly LoggedFix[], marketId: string | null): FixRow[] {
  return fixes.flatMap((fix) => {
    const outcome = outcomeFor(fix, marketId)
    if (outcome === undefined || outcome.verdict === 'waiting') {
      return fix.promptIds.map((promptId) => ({
        fixId: fix.id,
        promptId,
        filter: 'planned' as const
      }))
    }
    return outcome.prompts.flatMap((prompt): FixRow[] =>
      prompt.result === 'not_checked'
        ? []
        : [{ fixId: fix.id, promptId: prompt.promptId, filter: prompt.result }]
    )
  })
}

export function filterCounts(rows: readonly FixRow[]): Record<FixFilter, number> {
  const counts: Record<FixFilter, number> = {
    all: rows.length,
    worked: 0,
    no_change: 0,
    got_worse: 0,
    planned: 0
  }
  for (const row of rows) counts[row.filter] += 1
  return counts
}

export function filterStatus(filter: FixFilter, counts: Record<FixFilter, number>): string {
  const total = pluralize(counts.all, 'targeted question')
  if (filter === 'all') {
    return `Showing all ${total}: ${counts.all - counts.planned} checked after a fix, ${counts.planned} waiting for a follow-up.`
  }
  const label = FIX_FILTERS.find((item) => item.id === filter)?.label ?? ''
  return `Showing ${counts[filter]} of ${total} · ${label}`
}

/**
 * FR-14.8. Prompts a fix targets: `targeted` once it is live, `planned` while
 * its go-live is still ahead. Values are fix numbers, ascending.
 */
export function promptMarks(
  fixes: readonly LoggedFix[],
  now: Date
): ReadonlyMap<string, readonly { number: number; planned: boolean }[]> {
  const marks = new Map<string, { number: number; planned: boolean }[]>()
  for (const fix of [...fixes].sort((a, b) => a.number - b.number)) {
    const planned = Date.parse(fix.goLiveAt) > now.getTime()
    for (const promptId of fix.promptIds) {
      const list = marks.get(promptId) ?? []
      list.push({ number: fix.number, planned })
      marks.set(promptId, list)
    }
  }
  return marks
}

/**
 * FR-14.3. One orange line per fix on the rate chart, plus a grey "follow-up"
 * line for a follow-up still planned in this market. A partial follow-up that
 * ran is already a hollow point; it gets no extra line.
 */
export function fixMarkers(
  fixes: readonly LoggedFix[],
  marketId: string | null,
  promptsTotal: number,
  now: Date
): LocalChartMarker[] {
  const markers: LocalChartMarker[] = []
  for (const fix of fixes) {
    if (marketId !== null && !fix.marketIds.includes(marketId)) continue
    const planned = Date.parse(fix.goLiveAt) > now.getTime()
    const day = formatWhen(fix.goLiveAt)
    const short = shortText(fix.description)
    markers.push({
      at: fix.goLiveAt,
      chartTitle: `Fix ${fix.number} · ${day}`,
      chartDetail: planned ? 'planned' : short,
      event: planned ? `Fix ${fix.number} goes live (planned)` : `Fix ${fix.number} · ${short}`,
      promptsLabel: null,
      trendNote: '—',
      planned,
      changeNote: planned
        ? null
        : `Page content changed in this period: Fix ${fix.number} went live ${day}.`,
      band: 'fix',
      promptIds: fix.promptIds,
      fixNumber: fix.number
    })
    if (fix.status === 'planned' && fix.followUpAt !== null) {
      markers.push({
        at: fix.followUpAt,
        chartTitle: 'Follow-up',
        chartDetail: 'planned',
        event: `Follow-up for Fix ${fix.number} (planned)`,
        promptsLabel: `${fix.promptIds.length} of ${promptsTotal}`,
        trendNote: 'No, partial check',
        planned: true,
        changeNote: null,
        band: 'plan',
        promptIds: fix.promptIds,
        fixNumber: fix.number
      })
    }
  }
  return markers.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/** First line of a fix, cut for a chart label. */
export function shortText(text: string, max = 28): string {
  const line = (text.split('\n')[0] ?? '').replace(/[*_`#>[\]]/g, '').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** FR-14.5. "The follow-up uses 4–8 SerpApi searches (2 prompts × 2 markets)." */
export function searchCostLine(
  preview: Pick<FixPlanPreview, 'searchesMin' | 'searchesMax' | 'samples'> | null,
  prompts: number,
  markets: number
): string {
  if (prompts === 0 || markets === 0) {
    return 'Pick at least one question and one market to see what the follow-up costs.'
  }
  const samples = preview?.samples ?? 1
  const min = preview?.searchesMin ?? prompts * markets * samples
  const max = preview?.searchesMax ?? min * 2
  const sampleText = samples > 1 ? ` × ${samples} samples` : ''
  return `The follow-up uses ${min}–${max} searches (${pluralize(prompts, 'question')} × ${pluralize(markets, 'market')}${sampleText}).`
}

export const RECRAWL_REMINDER =
  'Google has to recrawl the page before an overview can change; requesting indexing in Google Search Console usually speeds that up.'

/** Re-check option text with its date, such as "3 days after it goes live (Oct 24)". */
export function ruleOption(rule: FixRecheckRule, preview: FixPlanPreview | null): string {
  const at = preview?.followUpAt[rule] ?? null
  const day = at === null ? '' : ` (${formatWhen(at)})`
  if (rule === 'after_3_days') return `3 days after it goes live${day}`
  if (rule === 'after_7_days') return `7 days after it goes live${day}`
  return at === null
    ? 'At the next scheduled check (none planned for this page)'
    : `At the next scheduled check${day}`
}

/** Today in the computer's zone, as a date input value (YYYY-MM-DD). */
export function todayInput(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Local midnight of a date input value, as ISO-8601 UTC. Null when invalid. */
export function localMidnightIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  if (todayInput(date) !== value) return null
  return date.toISOString()
}

/** A fix drafted from Results' top actions ("Plan as Fix N", FR-12.9). */
export interface FixDraft {
  description: string
  promptIds: readonly string[]
}

const DRAFT_TEXT_MAX = 1500

/**
 * "Plan as Fix N": the page's Progress › Fixes with the fix drawer open on a new
 * fix, prefilled with the draft (the same keys `fixes/drawer/model` reads).
 */
export function planFixHash(pageId: string, draft: FixDraft): string {
  const text = draft.description.trim().slice(0, DRAFT_TEXT_MAX)
  return withDrawerOpened(`#/pages/${encodeURIComponent(pageId)}/progress?view=fixes`, 'fix', {
    fix: 'new',
    'fix.page': pageId,
    'fix.prompts': draft.promptIds.length > 0 ? [...new Set(draft.promptIds)].join(',') : null,
    'fix.text': text || null
  })
}

/**
 * The draft an old "Plan as Fix N" link carries (`progress?plan=1&prompts=…&text=…`,
 * before the fix drawer), or null when the hash is not one.
 */
export function readFixDraft(hash: string): FixDraft | null {
  const query = hash.split('?')[1]
  if (query === undefined) return null
  const params = new URLSearchParams(query)
  if (params.get('plan') !== '1') return null
  const promptIds = (params.get('prompts') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id))
  return {
    description: (params.get('text') ?? '').slice(0, DRAFT_TEXT_MAX),
    promptIds: [...new Set(promptIds)]
  }
}

/** "fixes:create: Pick at least one market" → "Pick at least one market." */
export function cleanError(cause: unknown, fallback = 'Could not save the fix.'): string {
  return errorText(cause, fallback, { sentence: true })
}

/** "Saved · follow-up check Oct 24". */
export function savedLine(fix: LoggedFix): string {
  if (fix.followUpAt === null)
    return `Saved Fix ${fix.number} · follow-up at the next scheduled check`
  return `Saved Fix ${fix.number} · follow-up check ${formatWhen(fix.followUpAt)}`
}

/**
 * "Plan as Fix N" on Results (FR-12.9, FR-14.5): the top actions become the
 * description and their prompts are picked.
 */
export function fixDraftFromActions(results: PageResults): FixDraft {
  const promptIds = results.topActions.flatMap((action) =>
    action.promptId === null ? [] : [action.promptId]
  )
  return {
    description: results.topActions.map((action) => `${action.rank}. ${action.text}`).join('\n'),
    promptIds: [...new Set(promptIds)]
  }
}

/** A prompt the fix form can pick. */
export interface PromptOption {
  id: string
  n: number
  label: string
  text: string
}

/** Enabled prompts of the active set, worded for the selected market where it has its own wording. */
export function promptOptions(view: PromptSetView | null, marketId: string | null): PromptOption[] {
  if (view === null) return []
  return view.prompts
    .filter((prompt) => prompt.enabled)
    .map((prompt) => {
      const variant =
        prompt.variants.find((item) => item.marketId === marketId) ?? prompt.variants[0]
      return { id: prompt.id, n: prompt.position, label: prompt.label, text: variant?.text ?? '' }
    })
    .sort((a, b) => a.n - b.n)
}
