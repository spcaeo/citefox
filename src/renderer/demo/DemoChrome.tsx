import { useEffect, useState, type JSX } from 'react'
import { DEMO_NOTICE_EVENT } from './notice'
import { DEMO_BLOCKED_MESSAGE } from './policy'

/**
 * The demo's own pieces around the app: the slim banner on top and the one
 * notice a blocked action shows (src/renderer/demo/main.tsx mounts both).
 */

/** The download page, one level up from /demo/. */
export const DOWNLOAD_HREF = '../#download'
/** The sample report gallery (site/samples). */
export const SAMPLES_HREF = '../samples/'

export function DemoBanner(): JSX.Element {
  return (
    <div className="demo-banner" role="region" aria-label="About this demo">
      <span className="demo-banner-dot" aria-hidden="true" />
      <span>
        <b>Live demo</b> · sample data ·{' '}
        <a href={DOWNLOAD_HREF} target="_top">
          Download the free app
        </a>
      </span>
    </div>
  )
}

export function DemoNotice(): JSX.Element | null {
  const [open, setOpen] = useState<{ reports: boolean } | null>(null)
  useEffect(() => {
    const onNotice = (event: Event): void => {
      const detail = (event as CustomEvent<{ reports?: boolean }>).detail ?? {}
      setOpen({ reports: detail.reports === true })
    }
    window.addEventListener(DEMO_NOTICE_EVENT, onNotice)
    return () => window.removeEventListener(DEMO_NOTICE_EVENT, onNotice)
  }, [])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => setOpen(null), 9000)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
    }
  }, [open])
  if (!open) return null
  return (
    <div className="demo-notice" role="status" aria-live="polite" data-testid="demo-notice">
      <p className="demo-notice-text">{DEMO_BLOCKED_MESSAGE}</p>
      <div className="demo-notice-actions">
        {open.reports ? (
          <a
            className="demo-notice-link"
            href={SAMPLES_HREF}
            target="_blank"
            rel="noopener noreferrer"
          >
            See sample reports
          </a>
        ) : null}
        <a className="demo-notice-main" href={DOWNLOAD_HREF} target="_top">
          Download
        </a>
        <button
          type="button"
          className="demo-notice-close"
          aria-label="Close"
          onClick={() => setOpen(null)}
        >
          ×
        </button>
      </div>
    </div>
  )
}
