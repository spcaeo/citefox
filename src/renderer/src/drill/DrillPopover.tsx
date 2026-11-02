import { useEffect, useId, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react'
import { useDialog } from '../components/useDialog'

const WIDTH = 300

/**
 * A small popover for detail that is not a list: a status badge's meaning,
 * the full text of a truncated cell, a short set of links. The trigger is a
 * real button (aria-expanded); the popover takes focus, closes on Escape, on
 * a click outside, or when something inside it is chosen, and focus goes back.
 * Lists of prompts, links or claims belong in the drill drawer instead.
 */
export function DrillPopover({
  label,
  title,
  className = 'm3-link',
  children,
  content
}: {
  /** Accessible name of the trigger. */
  label: string
  /** Heading inside the popover; also its accessible name. */
  title: string
  className?: string
  /** What the trigger shows. */
  children: ReactNode
  /** The popover body. Gets `close` so a link or button inside can close it. */
  content: (close: () => void) => ReactNode
}): JSX.Element {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popId = useId()

  function toggle(): void {
    if (at) {
      setAt(null)
      return
    }
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8))
    setAt({ top: rect.bottom + 6, left })
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={label}
        aria-expanded={at !== null}
        aria-controls={at ? popId : undefined}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        {children}
      </button>
      {at ? (
        <PopoverBody id={popId} title={title} at={at} trigger={trigger} onClose={() => setAt(null)}>
          {content(() => setAt(null))}
        </PopoverBody>
      ) : null}
    </>
  )
}

function PopoverBody({
  id,
  title,
  at,
  trigger,
  onClose,
  children
}: {
  id: string
  title: string
  at: { top: number; left: number }
  trigger: RefObject<HTMLButtonElement | null>
  onClose: () => void
  children: ReactNode
}): JSX.Element {
  const ref = useDialog<HTMLDivElement>({ onClose, trap: false })
  const headingId = useId()

  useEffect(() => {
    function onDown(event: MouseEvent): void {
      const target = event.target
      if (!(target instanceof Node)) return
      if (ref.current?.contains(target) || trigger.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ref, trigger, onClose])

  return (
    <div
      ref={ref}
      id={id}
      className="drill-pop"
      role="dialog"
      aria-labelledby={headingId}
      style={{ top: at.top, left: at.left, width: WIDTH }}
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('a[href], [data-drill-open]')) onClose()
      }}
    >
      <p className="label" id={headingId}>
        {title}
      </p>
      {children}
    </div>
  )
}
