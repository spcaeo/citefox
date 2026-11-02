import type { InputHTMLAttributes, JSX, ReactNode, Ref } from 'react'
import { IconButton } from './IconButton'
import { MenuButton, type MenuItem } from './Menu'
import { TOOL_KINDS, type ToolKind } from './toolKinds'
import { UiIcon } from './UiIcon'

/**
 * The standard tool pieces (Docs/DESIGN-GUIDELINES.md): every screen draws search,
 * filters, exports and the small tool actions with these, so they look and sit the
 * same everywhere. Tool actions are icons with a tooltip; only an area's main action
 * has a word.
 */

/** One tool action: its standard icon and name (the name is the tooltip and the button's name). */
export function ToolButton({
  kind,
  label,
  onClick,
  disabled = false,
  busy = false,
  className
}: {
  kind: ToolKind
  /** A more exact name ("Copy all URLs"); default: the kind's name. */
  label?: string
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  className?: string
}): JSX.Element {
  const tool = TOOL_KINDS[kind]
  const name = label ?? tool.label
  return (
    <IconButton
      icon={tool.icon}
      size="sm"
      tip
      label={busy ? `${name}: working…` : name}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={className}
    />
  )
}

/** A row of tool icons, always with the same spacing; goes before ⋯ and the main action. */
export function ToolGroup({
  label = 'Tools',
  children,
  className
}: {
  label?: string
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div role="group" aria-label={label} className={['ui-tools', className ?? ''].join(' ').trim()}>
      {children}
    </div>
  )
}

/**
 * The one export control: the download icon opening a menu of formats (Offline HTML,
 * PDF, CSV tables…). The items carry the words; the trigger is only the icon.
 */
export function ExportMenu({
  items,
  label = 'Download',
  busy = false,
  width = 260
}: {
  items: readonly MenuItem[]
  label?: string
  busy?: boolean
  width?: number
}): JSX.Element {
  return (
    <MenuButton
      label={label}
      items={[...items]}
      width={width}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className="ui-icon-btn ui-icon-btn-sm"
          aria-label={busy ? 'Saving…' : label}
          data-tip={label}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          <UiIcon name="download" size={16} />
        </button>
      )}
    />
  )
}

/** The one search box: a search icon, a placeholder that names what is searched. */
export function SearchBox({
  label,
  value,
  onChange,
  onEnter,
  className,
  inputProps,
  inputRef
}: {
  /** What is searched ("Search questions, sites, pages"): the placeholder and the box's name. */
  label: string
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
  className?: string
  /** Extra input attributes (a results list's aria-controls, its own keys). */
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'>
  /** The input itself, for a screen that focuses it. */
  inputRef?: Ref<HTMLInputElement>
}): JSX.Element {
  return (
    <label className={['ui-search', className ?? ''].join(' ').trim()}>
      <span className="sr-only">{label}</span>
      <span className="ui-search-icon" aria-hidden="true">
        <UiIcon name="search" />
      </span>
      <input
        ref={inputRef}
        type="search"
        className="ui-search-input"
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...inputProps}
        onKeyDown={(event) => {
          inputProps?.onKeyDown?.(event)
          if (event.key === 'Enter' && onEnter) onEnter()
        }}
      />
    </label>
  )
}

/**
 * The one filters row: pickers on the left, then (on the right of the same row) the
 * search box and any tool icons. The left side wraps when it must; the right side
 * never moves to a row of its own.
 */
export function FilterBar({
  children,
  end,
  label = 'Filters'
}: {
  /** Pickers and filter controls, left to right. */
  children: ReactNode
  /** Search and tools, on the right. */
  end?: ReactNode
  label?: string
}): JSX.Element {
  return (
    <div className="ui-filterbar" role="group" aria-label={label}>
      <div className="ui-filterbar-start">{children}</div>
      {end ? <div className="ui-filterbar-end">{end}</div> : null}
    </div>
  )
}
