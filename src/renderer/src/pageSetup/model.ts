import { formatDay as formatUtilDay, formatMoment } from '../utils/dates'
import {
  SEARCHES_PER_PROMPT_MAX,
  SEARCHES_PER_PROMPT_MIN,
  type BuyerPrompt,
  type CoverageAction,
  type CoverageLevel,
  type CoverageMatrix,
  type CoveragePriority,
  type IntentStage,
  type PromptVariant,
  type SearchEstimate,
  type SuggestedFaq
} from '@shared/domain'
import type { GapRowState, GapStatus, PageReadResult } from '@shared/ipc'

export const COVERAGE_LEVELS: readonly CoverageLevel[] = ['strong', 'partial', 'weak', 'none']

export const STAGE_ORDER: readonly IntentStage[] = [
  'problem',
  'solution',
  'comparison',
  'objection',
  'trigger',
  'unset'
]

export interface CoverageTally {
  strong: number
  partial: number
  weak: number
  none: number
  total: number
}

export interface WorkSummary {
  newFaqs: number
  optionalFaqs: number
  /** New FAQs plus optional FAQs. The high end of the "5–6 new FAQs" line. */
  faqRangeHigh: number
  sectionEdits: number
  newFaqIds: readonly string[]
  optionalIds: readonly string[]
  sectionIds: readonly string[]
  faqIds: readonly string[]
}

export interface GapFilter {
  query: string
  coverage: readonly CoverageLevel[]
  priority: readonly CoveragePriority[]
  /** Intent stages to keep. Empty or absent keeps every stage. */
  stage?: readonly IntentStage[]
  /** Prompt sources to keep. Empty or absent keeps every source. */
  source?: readonly BuyerPrompt['source'][]
  /** Rows with any of these actions. Empty or absent keeps every row. */
  action?: readonly CoverageAction[]
}

export const EMPTY_GAP_FILTER: GapFilter = { query: '', coverage: [], priority: [] }

/** One coverage row joined to its prompt, for the matrix and the one-by-one list. */
export interface GapListRow {
  id: string
  promptId: string
  position: number
  label: string
  text: string
  stage: IntentStage
  source: BuyerPrompt['source']
  coverage: CoverageLevel
  whereCovered: readonly string[]
  currentContent: string
  whatToUpdate: string
  mainGap: string
  priority: CoveragePriority
  actions: readonly [CoverageAction, ...CoverageAction[]]
  /** The draft that shows: the person's edit, else Claude's. */
  suggestedFaq: SuggestedFaq | null
  done: boolean
  /** Claude's draft from the matrix (kept for "Reset to Claude's draft"). */
  claudeFaq: SuggestedFaq | null
  /** True when the person edited the draft. */
  faqEdited: boolean
  /** Open, published or verified (`gaps:setStatus`); follows `done` when never set. */
  status: GapStatus
  /** The live section once published. */
  publishedUrl: string | null
}

export interface StageGroup {
  stage: IntentStage
  prompts: readonly BuyerPrompt[]
}

export function wordCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/** The UI may shorten a SHA-256. Four characters, an ellipsis, then two. */
export function shortHash(hash: string): string {
  if (hash.length <= 8) return hash
  return `${hash.slice(0, 4)}…${hash.slice(-2)}`
}

/** Visible provenance. The name is the template's own name, never the kind. */
export function templateProvenanceText(templateName: string, edited: boolean): string {
  if (edited) return `Template: ${templateName} (edited)`
  // "CiteFox default (default)" says the same word twice.
  return /\bdefault\b/i.test(templateName)
    ? `Template: ${templateName}`
    : `Template: ${templateName} (default)`
}

/**
 * Inline height for a prompt field.
 * The control is set to this height so the full prompt is visible and the field does not scroll inside itself.
 */
export function promptFieldHeight(scrollHeight: number): string {
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return 'auto'
  return `${Math.ceil(scrollHeight)}px`
}

/** Id and short hash stay off the line and in the tooltip. */
export function templateProvenanceTooltip(templateId: string, templateHash: string): string {
  return `${templateId} · ${shortHash(templateHash)}`
}

export function formatDuration(ms: number): string {
  if (ms < 100) return `${ms} ms`
  const seconds = ms / 1000
  const text = seconds.toFixed(1).replace(/\.0$/, '')
  return `${text} s`
}

/**
 * Page-read time in the computer's own zone and clock (12- or 24-hour, formatMoment),
 * never a forced 24-hour clock. An unreadable value is shown as it came.
 */
export function formatReadStamp(iso: string): string {
  return Number.isNaN(new Date(iso).getTime()) ? iso : formatMoment(iso)
}

/** A stored date in UTC, such as a page's published date: "Oct 19, 2026". */
export function formatDay(iso: string): string {
  return formatUtilDay(iso, { timeZone: 'UTC' })
}

