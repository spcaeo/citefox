import type { PromptCheckStatus } from '@shared/domain'
import type { AskChip, AskFilters, AskOption } from '@shared/ipc'
import { formatMoment } from '@shared/moment'
import { focusSentence, noMatchText, sitesSentence } from './answer-facts'
import type { AskQueryResult, AskScope, StoredAskRow } from './query'
import { MOVEMENT_WORDS, STAGE_WORDS, STATUS_WORDS } from './vocabulary'

/** The answer when no check has finished yet. Claude is not called for it. */
export const NO_CHECKS_ANSWER = 'Press Check now first — Ask CiteFox only reads saved results.'

/** One chip per filter value, in a fixed field order. */
export function chipsFor(filters: AskFilters, scope: AskScope): AskChip[] {
  const chips: AskChip[] = []
  for (const value of filters.statuses ?? []) {
    chips.push({ field: 'statuses', value, label: STATUS_WORDS[value].label })
  }
  for (const value of filters.movements ?? []) {
    chips.push({ field: 'movements', value, label: MOVEMENT_WORDS[value].label })
  }
  for (const value of filters.marketIds ?? []) {
    chips.push({ field: 'marketIds', value, label: labelOf(scope.markets, value) })
  }
  for (const value of filters.pageIds ?? []) {
    chips.push({ field: 'pageIds', value, label: labelOf(scope.pages, value) })
  }
  for (const value of filters.intentStages ?? []) {
    chips.push({ field: 'intentStages', value, label: `Stage: ${STAGE_WORDS[value].label}` })
  }
  if (filters.citedDomain !== null) {
    chips.push({
      field: 'citedDomain',
      value: filters.citedDomain,
      label: `Cites ${filters.citedDomain}`
    })
  }
  if (filters.text !== null) {
    chips.push({ field: 'text', value: filters.text, label: `Contains: ${filters.text}` })
  }
  return chips
}

/**
 * The plain-words answer, built only from the stored rows. For example:
 * "2 of 4 prompt checks match in UK · EN: your page is not cited for 1 prompt
 * and another of your pages is cited for 1 prompt. Sites cited most in these,
 * besides yours: simpletexting.com (1 of 2). Latest check Oct 19, 2026."
 */
export function answerText(result: AskQueryResult): string {
  if (result.searched === 0) return NO_CHECKS_ANSWER
  const latest =
    result.checkedThrough === null ? '' : ` Latest check ${day(result.checkedThrough)}.`
  if (result.total === 0) return `${noMatchText(result, statusPhrase)}${latest}`
  const where = marketPhrase(result.matched)
  const pages = new Set(result.matched.map((row) => row.pageId)).size
  const parts = [
    `${result.total} of ${count(result.searched, 'prompt check')} match${result.total === 1 ? 'es' : ''}${where}: ${statusPhrase(result.matched)}.`
  ]
  if (pages > 1) parts.push(`They cover ${pages} pages.`)
  const focus = focusSentence(result)
  if (focus !== null) parts.push(focus)
  const sites = sitesSentence(result)
  if (sites !== null) parts.push(sites)
  if (result.total > result.rows.length)
    parts.push(`The table shows the first ${result.rows.length}.`)
  return `${parts.join(' ')}${latest}`
}

const STATUS_ORDER: readonly PromptCheckStatus[] = [
  'not_cited',
  'brand_mentioned',
  'other_own_page',
  'page_cited',
  'no_aio',
  'error'
]

const STATUS_PHRASE: Readonly<Record<PromptCheckStatus, string>> = {
  page_cited: 'your page is cited for',
  other_own_page: 'another of your pages is cited for',
  brand_mentioned: 'your brand is named but your page is not linked for',
  not_cited: 'your page is not cited for',
  no_aio: 'Google shows no AI Overview for',
  error: 'the capture failed for'
}

function statusPhrase(rows: readonly StoredAskRow[]): string {
  const phrases = STATUS_ORDER.flatMap((status) => {
    const n = rows.filter((row) => row.status === status).length
    return n === 0 ? [] : [`${STATUS_PHRASE[status]} ${count(n, 'prompt')}`]
  })
  return joinWords(phrases)
}

function marketPhrase(rows: readonly StoredAskRow[]): string {
  const labels = [...new Set(rows.map((row) => row.marketLabel))]
  if (labels.length === 0) return ''
  if (labels.length <= 3) return ` in ${joinWords(labels)}`
  return ` across ${labels.length} markets`
}

function labelOf(options: readonly AskOption[], id: string): string {
  return options.find((option) => option.id === id)?.label ?? id
}

function count(n: number, noun: string): string {
  return `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`
}

/**
 * "Oct 19, 2026, 3:12 PM": when a check ran, in the computer's own zone and clock
 * (owner rule: an event always shows its time). `options` is for tests.
 */
export function day(iso: string, options: { timeZone?: string; locale?: string } = {}): string {
  if (Number.isNaN(new Date(iso).getTime())) return iso
  return formatMoment(iso, { ...options, year: true })
}
