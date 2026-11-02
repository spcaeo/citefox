import { Fragment, useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { UiIcon, type UiIconName } from '../../ui'

export interface SectionMenuLine {
  id: string
  label: string
  icon?: UiIconName
  /** A ✦ action: the icon is drawn in fox. */
  ai?: boolean
  hint?: string
  groupStart?: boolean
  onSelect: () => void
}

/**
 * The one ⋯ AI menu of a section card. Its open state lives in the URL
 * (`?open=<section>.menu`), so it is a controlled menu: the card says whether
 * it is open. Arrows, Home and End move; Escape closes and returns focus to
 * ⋯; Tab or a press outside closes. It sits under the card head (mock-up
 * panel 8) rather than floating, so it scrolls with the card.
 */
export function SectionAiMenu({
  label,
  open,
  lines,
  footer,
  onToggle,
  onClose
}: {
  /** "AI actions for Buyers". */
  label: string
  open: boolean
  lines: readonly SectionMenuLine[]
  /** The cost line under the items. */
  footer: string
  onToggle: () => void
  onClose: () => void
}): JSX.Element {
  const menuId = useId()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [active, setActive] = useState(0)
  const wasOpen = useRef(open)

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus({ preventScroll: true })
  }, [open, active])

  useEffect(() => {
    // Back (or Escape) closed it while focus was inside: give focus back to ⋯.
    if (wasOpen.current && !open && menuRef.current === null) {
      const focused = document.activeElement
      if (focused === null || focused === document.body) buttonRef.current?.focus()
    }
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent): void {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open, onClose])

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>): void {
    const count = lines.length
    let next: number | null = null
    if (event.key === 'ArrowDown') next = (active + 1) % count
    else if (event.key === 'ArrowUp') next = (active - 1 + count) % count
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      buttonRef.current?.focus()
      return
    } else if (event.key === 'Tab') {
      onClose()
      return
    }
    if (next === null) return
    event.preventDefault()
    setActive(next)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`ui-icon-btn ui-icon-btn-sm osc-dots${open ? ' osc-on' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-tip={label}
        onClick={() => {
          setActive(0)
          onToggle()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setActive(0)
            onToggle()
          }
        }}
      >
        <UiIcon name="dots" size={16} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="ui-menu osc-menu"
          onKeyDown={onMenuKey}
        >
          {lines.map((line, index) => (
            <Fragment key={line.id}>
              {line.groupStart && index > 0 ? (
                <div role="separator" className="ui-menu-sep" />
              ) : null}
              <button
                ref={(node) => {
                  itemRefs.current[index] = node
                }}
                type="button"
                role="menuitem"
                tabIndex={index === active ? 0 : -1}
                className={`ui-menu-item${line.ai ? ' ui-menu-ai' : ''}`}
                data-testid={`menu-${line.id}`}
                onClick={line.onSelect}
                onMouseEnter={() => setActive(index)}
              >
                {line.icon ? <UiIcon name={line.icon} /> : <span className="osc-menu-gap" />}
                <span className="ui-menu-label">{line.label}</span>
                {line.hint ? <span className="ui-menu-hint">{line.hint}</span> : null}
              </button>
            </Fragment>
          ))}
          <p className="ui-menu-foot">{footer}</p>
        </div>
      ) : null}
    </>
  )
}
