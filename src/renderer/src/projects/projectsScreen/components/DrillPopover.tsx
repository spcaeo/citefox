import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../components/Icon'
import { useDialog } from '../../../components/useDialog'
import { useTextLabel } from '../hooks/useTextLabel'

/**
 * A number or value that opens a small popover of what is behind it
 * (REPORT-SPEC "Interaction model"), in the status popover's look. Used
 * where the rows open another project's page (through a project route) or a
 * project-level place, outside the page-scoped drill drawer. Tab stays inside while it is open,
 * Escape or a click outside closes it, and focus returns to the opener.
 */
export function DrillPopover({
  children,
  label,
  title,
  subtitle,
  body,
  foot,
  className = 'drill-num',
  align = 'start'
}: {
  /** The opener's content: the number or value as it reads on the screen. */
  children: ReactNode
  /** Accessible name of the opener, such as "Avg score 41: show page scores". */
  label: string
  title: string
  subtitle?: ReactNode
  /** The popover body. `close` closes it, for rows that navigate. */
  body: (close: () => void) => ReactNode
  foot?: (close: () => void) => ReactNode
  className?: string
  /** Which edge of the opener the popover lines up with. */
  align?: 'start' | 'end'
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLSpanElement>(null)
  const [ariaLabel, attach] = useTextLabel<HTMLButtonElement>(label)
  return (
    <span className="dpop-wrap" ref={wrap}>
      <button
        ref={attach}
        type="button"
        className={className}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-pop` : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {children}
      </button>
      {open ? (
        <Panel
          id={id}
          wrap={wrap}
          title={title}
          subtitle={subtitle}
          align={align}
          onClose={() => setOpen(false)}
          body={body}
          foot={foot}
        />
      ) : null}
    </span>
  )
}

type Placement =
  | { top: number; left: number; maxHeight: number }
  | { bottom: number; left: number; maxHeight: number }

function Panel({
  id,
  wrap,
  title,
  subtitle,
  align,
  onClose,
  body,
  foot
}: {
  id: string
  wrap: RefObject<HTMLSpanElement | null>
  title: string
  subtitle: ReactNode
  align: 'start' | 'end'
  onClose: () => void
  body: (close: () => void) => ReactNode
  foot: ((close: () => void) => ReactNode) | undefined
}): JSX.Element {
  const dialog = useDialog<HTMLElement>({ onClose })
  const [place, setPlace] = useState<Placement | null>(null)
  // Fixed to the viewport, so a scrolling table or card never clips it.
  useLayoutEffect(() => {
    function measure(): void {
      const anchor = wrap.current?.getBoundingClientRect()
      const width = dialog.current?.offsetWidth ?? 380
      if (!anchor) return
      const room = window.innerWidth - width - 16
      const left = align === 'end' ? anchor.right - width : anchor.left
      const x = Math.max(16, Math.min(left, room))
      const below = window.innerHeight - anchor.bottom - 22
      // Near the bottom (the sidebar foot), open upwards.
      if (below < 200 && anchor.top > below) {
        setPlace({
          bottom: window.innerHeight - anchor.top + 6,
          left: x,
          maxHeight: Math.max(160, anchor.top - 22)
        })
      } else {
        setPlace({ top: anchor.bottom + 6, left: x, maxHeight: Math.max(160, below) })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [wrap, dialog, align])
  useEffect(() => {
    function outside(event: MouseEvent): void {
      const node = wrap.current
      if (!node || !(event.target instanceof Node)) return
      if (node.contains(event.target) || dialog.current?.contains(event.target)) return
      onClose()
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [wrap, dialog, onClose])
  // On the body, so it never nests inside a KPI tile's text or a grid row's cell.
  return createPortal(
    <section
      ref={dialog}
      id={`${id}-pop`}
      className="dpop"
      style={place ?? undefined}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
    >
      <div className="pop-head">
        <div className="stack-tight">
          <h2 id={`${id}-title`} className="dpop-title">
            {title}
          </h2>
          {subtitle ? <span className="faint">{subtitle}</span> : null}
        </div>
        <button
          type="button"
          className="icon-btn"
          data-autofocus
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          <Icon name="x" size="nav" />
        </button>
      </div>
      <div className="dpop-body">{body(onClose)}</div>
      {foot ? <div className="pop-foot">{foot(onClose)}</div> : null}
    </section>,
    document.body
  )
}

/** One row of a popover list: a label, a value, and an optional second line. */
export interface PopoverRow {
  id: string
  label: string
  value: string
  detail?: string
  /** Opens the row (navigates). Absent: the row is plain text. */
  onOpen?: () => void
  /** Accessible name of the row button. */
  openLabel?: string
}

/** A list of rows inside a popover. Rows with `onOpen` are buttons. */
export function PopoverList({
  rows,
  close,
  label,
  empty = 'Nothing to show yet.'
}: {
  rows: readonly PopoverRow[]
  close: () => void
  label: string
  empty?: string
}): JSX.Element {
  if (rows.length === 0) return <p className="faint">{empty}</p>
  return (
    <ul className="dpop-list" aria-label={label}>
      {rows.map((row) => {
        const inner = (
          <>
            <span className="dpop-row-main">
              <span className="dpop-row-label">{row.label}</span>
              {row.detail ? <span className="faint dpop-row-detail">{row.detail}</span> : null}
            </span>
            <span className="mono dpop-row-value">{row.value}</span>
          </>
        )
        return (
          <li key={row.id}>
            {row.onOpen ? (
              <RowButton
                label={row.openLabel}
                onClick={() => {
                  close()
                  row.onOpen?.()
                }}
              >
                {inner}
              </RowButton>
            ) : (
              <span className="dpop-row dpop-row-plain">{inner}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** A popover row that opens something. Its name starts with the row's visible text. */
function RowButton({
  label,
  onClick,
  children
}: {
  label: string | undefined
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  const [ariaLabel, attach] = useTextLabel<HTMLButtonElement>(label)
  return (
    <button
      ref={attach}
      type="button"
      className="dpop-row"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
