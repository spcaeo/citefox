import type { JSX } from 'react'
import { IconButton, LinkButton } from '../ui'
import { UiIcon } from '../ui/UiIcon'
import { dismissUpdate, useUpdateStatus } from './updateStore'
import './updates.css'

/**
 * A calm one-line strip over every screen when GitHub has a newer CiteFox:
 * "CiteFox v0.13.0 is out · What's new · Download". Download opens the
 * installer for this computer (or the release page) in the browser; closing
 * it lasts until the next release.
 */
export function UpdateBanner(): JSX.Element | null {
  const status = useUpdateStatus()
  const latest = status.latest
  if (!status.available || status.dismissed || !latest) return null
  return (
    <section className="upd" aria-label="New version">
      <UiIcon name="sparkle" size={16} />
      <p className="upd-text">
        <strong>CiteFox v{latest.version} is out</strong>
        <span aria-hidden="true"> · </span>
        <a href={latest.notesUrl} target="_blank" rel="noopener noreferrer">
          What’s new
        </a>
      </p>
      <LinkButton href={latest.downloadUrl} external size="sm" variant="primary">
        Download
      </LinkButton>
      <IconButton
        icon="x"
        size="sm"
        label="Hide until the next version"
        data-tip="Hide until the next version"
        onClick={() => void dismissUpdate()}
      />
    </section>
  )
}
