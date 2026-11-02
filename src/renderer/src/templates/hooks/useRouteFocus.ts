import { useEffect, useState } from 'react'
import { parseHash, type SectionId } from '../../shell/routes'

/**
 * The `#/<section>/<id>` focus id for a screen. A `given` value (from the
 * shell) wins; otherwise the screen reads the hash itself, so a deep link
 * such as `templatesHash(id)` works before the shell passes it down.
 */
export function useRouteFocus(section: SectionId, given?: string | null): string | null {
  const [hash, setHash] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.hash
  )
  useEffect(() => {
    const onHash = (): void => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  if (given !== undefined) return given
  const location = parseHash(hash)
  return location.kind === 'section' && location.section === section
    ? (location.focusId ?? null)
    : null
}
