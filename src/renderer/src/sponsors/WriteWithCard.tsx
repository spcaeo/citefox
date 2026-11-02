import type { JSX } from 'react'
import { WRITE_WITH_URL } from '@shared/ipc'

/**
 * Our own writing tool, as a card in a drawer's right rail, next to a brief:
 * "1000AIOverviews · Write this page". A plain link opened in the browser; it
 * sends no brief, page or project data.
 */
export function WriteWithCard(): JSX.Element {
  return (
    <aside className="write-with" aria-label="Write it with 1000AIOverviews">
      <div className="write-with-head">
        <span className="write-with-mark" aria-hidden="true">
          1K
        </span>
        <span className="write-with-id">
          <span className="write-with-tier">From the CiteFox team</span>
          <span className="write-with-name">1000AIOverviews</span>
        </span>
      </div>
      <p className="write-with-line">
        Turn this brief into a finished page, written to be cited in AI answers.
      </p>
      <a
        className="write-with-cta"
        href={WRITE_WITH_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Write this page with 1000AIOverviews (opens in your browser, sends no data)"
      >
        Write this page →
      </a>
    </aside>
  )
}