/** A failed read still resolves. `nextStep` is set only when the user has to act. */
export function readFailed(result: PageReadResult): boolean {
  return result.nextStep !== null
}

export function snapshotReused(previousHash: string | null, nextHash: string): boolean {
  return previousHash !== null && previousHash.length > 0 && previousHash === nextHash
}

export function coverageTally(rows: readonly { coverage: CoverageLevel }[]): CoverageTally {
  const tally: CoverageTally = { strong: 0, partial: 0, weak: 0, none: 0, total: rows.length }
  for (const row of rows) tally[row.coverage] += 1
  return tally
}

/** NFR-14. Chart segments have to add up to the population they describe. */
export function tallySums(tally: CoverageTally): boolean {
  return tally.strong + tally.partial + tally.weak + tally.none === tally.total
}

export interface ChartSegment {
  level: CoverageLevel
  count: number
}

/** Drawn segments omit empty levels. Their counts still add up to the chart total. */
export function chartSegments(tally: CoverageTally): ChartSegment[] {
  return COVERAGE_LEVELS.filter((level) => tally[level] > 0).map((level) => ({
    level,
    count: tally[level]
  }))
}

export function segmentsSum(segments: readonly ChartSegment[], total: number): boolean {
  return segments.reduce((sum, segment) => sum + segment.count, 0) === total
}

export function workOf(
  rows: readonly { id: string; actions: readonly CoverageAction[] }[]
): WorkSummary {
  const newFaqs = rows.filter((row) => row.actions.includes('new_faq'))
  const optional = rows.filter((row) => row.actions.includes('optional_faq'))
  const sections = rows.filter(
    (row) => row.actions.includes('update_existing') || row.actions.includes('small_update')
  )
  return {
    newFaqs: newFaqs.length,
    optionalFaqs: optional.length,
    faqRangeHigh: newFaqs.length + optional.length,
    sectionEdits: sections.length,
    newFaqIds: newFaqs.map((row) => row.id),
    optionalIds: optional.map((row) => row.id),
    sectionIds: sections.map((row) => row.id),
    faqIds: [...newFaqs, ...optional].map((row) => row.id)
  }
}

/** The peach card headline. Optional FAQs widen the range. */
export function workHeadline(work: WorkSummary): string {
  if (work.optionalFaqs > 0) return `${work.newFaqs}–${work.faqRangeHigh} new FAQs`
  if (work.newFaqs === 1) return '1 new FAQ'
  return `${work.newFaqs} new FAQs`
}

/** The line under the headline. The count is the section-edit rows. */
export function workDetail(work: WorkSummary): string {
  const sections = work.sectionEdits === 1 ? '1 section' : `${work.sectionEdits} sections`
  return `and edits to ${sections}`
}

export function workSentence(work: WorkSummary): string {
  const edits = work.sectionEdits === 1 ? '1 section edit' : `${work.sectionEdits} section edits`
  return `${workHeadline(work)} and ${edits}`
}

export function joinGapRows(
  matrix: CoverageMatrix,
  prompts: readonly BuyerPrompt[],
  states: readonly GapRowState[] = []
): GapListRow[] {
  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]))
  const stateOf = new Map(states.map((state) => [state.promptId, state]))
  return matrix.rows.map((row) => {
    const state = stateOf.get(row.promptId)
    const prompt = byId.get(row.promptId)
    const variant = prompt ? variantFor(prompt, prompt.variants[0]?.marketId ?? '', 'en') : null
    return {
      id: row.id,
      promptId: row.promptId,
      position: prompt?.position ?? 0,
      label: prompt?.label ?? row.promptId,
      text: variant?.text ?? '',
      stage: prompt?.intentStage ?? 'unset',
      source: prompt?.source ?? 'written_by_user',
      coverage: row.coverage,
      whereCovered: row.whereCovered,
      currentContent: row.currentContent,
      whatToUpdate: row.whatToUpdate,
      mainGap: row.mainGap,
      priority: row.priority,
      actions: row.actions,
      suggestedFaq: state?.faq ?? row.suggestedFaq,
      done: row.done,
      claudeFaq: row.suggestedFaq,
      faqEdited: Boolean(state?.faq),
      status: state?.status ?? (row.done ? 'published' : 'open'),
      publishedUrl: state?.publishedUrl ?? null
    }
  })
}

