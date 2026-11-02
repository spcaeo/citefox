import {
  QUESTION_CHANGES,
  QUESTION_RESULTS,
  type QuestionChange,
  type QuestionResult,
  type QuestionsList
} from '@shared/ipc'
import type { FilterChoice, FilterGroup } from '../ui'
import { CHANGE_LABEL, RESULT_LABEL, sourceLabel, type QuestionsView } from './model'

/** The From filter folds kind and one source into one value: `all`, `kind:page`, `source:<id>`. */
export function fromValue(view: QuestionsView): string {
  if (view.source !== null) return `source:${view.source}`
  if (view.kind !== null) return `kind:${view.kind}`
  return 'all'
}

export function fromPatch(value: string): Pick<QuestionsView, 'kind' | 'source'> {
  if (value.startsWith('source:')) return { kind: null, source: value.slice('source:'.length) }
  if (value === 'kind:page' || value === 'kind:topic') {
    return { kind: value === 'kind:page' ? 'page' : 'topic', source: null }
  }
  return { kind: null, source: null }
}

/**
 * Market, with more than one market: its own dropdown in the list toolbar
 * while the row has room, else inside Filter ▾ (audit2 #7, the grid's
 * `filterControls`). The default market is "no filter". Null with one market.
 */
export function questionMarketGroup(
  list: QuestionsList,
  onChange: (patch: Partial<QuestionsView>) => void
): FilterGroup | null {
  if (list.markets.length <= 1) return null
  const fallback = list.markets.find((market) => market.isDefault) ?? list.markets[0]
  return {
    id: 'market',
    label: 'Market',
    value: list.marketId ?? fallback?.id ?? '',
    resetValue: fallback?.id ?? '',
    choices: list.markets.map((market) => ({ value: market.id, label: market.label })),
    onChange: (id) => {
      const picked = list.markets.find((market) => market.id === id)
      onChange({ market: picked === undefined || picked.isDefault ? null : picked.id })
    }
  }
}

/**
 * The Questions list's filters, for the grid's one Filter ▾ button (audit2 #7):
 * From (a page, a topic, or every page or topic), Type (question or keyword,
 * when there are keywords), and Google's Result and Change. Counts are over
 * every question, before any filter.
 */
export function questionFilterGroups(
  list: QuestionsList,
  view: QuestionsView,
  onChange: (patch: Partial<QuestionsView>) => void,
  googleFilters = true
): FilterGroup[] {
  const { facets } = list
  const total = list.rows.length
  const topics = list.sources.filter((source) => source.kind === 'topic')
  const pages = list.sources.filter((source) => source.kind === 'page')
  const from: FilterChoice[] = [{ value: 'all', label: 'All', count: total }]
  if (facets.kind.topic > 0)
    from.push({ value: 'kind:topic', label: 'Every topic', count: facets.kind.topic })
  if (facets.kind.page > 0)
    from.push({ value: 'kind:page', label: 'Every page', count: facets.kind.page })
  topics.forEach((source, index) =>
    from.push({
      value: `source:${source.id}`,
      label: source.name,
      count: facets.source[source.id] ?? 0,
      ...(index === 0 ? { groupLabel: 'Topics' } : {})
    })
  )
  pages.forEach((source, index) =>
    from.push({
      value: `source:${source.id}`,
      label: sourceLabel(source),
      count: facets.source[source.id] ?? 0,
      ...(index === 0 ? { groupLabel: 'Pages' } : {})
    })
  )
  const groups: FilterGroup[] = [
    {
      id: 'from',
      label: 'From',
      value: fromValue(view),
      resetValue: 'all',
      choices: from,
      onChange: (value) => onChange(fromPatch(value))
    }
  ]
  const keywords = list.rows.filter((row) => row.promptKind === 'keyword').length
  if (keywords > 0 || view.type !== null) {
    groups.push({
      id: 'type',
      label: 'Type',
      value: view.type ?? 'all',
      resetValue: 'all',
      choices: [
        { value: 'all', label: 'All', count: total },
        { value: 'question', label: 'Questions', count: total - keywords },
        { value: 'keyword', label: 'Keywords', count: keywords }
      ],
      onChange: (value) =>
        onChange({ type: value === 'question' || value === 'keyword' ? value : null })
    })
  }
  if (!googleFilters) return groups
  groups.push(
    {
      id: 'result',
      label: 'Result',
      value: view.result ?? 'all',
      resetValue: 'all',
      choices: [
        { value: 'all', label: 'All', count: total },
        ...QUESTION_RESULTS.filter(
          (result) => facets.result[result] > 0 || view.result === result
        ).map((result) => ({
          value: result,
          label: RESULT_LABEL[result],
          count: facets.result[result]
        }))
      ],
      onChange: (value) => onChange({ result: value === 'all' ? null : (value as QuestionResult) })
    },
    {
      id: 'change',
      label: 'Change',
      value: view.change ?? 'all',
      resetValue: 'all',
      choices: [
        { value: 'all', label: 'All', count: total },
        ...QUESTION_CHANGES.filter((change) => change !== 'none').map((change) => ({
          value: change,
          label: CHANGE_LABEL[change],
          count: facets.change[change]
        }))
      ],
      onChange: (value) => onChange({ change: value === 'all' ? null : (value as QuestionChange) })
    }
  )
  return groups
}
