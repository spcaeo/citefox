import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { addMenuEntries } from '../shell/addMenu'
import { UiIcon } from '../ui/UiIcon'
import { Icon } from './Icon'

/**
 * The sidebar's primary + Add button: a disclosure over a short list of links.
 * Escape closes it and puts focus back on the button; a press outside or
 * picking a link closes it too. In the icon rail the button shows only its
 * plus and the list opens beside the rail.
 */
export function SidebarAddMenu({
  foundPageCount,
  collapsed = false
}: {
  foundPageCount: number
  collapsed?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const currentHash = typeof window === 'undefined' ? '' : window.location.hash

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent): void {
      if (wrapRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="side-add" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="side-add-btn"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={collapsed ? 'Add' : undefined}
        data-tip={collapsed ? 'Add' : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="plus" size="nav" />
        <span className="side-add-text">Add</span>
        <UiIcon name={open ? 'chevron-up' : 'chevron-down'} size={14} className="side-add-chev" />
      </button>
      <ul id={listId} className="side-add-menu" aria-label="Add" hidden={!open}>
        {addMenuEntries(currentHash, foundPageCount).map((entry, index, all) => (
          <li key={entry.id}>
            {entry.fromFile && !all[index - 1]?.fromFile ? (
              <span className="side-add-heading" aria-hidden="true">
                Import
              </span>
            ) : null}
            <a
              className="side-add-item"
              href={entry.href}
              aria-label={entry.fromFile ? `Import: ${entry.label}` : entry.label}
              aria-describedby={`${listId}-${entry.id}`}
              onClick={() => setOpen(false)}
            >
              <Icon name={entry.icon} size="nav" />
              <span className="side-add-label">{entry.label}</span>
              <span className="side-add-hint" id={`${listId}-${entry.id}`}>
                {entry.hint}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
