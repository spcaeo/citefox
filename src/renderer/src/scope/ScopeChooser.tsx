import { useId, useMemo, type JSX, type ReactNode } from 'react'
import type { Market } from '@shared/domain'
import { marketLabel } from '../shell/model'
import { ItemPicker } from './ItemPicker'
import { isDue, pageItems, SCOPE_LABELS, scopeNeedsIds, setItems } from './model'
import type { PickerItem, Scope, ScopeKind, ScopeOptions, ScopePage } from './types'
import './scope.css'

export interface ScopeChooserProps {
  options: ScopeOptions
  value: Scope
  onChange: (scope: Scope) => void
  /** The kinds offered, in order. Kinds with nothing to pick are left out. */
  kinds: readonly ScopeKind[]
  /** Legend of the kind list, such as "What to check". */
  legend: string
  /** Pages that cannot be picked, and why ("Not tracked yet"). */
  pageDisabled?: (page: ScopePage) => string | null
  /** Only these pages are listed for `pages` (such as tracked pages for a check). */
  pageFilter?: (page: ScopePage) => boolean
  /** Controlled picker search (on the URL). */
  query?: string
  onQueryChange?: (query: string) => void
  /** Pick one group, cluster, topic or view instead of many. */
  singleSet?: boolean
  /**
   * A choice before the kinds that is not a scope kind, such as Export's "This
   * page". While it is checked no kind is checked and its `children` show
   * instead of the picker.
   */
  leading?: {
    label: string
    checked: boolean
    onSelect: () => void
    count?: number | null
    children?: ReactNode
  }
  /** Another label for a kind, such as Check now's own words. */
  labels?: Partial<Record<ScopeKind, string>>
  /** Another count text for a kind, such as "8 questions". */
  countText?: Partial<Record<ScopeKind, string>>
  now?: Date
  testId?: string
}

/**
 * "What to check / export / report on": a row of scope kinds with their
 * counts, then the searchable picker for the kind that needs ids. Switching
 * kind drops the old ids (a page id is not a group id).
 */
export function ScopeChooser({
  options,
  value,
  onChange,
  kinds,
  legend,
  pageDisabled,
  pageFilter,
  query,
  onQueryChange,
  singleSet = false,
  leading,
  labels,
  countText,
  now,
  testId
}: ScopeChooserProps): JSX.Element {
  const leadingOn = leading?.checked === true
  const name = useId()
  const at = useMemo(() => now ?? new Date(), [now])
  const listedPages = useMemo(
    () => (pageFilter ? options.pages.filter(pageFilter) : options.pages),
    [options.pages, pageFilter]
  )
  const counts: Record<ScopeKind, number | null> = {
    due: options.pages.filter((page) => isDue(page, at)).length,
    tracked: options.pages.filter((page) => page.tracked).length,
    all: null,
    project: null,
    pages: listedPages.length,
    group: options.groups.length,
    cluster: options.clusters.length,
    topic: options.topics.length,
    view: options.views.length
  }
  const offered = kinds.filter((kind) => !scopeNeedsIds(kind) || (counts[kind] ?? 0) > 0)

  const items = useMemo<PickerItem[]>(() => {
    switch (value.kind) {
      case 'pages':
        return pageItems(listedPages, pageDisabled ?? null)
      case 'group':
        return setItems(options.groups)
      case 'cluster':
        return setItems(options.clusters)
      case 'topic':
        return setItems(options.topics)
      case 'view':
        return setItems(options.views)
      default:
        return []
    }
  }, [value.kind, listedPages, pageDisabled, options])

  const nouns: Record<ScopeKind, readonly [string, string]> = {
    due: ['page', 'pages'],
    tracked: ['page', 'pages'],
    all: ['page', 'pages'],
    project: ['page', 'pages'],
    pages: ['page', 'pages'],
    group: ['group', 'groups'],
    cluster: ['cluster', 'clusters'],
    topic: ['topic', 'topics'],
    view: ['saved view', 'saved views']
  }

  return (
    <div className="sc-chooser" data-testid={testId}>
      <fieldset className="sc-kinds">
        <legend className="sr-only">{legend}</legend>
        {leading ? (
          <label className="sc-kind" data-kind="leading">
            <input type="radio" name={name} checked={leadingOn} onChange={leading.onSelect} />
            <span>{leading.label}</span>
            {leading.count === undefined || leading.count === null ? null : (
              <span className="sc-kind-count">{leading.count.toLocaleString('en-US')}</span>
            )}
          </label>
        ) : null}
        {offered.map((kind) => {
          const count = counts[kind]
          return (
            <label key={kind} className="sc-kind" data-kind={kind}>
              <input
                type="radio"
                name={name}
                value={kind}
                checked={!leadingOn && value.kind === kind}
                onChange={() => onChange({ kind, ids: [] })}
              />
              <span>{labels?.[kind] ?? SCOPE_LABELS[kind]}</span>
              {countText?.[kind] !== undefined ? (
                <span className="sc-kind-count">{countText[kind]}</span>
              ) : count === null ? null : (
                <span className="sc-kind-count">{count.toLocaleString('en-US')}</span>
              )}
            </label>
          )
        })}
      </fieldset>
      {leadingOn ? (
        (leading?.children ?? null)
      ) : scopeNeedsIds(value.kind) ? (
        <ItemPicker
          label={`${SCOPE_LABELS[value.kind]}: pick`}
          items={items}
          selected={value.ids}
          onChange={(ids) => onChange({ kind: value.kind, ids })}
          single={value.kind !== 'pages' && singleSet}
          noun={nouns[value.kind]}
          site={options.domain}
          {...(query !== undefined ? { query } : {})}
          {...(onQueryChange ? { onQueryChange } : {})}
          testId={testId ? `${testId}-picker` : undefined}
        />
      ) : null}
    </div>
  )
}

/** Market chips: every market of the project, toggled on and off. Empty means all. */
export function MarketChips({
  markets,
  selected,
  onChange,
  legend = 'Markets'
}: {
  markets: readonly Market[]
  /** Picked market ids. Empty is "every market". */
  selected: readonly string[]
  onChange: (ids: string[]) => void
  legend?: string
}): JSX.Element {
  const all = selected.length === 0
  return (
    <fieldset className="sc-chips" data-testid="market-chips">
      <legend className="sr-only">{legend}</legend>
      <label className="sc-kind">
        <input type="checkbox" checked={all} onChange={() => onChange([])} />
        <span>All markets</span>
      </label>
      {markets.map((market) => {
        const on = selected.includes(market.id)
        return (
          <label key={market.id} className="sc-kind">
            <input
              type="checkbox"
              checked={on}
              onChange={() =>
                onChange(on ? selected.filter((id) => id !== market.id) : [...selected, market.id])
              }
            />
            <span>{marketLabel(market)}</span>
          </label>
        )
      })}
    </fieldset>
  )
}
