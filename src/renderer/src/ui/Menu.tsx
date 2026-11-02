import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { UiIcon, type UiIconName } from './UiIcon'

/** One line in a menu (Theme.dc.html `menu-item`). */
export interface MenuItem {
  id: string
  label: string
  /** A fuller accessible name when the group gives the label its meaning ("Theme: Light"). */
  ariaLabel?: string
  icon?: UiIconName
  /** Right-hand hint, such as a time estimate ("15 s"). */
  hint?: string
  /** `ai` draws the icon in fox (a Claude action); `danger` is red (Remove); `ok` draws the icon green (Copied). */
  tone?: 'default' | 'ai' | 'danger' | 'ok'
  disabled?: boolean
  /** The menu stays open after this item runs (Copy, whose tick shows in place). */
  keepOpen?: boolean
  /** Draws a separator line above this item (starts a new group). */
  groupStart?: boolean
  /** A small label above this item that names its group, such as "Theme". Not focusable. */
  groupLabel?: string
  /**
   * One choice of a set, such as Light / Dark / System: the item becomes a
   * `menuitemradio` and shows a tick while `true`.
   */
  checked?: boolean
  onSelect: () => void
}

/** What a trigger needs to spread on its `<button>`. */
export interface MenuTriggerProps {
  ref: RefObject<HTMLButtonElement | null>
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls': string | undefined
  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

export interface MenuButtonProps {
  /** Accessible name of the menu, such as "AI actions" or "Actions for Q6". */
  label: string
  items: readonly MenuItem[]
  /** Renders the button that opens the menu. Spread `props` on a `<button>`. */
  trigger: (props: MenuTriggerProps, open: boolean) => ReactNode
  /** A line under the items, such as "Runs on your Claude plan. Uses no searches." */
  footer?: ReactNode
  /** Facts above the items, such as the app version and build. Not focusable. */
  header?: ReactNode
  /** Which edge of the trigger the menu lines up with. Default `end`. */
  align?: 'start' | 'end'
  /** Menu width in pixels. Default 232. */
  width?: number
  /** Told when the menu opens or closes (rows raise themselves while open). */
  onOpenChange?: (open: boolean) => void
}

const GAP = 6
const EDGE = 8

function enabledIndexes(items: readonly MenuItem[]): number[] {
  return items.flatMap((item, index) => (item.disabled ? [] : [index]))
}

/**
 * A button that opens a menu (WAI-ARIA menu button). Enter, Space or ArrowDown
 * open it on the first item, ArrowUp on the last; arrows, Home and End move;
 * Escape or Tab closes and focus returns to the button; a press outside closes.
 * The menu is fixed-positioned under the button so a scrolling grid never clips it.
 */
export function MenuButton({
  label,
  items,
  trigger,
  footer,
  header,
  align = 'end',
  width = 232,
  onOpenChange
}: MenuButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<CSSProperties>({})
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()
  const enabled = enabledIndexes(items)

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange]
  )

  const close = useCallback(
    (refocus: boolean) => {
      setOpenState(false)
      if (refocus) buttonRef.current?.focus()
    },
    [setOpenState]
  )

  function openAt(which: 'first' | 'last'): void {
    if (enabled.length === 0) return
    setActive((which === 'first' ? enabled[0] : enabled[enabled.length - 1]) ?? 0)
    setOpenState(true)
  }

  /** Puts the menu under (or over) the button. False when the button is out of view. */
  const reposition = useCallback((): boolean => {
    const box = buttonRef.current?.getBoundingClientRect()
    if (!box) return true
    if (box.bottom < 0 || box.top > window.innerHeight) return false
    const height = menuRef.current?.offsetHeight ?? 0
    const below = window.innerHeight - box.bottom
    const top =
      below < height + GAP + EDGE && box.top > height + GAP
        ? box.top - GAP - height
        : box.bottom + GAP
    const left =
      align === 'end'
        ? Math.max(EDGE, Math.min(box.right - width, window.innerWidth - width - EDGE))
        : Math.max(EDGE, Math.min(box.left, window.innerWidth - width - EDGE))
    setPlace({ top, left, width })
    return true
  }, [align, width])

  useLayoutEffect(() => {
    if (open) reposition()
  }, [open, reposition])

  useEffect(() => {
    // preventScroll: focusing must not scroll a grid, which would move the menu away.
    if (open) itemRefs.current[active]?.focus({ preventScroll: true })
  }, [open, active])

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent | MouseEvent): void {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      close(false)
    }
    // A scroll or resize moves the menu with its button; it closes only when the
    // button leaves the window.
    function onMove(event: Event): void {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      if (!reposition()) close(false)
    }
    document.addEventListener('mousedown', onPointer)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, close, reposition])

  function onTriggerKey(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openAt('first')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openAt('last')
    }
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>): void {
    const at = enabled.indexOf(active)
    let next: number | undefined
    if (event.key === 'ArrowDown') next = enabled[(at + 1) % enabled.length]
    else if (event.key === 'ArrowUp') next = enabled[(at - 1 + enabled.length) % enabled.length]
    else if (event.key === 'Home') next = enabled[0]
    else if (event.key === 'End') next = enabled[enabled.length - 1]
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    } else if (event.key === 'Tab') {
      close(false)
      return
    }
    if (next === undefined) return
    event.preventDefault()
    setActive(next)
  }

  function choose(item: MenuItem): void {
    if (item.disabled) return
    if (!item.keepOpen) close(true)
    item.onSelect()
  }

  return (
    <span className="ui-menu-wrap">
      {trigger(
        {
          ref: buttonRef,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-controls': open ? menuId : undefined,
          onClick: () => (open ? close(false) : openAt('first')),
          onKeyDown: onTriggerKey
        },
        open
      )}
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="ui-menu"
          style={place}
          onKeyDown={onMenuKey}
        >
          {header ? <div className="ui-menu-head">{header}</div> : null}
          {items.map((item, index) => (
            <Fragment key={item.id}>
              {item.groupStart && index > 0 ? (
                <div role="separator" className="ui-menu-sep" />
              ) : null}
              {item.groupLabel ? (
                <p className="ui-menu-group" aria-hidden="true">
                  {item.groupLabel}
                </p>
              ) : null}
              <button
                ref={(node) => {
                  itemRefs.current[index] = node
                }}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                aria-label={item.ariaLabel}
                tabIndex={index === active ? 0 : -1}
                aria-disabled={item.disabled || undefined}
                className={`ui-menu-item${item.tone === 'danger' ? ' ui-menu-danger' : ''}${item.tone === 'ai' ? ' ui-menu-ai' : ''}${item.tone === 'ok' ? ' ui-menu-ok' : ''}`}
                onClick={() => choose(item)}
                onMouseEnter={() => {
                  if (!item.disabled) setActive(index)
                }}
              >
                {item.icon ? <UiIcon name={item.icon} /> : null}
                <span className="ui-menu-label">{item.label}</span>
                {item.hint ? <span className="ui-menu-hint num">{item.hint}</span> : null}
                {item.checked ? <UiIcon name="check" className="ui-menu-check" /> : null}
              </button>
            </Fragment>
          ))}
          {footer ? <p className="ui-menu-foot">{footer}</p> : null}
        </div>
      ) : null}
    </span>
  )
}