export function gapMatches(row: GapListRow, filter: GapFilter): boolean {
  if (filter.coverage.length > 0 && !filter.coverage.includes(row.coverage)) return false
  if (filter.priority.length > 0 && !filter.priority.includes(row.priority)) return false
  if (filter.stage && filter.stage.length > 0 && !filter.stage.includes(row.stage)) return false
  if (filter.source && filter.source.length > 0 && !filter.source.includes(row.source)) return false
  if (
    filter.action &&
    filter.action.length > 0 &&
    !row.actions.some((action) => filter.action?.includes(action))
  ) {
    return false
  }
  const query = filter.query.trim().toLowerCase()
  if (!query) return true
  const haystack = [
    row.label,
    row.text,
    row.mainGap,
    row.currentContent,
    row.whatToUpdate,
    ...row.whereCovered,
    ...row.actions
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(query)
}

export function filterGapRows(rows: readonly GapListRow[], filter: GapFilter): GapListRow[] {
  return rows.filter((row) => gapMatches(row, filter))
}

/**
 * How many rows a coverage drill will list.
 * The count ignores the coverage selection and keeps the search and priority filter,
 * which is what the tile shows before the drill opens.
 */
export function coverageDrillCount(
  rows: readonly GapListRow[],
  filter: GapFilter,
  level: CoverageLevel
): number {
  const withoutCoverage: GapFilter = { ...filter, coverage: [] }
  return rows.filter((row) => gapMatches(row, withoutCoverage) && row.coverage === level).length
}

export function chartPopulation(rows: readonly GapListRow[], filter: GapFilter): GapListRow[] {
  return filterGapRows(rows, { ...filter, coverage: [] })
}

export function variantFor(
  prompt: BuyerPrompt,
  marketId: string,
  language: string
): PromptVariant | null {
  return (
    prompt.variants.find((variant) => variant.marketId === marketId) ??
    prompt.variants.find((variant) => variant.language === language) ??
    prompt.variants[0] ??
    null
  )
}

export function promptMatches(prompt: BuyerPrompt, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const texts = prompt.variants.map((variant) => variant.text)
  return [prompt.label, prompt.mappedElement, prompt.source, prompt.intentStage, ...texts]
    .join(' ')
    .toLowerCase()
    .includes(needle)
}

export function stageGroups(prompts: readonly BuyerPrompt[]): StageGroup[] {
  return STAGE_ORDER.map((stage) => ({
    stage,
    prompts: prompts.filter((prompt) => prompt.intentStage === stage)
  })).filter((group) => group.prompts.length > 0)
}

export function groupsSum(groups: readonly StageGroup[], total: number): boolean {
  return groups.reduce((sum, group) => sum + group.prompts.length, 0) === total
}

export function showingCount(shown: number, total: number, noun: 'prompt' | 'prompts'): string {
  const shownLabel = shown.toLocaleString('en-US')
  const totalLabel = total.toLocaleString('en-US')
  const word = (count: number): string =>
    noun === 'prompt' && count === 1 ? 'question' : 'questions'
  if (shown === total) return `Showing ${shownLabel} ${word(shown)}`
  return `Showing ${shownLabel} of ${totalLabel} ${word(total)}`
}

export function searchEstimate(prompts: number, markets: number, samples: number): SearchEstimate {
  const units = Math.max(0, prompts) * Math.max(0, markets) * Math.max(0, samples)
  return {
    prompts: Math.max(0, prompts),
    markets: Math.max(0, markets),
    samples: Math.max(0, samples),
    minSearches: units * SEARCHES_PER_PROMPT_MIN,
    maxSearches: units * SEARCHES_PER_PROMPT_MAX
  }
}

export function brandCheck(
  texts: readonly string[],
  brands: readonly string[]
): { brandsClear: boolean; brandMessage: string } {
  const names = brands.map((brand) => brand.trim()).filter((brand) => brand.length > 0)
  const hit = names.find((name) =>
    texts.some((text) => text.toLowerCase().includes(name.toLowerCase()))
  )
  if (hit) {
    return {
      brandsClear: false,
      brandMessage: `A question contains ${hit}. Remove the brand name before the next check.`
    }
  }
  if (names.length === 0) {
    return { brandsClear: true, brandMessage: 'No brand names are stored on this project.' }
  }
  const named = names.length === 1 ? names[0] : names.join(' or ')
  return { brandsClear: true, brandMessage: `None of these questions contain ${named}.` }
}

export function faqWordCountMatches(faq: SuggestedFaq | null): boolean {
  if (!faq) return true
  return faq.wordCount === wordCount(faq.answer)
}

/** The rows with the person's gap edits laid over Claude's matrix (drafts, statuses). */
export function withGapStates(
  rows: readonly GapListRow[],
  states: readonly GapRowState[]
): GapListRow[] {
  const stateOf = new Map(states.map((state) => [state.promptId, state]))
  return rows.map((row) => {
    const state = stateOf.get(row.promptId)
    return {
      ...row,
      suggestedFaq: state?.faq ?? row.claudeFaq,
      faqEdited: Boolean(state?.faq),
      status: state?.status ?? (row.done ? 'published' : 'open'),
      publishedUrl: state?.publishedUrl ?? null
    }
  })
}
