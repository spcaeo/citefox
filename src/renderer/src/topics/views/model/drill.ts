import { isTopicPromptKind, isTopicStage, TOPIC_STAGE_LABEL } from '@shared/domain'
import { pathOf } from './paths'
import { GOOGLE_WORDS, type ResultWords } from '../../../ui/resultWords'
import { resultLabel, whatToDo } from './results'
import { SEARCH_RESULTS, type SearchFilter, type SearchResult } from './types'

/**
 * A drill's filters live in the URL (`stage=problem&result=not_cited`), so a clicked
 * count can be copied, and Back returns to the view it came from. The keys are the
 * filter's own names, plus `type` for the Questions/Keywords kind.
 */

const KEYS = ['stage', 'result', 'work', 'type', 'words', 'page', 'site', 'source'] as const
export const DRILL_KEYS: readonly string[] = KEYS

function isResult(value: string | null): value is SearchResult {
  return value !== null && (SEARCH_RESULTS as readonly string[]).includes(value)
}

export function parseDrill(params: URLSearchParams): SearchFilter {
  const filter: SearchFilter = {}
  const stage = params.get('stage')
  if (stage === 'none' || (stage !== null && isTopicStage(stage))) filter.stage = stage
  const result = params.get('result')
  if (isResult(result)) filter.result = result
  if (params.get('work') === '1') filter.work = true
  const kind = params.get('type')
  if (kind !== null && isTopicPromptKind(kind)) filter.kind = kind
  for (const key of ['words', 'page', 'site', 'source'] as const) {
    const value = params.get(key)
    if (value) filter[key] = value.slice(0, 2000)
  }
  return filter
}

/** Writes the filter into `params`, replacing any drill keys already there. */
export function writeDrill(params: URLSearchParams, filter: SearchFilter): URLSearchParams {
  for (const key of KEYS) params.delete(key)
  if (filter.stage) params.set('stage', filter.stage)
  if (filter.result) params.set('result', filter.result)
  if (filter.work) params.set('work', '1')
  if (filter.kind) params.set('type', filter.kind)
  for (const key of ['words', 'page', 'site', 'source'] as const) {
    const value = filter[key]
    if (value) params.set(key, value)
  }
  return params
}

export function isDrill(filter: SearchFilter): boolean {
  return Object.values(filter).some((value) => value !== undefined)
}

/** One removable chip per filter key, in a fixed order. */
export interface DrillChip {
  key: keyof SearchFilter
  label: string
  result?: SearchResult
}

export function drillChips(
  filter: SearchFilter,
  sourceName: (id: string) => string = (id) => id,
  words: ResultWords = GOOGLE_WORDS
): DrillChip[] {
  const chips: DrillChip[] = []
  if (filter.source) chips.push({ key: 'source', label: `Topic: ${sourceName(filter.source)}` })
  if (filter.stage)
    chips.push({
      key: 'stage',
      label: `Stage: ${filter.stage === 'none' ? 'No stage' : TOPIC_STAGE_LABEL[filter.stage]}`
    })
  if (filter.kind)
    chips.push({ key: 'kind', label: filter.kind === 'question' ? 'Questions' : 'Keywords' })
  if (filter.words) chips.push({ key: 'words', label: `Words: ${filter.words}` })
  if (filter.result)
    chips.push({ key: 'result', label: resultLabel(filter.result, words), result: filter.result })
  if (filter.work) chips.push({ key: 'work', label: 'Needs work' })
  if (filter.page) chips.push({ key: 'page', label: `Page: ${pathOf(filter.page)}` })
  if (filter.site) chips.push({ key: 'site', label: `Cited instead: ${filter.site}` })
  return chips
}

export function withoutKey(filter: SearchFilter, key: keyof SearchFilter): SearchFilter {
  const next = { ...filter }
  delete next[key]
  return next
}

const RESULT_TITLE: Readonly<Record<SearchResult, string>> = {
  not_cited: 'where you are not cited',
  other_page: 'where your other page is cited',
  target: 'where the target page is cited',
  no_overview: 'with no AI Overview',
  not_checked: 'not checked yet'
}

/** "Problem searches where you are not cited". */
export function drillTitle(filter: SearchFilter, words: ResultWords = GOOGLE_WORDS): string {
  const noun =
    filter.kind === 'keyword' ? 'keywords' : filter.kind === 'question' ? 'questions' : 'searches'
  const lead = filter.words
    ? `"${filter.words}" ${noun}`
    : filter.stage
      ? `${filter.stage === 'none' ? 'No-stage' : TOPIC_STAGE_LABEL[filter.stage]} searches`
      : noun.charAt(0).toUpperCase() + noun.slice(1)
  const parts = [lead]
  if (filter.result)
    parts.push(
      filter.result === 'no_overview' ? `with ${words.noneLegend}` : RESULT_TITLE[filter.result]
    )
  else if (filter.work) parts.push('that need work')
  if (filter.page) parts.push(`for ${pathOf(filter.page)}`)
  if (filter.site) parts.push(`citing ${filter.site}`)
  return parts.join(' ')
}

/** The drill's "What to do" card. Mixed results get the general line. */
export function drillWhatToDo(
  filter: SearchFilter,
  nextCheck: string | null = null,
  words: ResultWords = GOOGLE_WORDS
): string {
  if (filter.result) return whatToDo(filter.result, nextCheck, words)
  if (filter.site)
    return `Google trusts ${filter.site} for these. Read what it says, then cover the same points on the target page.`
  return 'Start with the searches that are not cited, highest win odds first.'
}
