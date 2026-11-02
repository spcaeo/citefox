import type { JSX, ReactNode } from 'react'
import { Tabs, type TabItem } from './Tabs'
import { UiIcon, type UiIconName } from './UiIcon'
import { VIEW_ICONS, VIEW_LABELS, type ScreenView } from './viewTabsModel'

/** One view tab. A known view id needs nothing else; another id names its label and icon. */
export interface ViewTabItem<V extends string> {
  id: V
  /** Default: the shared word for a known view ("Tree"), else the id. */
  label?: string
  /** Default: the shared icon for a known view. */
  icon?: UiIconName
  count?: number
}

export interface ViewTabsProps<V extends string> {
  /** The views, in order: `['tree', 'grid', 'list', 'pages']`. */
  views: readonly (V | ViewTabItem<V>)[]
  /** One view after a thin rule, such as Progress. */
  trailing?: V | ViewTabItem<V> | null
  value: V
  onChange: (view: V) => void
  /** Each view's URL (`useScreenView().hrefFor`), so a tab can be copied or opened. */
  hrefFor?: (view: V) => string
  /** Accessible name of the tab row. Default "Views". */
  label?: string
  /** Right-hand note. Default none: the view is still remembered, it just doesn't say so (owner 2026-10-30). */
  note?: ReactNode
  /** Id prefix of the view panels (see `Tabs`). */
  panelId?: string
  className?: string
}

function item<V extends string>(view: V | ViewTabItem<V>): ViewTabItem<V> {
  return typeof view === 'string' ? { id: view } : view
}

function known(id: string): id is ScreenView {
  return Object.prototype.hasOwnProperty.call(VIEW_LABELS, id)
}

function toTab<V extends string>(
  view: ViewTabItem<V>,
  hrefFor: ((view: V) => string) | undefined,
  divider: boolean
): TabItem<V> {
  const icon = view.icon ?? (known(view.id) ? VIEW_ICONS[view.id] : undefined)
  return {
    id: view.id,
    label: view.label ?? (known(view.id) ? VIEW_LABELS[view.id] : view.id),
    ...(icon ? { lead: <UiIcon name={icon} /> } : {}),
    ...(view.count !== undefined ? { count: view.count } : {}),
    ...(hrefFor ? { href: hrefFor(view.id) } : {}),
    ...(divider ? { divider: true } : {})
  }
}

/**
 * The one view switcher (TopicBig "Tree · Grid · List · Pages | Progress"):
 * icon tabs on a rule, an optional trailing tab after a thin divider, and an
 * optional note on the right. Pair it with `useScreenView`, which
 * keeps the view in the URL (`?view=grid`) and remembers it per project and
 * screen. Keys and roles are the shared `Tabs`.
 */
export function ViewTabs<V extends string>({
  views,
  trailing,
  value,
  onChange,
  hrefFor,
  label = 'Views',
  note = null,
  panelId,
  className
}: ViewTabsProps<V>): JSX.Element {
  const tabs = views.map((view) => toTab(item(view), hrefFor, false))
  if (trailing) tabs.push(toTab(item(trailing), hrefFor, true))
  return (
    <div className={['ui-viewtabs', className ?? ''].filter(Boolean).join(' ')}>
      <Tabs
        label={label}
        tabs={tabs}
        value={value}
        onChange={onChange}
        {...(panelId ? { panelId } : {})}
      />
      {note !== null ? <span className="ui-viewtabs-note">{note}</span> : null}
    </div>
  )
}
