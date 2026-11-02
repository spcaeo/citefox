import { useEffect, useRef } from 'react'
import { LANDING_SECTION, replaceHash, type ShellLocation } from '../shell/routes'
import { emptyProjectHash, readStartChoice } from './choice'
import type { StartClient } from './client'

/**
 * True for the plain project landing: `#/` or `#/overview`, and `#/pages`
 * with no filters (the landing before Overview).
 */
export function isPlainLanding(location: ShellLocation): boolean {
  return (
    location.kind === 'section' &&
    (location.section === LANDING_SECTION || location.section === 'pages') &&
    location.projectId === undefined &&
    (location.params === undefined || Object.keys(location.params).length === 0)
  )
}

/**
 * An empty project (no tracked page, no topic) never lands on a blank screen:
 * the plain landing is replaced with "How do you want to start?"
 * (`#/start/choose`), or with what the user chose there before (owner
 * feedback 6): the journey for "Let CiteFox set up my site", the chooser for
 * "I'll choose myself". A link that
 * names a project's screen on purpose (`#/p/<id>/pages`) is left alone.
 */
export function useStartRedirect({
  location,
  projectId,
  ready,
  client
}: {
  location: ShellLocation
  projectId: string | null
  ready: boolean
  client: StartClient
}): void {
  const landing = isPlainLanding(location)
  const fromProjectRoute = useRef(false)
  const viaProject = location.projectId !== undefined
  useEffect(() => {
    if (viaProject) fromProjectRoute.current = true
  }, [viaProject])
  useEffect(() => {
    if (!ready || projectId === null || !landing) return
    if (fromProjectRoute.current) {
      fromProjectRoute.current = false
      return
    }
    let cancelled = false
    client.status({ projectId }).then(
      (journey) => {
        if (cancelled || !journey.empty) return
        replaceHash(emptyProjectHash(readStartChoice(projectId), journey.running))
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [ready, projectId, landing, client])
}
