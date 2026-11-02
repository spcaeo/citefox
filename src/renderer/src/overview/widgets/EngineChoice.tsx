import type { JSX } from 'react'
import { ENGINE_LABEL, ENGINE_SHORT_LABEL, type EngineId } from '@shared/domain'
import type { WidgetEngine } from '@shared/summary-board'
import { EngineFixed } from '../../engines/EngineDots'
import { EngineLogo } from '../../engines/EngineLogo'
import { MenuButton, SegmentedControl, UiIcon } from '../../ui'

/**
 * A widget's own engine filter (owner-approved mock-up): All, then each engine the
 * project checks as its logo alone. A small widget has no room for the row, so it shows
 * the picked logo and opens a menu. With one engine only, its logo stands fixed.
 */
export function EngineChoice({
  engines,
  value,
  onChange,
  title,
  compact = false
}: {
  engines: readonly EngineId[]
  value: WidgetEngine
  onChange: (value: WidgetEngine) => void
  /** The widget's name, for the control's accessible name. */
  title: string
  compact?: boolean
}): JSX.Element | null {
  const first = engines[0]
  if (engines.length < 2) return first ? <EngineFixed engine={first} /> : null
  const label = `Engine for ${title}`
  if (compact) {
    const name = value === 'all' ? 'All engines' : ENGINE_LABEL[value]
    return (
      <MenuButton
        label={label}
        width={220}
        items={[
          {
            id: 'all',
            label: 'All engines',
            checked: value === 'all',
            onSelect: () => onChange('all')
          },
          ...engines.map((engine) => ({
            id: engine,
            label: ENGINE_LABEL[engine],
            checked: value === engine,
            onSelect: () => onChange(engine)
          }))
        ]}
        trigger={(props) => (
          <button
            type="button"
            {...props}
            className="wb-engine-btn"
            aria-label={`${label}: ${name}`}
            data-tip={name}
          >
            {value === 'all' ? (
              <span className="wb-engine-all">All</span>
            ) : (
              <EngineLogo engine={value} size={16} className="eng-filter-logo" />
            )}
            <UiIcon name="chevron-down" size={12} />
          </button>
        )}
      />
    )
  }
  return (
    <div className="eng-filter wb-engine">
      <SegmentedControl<WidgetEngine>
        label={label}
        size="sm"
        value={value}
        options={[
          { value: 'all', label: 'All' },
          ...engines.map((engine) => ({
            value: engine,
            label: ENGINE_SHORT_LABEL[engine],
            icon: <EngineLogo engine={engine} size={16} className="eng-filter-logo" />,
            iconOnly: true
          }))
        ]}
        onChange={onChange}
      />
    </div>
  )
}
