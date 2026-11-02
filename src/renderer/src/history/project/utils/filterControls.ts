import type { Market } from '@shared/domain'
import type { HistorySubject } from '@shared/ipc'
import type { FilterChoice, FilterGroup } from '../../../ui'
import type { ScopeFilter } from '../model'

/** "No filter" in both pickers (a dropdown needs a real value, not ''). */
const ALL = 'all'

/**
 * Check history's Page or topic and Market filters, as the grid's
 * `filterControls` (audit2 #7): their own dropdowns while the toolbar has
 * room, else inside Filter ▾. Each shows only when there is a choice to make.
 */
export function historyFilterControls({
  subjects,
  markets,
  usedMarkets,
  subjectId,
  scope,
  market,
  label,
  onScope,
  onMarket
}: {
  subjects: readonly HistorySubject[]
  markets: readonly Market[]
  usedMarkets: ReadonlySet<string>
  subjectId: string | null
  scope: ScopeFilter
  market: string | null
  label: (market: Market) => string
  onScope: (patch: { scope: string | null; page: string | null }) => void
  onMarket: (market: string | null) => void
}): FilterGroup[] {
  const groups: FilterGroup[] = []
  const pages = subjects.filter((item) => item.kind === 'page')
  const topics = subjects.filter((item) => item.kind === 'topic')
  if (subjects.length > 1) {
    const choices: FilterChoice[] = [{ value: ALL, label: 'All pages and topics' }]
    if (pages.length > 0 && topics.length > 0) {
      choices.push(
        { value: ':pages', label: 'All pages' },
        { value: ':topics', label: 'All topics' }
      )
    }
    pages.forEach((item, index) =>
      choices.push({
        value: item.id,
        label: item.label,
        ...(index === 0 ? { groupLabel: 'Pages' } : {})
      })
    )
    topics.forEach((item, index) =>
      choices.push({
        value: item.id,
        label: item.label,
        ...(index === 0 ? { groupLabel: 'Topics' } : {})
      })
    )
    groups.push({
      id: 'scope',
      label: 'Page or topic',
      value: subjectId ?? (scope === 'all' ? ALL : `:${scope}`),
      resetValue: ALL,
      choices,
      onChange: (value) => {
        if (value === ':pages' || value === ':topics')
          onScope({ scope: value.slice(1), page: null })
        else onScope({ scope: null, page: value === ALL ? null : value })
      }
    })
  }
  if (usedMarkets.size > 1) {
    groups.push({
      id: 'market',
      label: 'Market',
      value: market ?? ALL,
      resetValue: ALL,
      choices: [
        { value: ALL, label: 'All markets' },
        ...markets
          .filter((item) => usedMarkets.has(item.id))
          .map((item) => ({ value: item.id, label: label(item) }))
      ],
      onChange: (value) => onMarket(value === ALL ? null : value)
    })
  }
  return groups
}
