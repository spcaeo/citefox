import type { PromptCheckRow } from '@shared/domain'
import { hasAio } from '../m3/model'
import type { DrillItem, ListDrill } from './types'

export type PromptFilter = 'all' | 'aio' | 'page' | 'named' | 'gap'

export const PROMPT_FILTERS: readonly { id: PromptFilter; label: string }[] = [
  { id: 'all', label: 'Questions' },
  { id: 'aio', label: 'AI Overview shown' },
  { id: 'page', label: 'Page cited' },
  { id: 'named', label: 'Named' },
  { id: 'gap', label: 'Gap' }
]

export function promptPasses(row: PromptCheckRow, filter: PromptFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'aio':
      return hasAio(row)
    case 'page':
      return row.status === 'page_cited'
    case 'named':
      return row.named === true
    case 'gap':
      return hasAio(row) && row.status !== 'page_cited'
  }
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** One part of the drawer's summary strip: a count that filters the list. */
export interface DrillStatPart {
  id: string
  label: string
  value: number
}

/** The summary strip. Every part counts rows of the drill, so it always adds up to the list. */
export function drillStrip(drill: ListDrill, noun: readonly [string, string]): DrillStatPart[] {
  if (drill.kind === 'prompts') {
    return PROMPT_FILTERS.map((item) => ({
      id: item.id,
      label: item.label,
      value: drill.rows.filter((row) => promptPasses(row, item.id)).length
    }))
  }
  if (!drill.summary || drill.summary.length === 0) return []
  return [
    { id: 'all', label: capital(noun[1]), value: drill.items.length },
    ...drill.summary.map((part) => ({
      id: part.group,
      label: part.label,
      value: drill.items.filter((item) => item.group === part.group).length
    }))
  ]
}

function plain(text: string): string {
  return text.split('**').join('')
}

/** Lower-case text a drawer search matches against. */
export function promptSearchText(row: PromptCheckRow): string {
  return [String(row.promptPosition), plain(row.text), plain(row.label), row.citedUrl ?? '']
    .join(' ')
    .toLowerCase()
}

export function itemSearchText(item: DrillItem): string {
  return [item.primary, item.secondary ?? '', ...Object.values(item.cells ?? {}).map(String)]
    .join(' ')
    .toLowerCase()
}

/** Rows that pass the strip filter and the search, in the drill's order. */
export function shownRows(
  drill: ListDrill,
  filter: string,
  query: string
): { prompts: readonly PromptCheckRow[]; items: readonly DrillItem[] } {
  const needle = query.trim().toLowerCase()
  if (drill.kind === 'prompts') {
    return {
      prompts: drill.rows.filter(
        (row) =>
          promptPasses(row, filter as PromptFilter) &&
          (needle === '' || promptSearchText(row).includes(needle))
      ),
      items: []
    }
  }
  return {
    prompts: [],
    items: drill.items.filter(
      (item) =>
        (filter === 'all' || item.group === filter) &&
        (needle === '' || itemSearchText(item).includes(needle))
    )
  }
}

/** Search shows once a list is long enough to need it. */
export const SEARCH_FROM = 8
