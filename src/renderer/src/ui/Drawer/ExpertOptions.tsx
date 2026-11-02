import { useContext, useId, useState, type JSX, type ReactNode } from 'react'
import { UiIcon } from '../UiIcon'
import { DrawerIdContext } from './context'

const PREFIX = 'citefox.drawer.expert.'

function readOpen(key: string | null): boolean {
  if (key === null) return false
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeOpen(key: string | null, open: boolean): void {
  if (key === null) return
  try {
    if (open) window.localStorage.setItem(key, '1')
    else window.localStorage.removeItem(key)
  } catch {
    // Storage blocked: the fold still works, it just is not remembered.
  }
}

/**
 * "Expert options": closed by default, and remembered per drawer once opened
 * (deep audit §2, board E). Holds the settings most people never change.
 */
export function ExpertOptions({
  children,
  label = 'Expert options',
  summary,
  storageKey
}: {
  children: ReactNode
  label?: string
  /** One line under the label while closed: what is inside. */
  summary?: ReactNode
  /** Override the remembered key (default: the drawer's id). */
  storageKey?: string
}): JSX.Element {
  const drawerId = useContext(DrawerIdContext)
  const key = storageKey ?? (drawerId ? `${PREFIX}${drawerId}` : null)
  const [open, setOpen] = useState(() => readOpen(key))
  const bodyId = useId()
  return (
    <section
      className="ui-drawer-section ui-drawer-span-12 ui-drawer-expert"
      data-open={open || undefined}
    >
      <button
        type="button"
        className="ui-drawer-expert-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen(!open)
          writeOpen(key, !open)
        }}
      >
        <span className="ui-drawer-expert-label">
          {label}
          <UiIcon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        </span>
        {!open && summary ? <span className="ui-drawer-expert-summary">{summary}</span> : null}
      </button>
      <div id={bodyId} hidden={!open} className="ui-drawer-expert-body">
        {children}
      </div>
    </section>
  )
}
