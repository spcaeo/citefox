import { useState, type JSX, type ReactNode } from 'react'
import { useDrill, type DrillRequest } from '../../drill'

/**
 * A number (or label) whose drawer rows load on click: a cluster's pages, a
 * silo's pages, a group's scores. It opens the shared drill drawer once the
 * rows are in. With `nfrId` the content is the bare count, marked
 * `data-nfr-figure`, and the rows it loads are exactly what it counts.
 */
export function AsyncDrill({
  load,
  label,
  nfrId,
  className = 'drill-num',
  prefix,
  suffix,
  children
}: {
  load: () => Promise<DrillRequest>
  /** Accessible name. It must contain the number shown. */
  label: string
  nfrId?: string
  className?: string
  /** Text before and after the count, outside the `data-nfr-figure` mark. */
  prefix?: ReactNode
  suffix?: ReactNode
  children: ReactNode
}): JSX.Element {
  const { open } = useDrill()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function onClick(): Promise<void> {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      open(await load())
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={label}
        aria-busy={busy || undefined}
        data-nfr-drill={nfrId}
        onClick={() => void onClick()}
      >
        {prefix}
        {nfrId ? <span data-nfr-figure={nfrId}>{children}</span> : children}
        {suffix}
      </button>
      {failed ? (
        <span className="str-warn" role="alert">
          {' '}
          Could not load these. Try again.
        </span>
      ) : null}
    </>
  )
}
