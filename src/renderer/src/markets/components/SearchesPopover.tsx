import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { SEARCHES_PER_PROMPT_MAX, SEARCHES_PER_PROMPT_MIN } from '@shared/domain'
import { useDialog } from '../../components/useDialog'
import { sectionHash } from '../../shell/routes'
import { rangeLabel, searchRange } from '../utils/model'

/**
 * "Searches per check" in a market row: the range opens a small popover with
 * how it is worked out (prompts × samples × 1 to 2 searches) and a link to
 * Connections, where the SerpApi usage is. Escape closes it and focus goes
 * back to the range.
 */
export function SearchesPopover({
  prompts,
  samples,
  marketName
}: {
  prompts: number
  samples: number
  marketName: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const popId = useId()
  const wrap = useRef<HTMLSpanElement>(null)
  const range = rangeLabel(searchRange(prompts, samples))
  const pop = useDialog<HTMLDivElement>({
    onClose: () => setOpen(false),
    active: open,
    trap: false
  })
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined)
  // Fixed to the viewport, under the range, so a grid row's scroll area never clips it.
  useLayoutEffect(() => {
    if (!open) return
    function measure(): void {
      const anchor = wrap.current?.getBoundingClientRect()
      if (!anchor) return
      const width = pop.current?.offsetWidth ?? 300
      const left = Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16))
      setPlace({ top: anchor.bottom + 6, left })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, pop])
  return (
    <span
      className="mk-pop-wrap"
      ref={wrap}
      onBlur={(event) => {
        const next = event.relatedTarget
        if (open && next instanceof Node && !wrap.current?.contains(next)) setOpen(false)
      }}
    >
      <button
        type="button"
        className="drill-num mono"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={`${range} searches per check in ${marketName}: how this is worked out`}
        onClick={() => setOpen((current) => !current)}
      >
        {range}
      </button>
      {open ? (
        <div
          ref={pop}
          id={popId}
          className="mk-pop"
          style={place}
          role="dialog"
          aria-label={`Searches per check in ${marketName}`}
        >
          <p>
            {prompts} {prompts === 1 ? 'question' : 'questions'} × {samples}{' '}
            {samples === 1 ? 'sample' : 'samples'} × {SEARCHES_PER_PROMPT_MIN} to{' '}
            {SEARCHES_PER_PROMPT_MAX} searches = <span className="mono">{range}</span> searches
          </p>
          <p className="faint">
            A sample with an AI Overview that loads separately takes a second search.
          </p>
          <a className="m3-link" href={sectionHash('connections')}>
            See search usage in Connections
          </a>
        </div>
      ) : null}
    </span>
  )
}
