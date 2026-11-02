import type { JSX } from 'react'
import { useAppInfo } from '../buildMenu/appInfoStore'
import { releaseText } from '../buildMenu/buildInfo'
import { CopyText } from '../ui/CopyText'
import { useUpdateStatus } from '../updates/updateStore'
import '../updates/updates.css'

/**
 * The release line at the end of every screen (owner rule, 2026-11-02):
 * `v0.12.0 · build 1424 · Nov 2, 2026 8:49 AM EST` in small muted type, one
 * line, under the gold sponsor card. The words come from `app:getInfo`
 * (package.json's version and the stamped build), the same as the ⚙ menu.
 * Copy on hover, so a tester can paste exactly what they tested. When a newer
 * release exists, a dot and "vX available" follow (it stays after the banner
 * is closed) and open the download.
 */
export function ReleaseLine(): JSX.Element | null {
  const info = useAppInfo()
  const update = useUpdateStatus()
  if (!info) return null
  const text = releaseText(info)
  const latest = update.available ? update.latest : null
  return (
    <footer className="release-line" aria-label="Release">
      <CopyText text={text} />
      {latest ? (
        <a
          className="release-update"
          href={latest.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="upd-dot" aria-hidden="true" />v{latest.version} available
        </a>
      ) : null}
    </footer>
  )
}
