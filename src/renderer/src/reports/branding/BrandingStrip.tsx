import { useState, type JSX } from 'react'
import type { ReportBranding } from '@shared/report/review/extras'
import { bylineText, type ReportByline } from '@shared/report/review/sender'
import { appSettingsHash } from '../../shell/routes'
import { Drawer } from '../../ui'
import { BrandingForm } from './BrandingForm'
import { useByline } from './senderStore'
import './branding.css'

function Mark({ byline }: { byline: ReportByline }): JSX.Element {
  return byline.fromLogo ? (
    <img className="rb-mark-img" src={byline.fromLogo} alt="" />
  ) : (
    <span className="rb-mark" aria-hidden="true">
      {(byline.fromName.trim()[0] ?? '·').toUpperCase()}
    </span>
  )
}

/**
 * Reports home, above the view tabs (right): who the reports are from, with a link to
 * edit it. No branding yet: a quiet prompt whose Edit opens a small drawer with the
 * three-way question.
 */
export function BrandingStrip({
  branding,
  brand
}: {
  branding: ReportBranding | null | undefined
  brand: string
}): JSX.Element | null {
  const { loaded, byline } = useByline(branding, brand)
  const [open, setOpen] = useState(false)
  if (!loaded) return null
  return (
    <>
      {byline === null ? (
        <p className="rb-strip rb-strip-quiet" data-testid="branding-strip">
          <span>Add your logo to every report</span>
          <button type="button" className="rv-link" onClick={() => setOpen(true)}>
            Edit
          </button>
        </p>
      ) : (
        <p className="rb-strip" data-testid="branding-strip" data-mode={byline.mode}>
          <Mark byline={byline} />
          <span>{bylineText(byline)}</span>
          <span aria-hidden="true">·</span>
          <a className="rv-link" href={appSettingsHash('reports')}>
            Edit branding
          </a>
        </p>
      )}
      {open ? (
        <Drawer
          id="report-branding"
          title="Your logo on every report"
          subtitle="Set once. Every report and download uses it."
          depth={0}
          crumbs={[]}
          onClose={() => setOpen(false)}
          footer={{ cancel: 'Close' }}
          testId="branding-drawer"
        >
          <BrandingForm brand={brand} onSaved={() => setOpen(false)} />
        </Drawer>
      ) : null}
    </>
  )
}

/** The same small line in a report's header; nothing with no branding. */
export function BylineLine({
  branding,
  brand
}: {
  branding: ReportBranding | null | undefined
  brand: string
}): JSX.Element | null {
  const { byline } = useByline(branding, brand)
  if (byline === null) return null
  return (
    <p className="rb-line" data-testid="report-byline">
      <Mark byline={byline} />
      <span>{bylineText(byline)}</span>
    </p>
  )
}
