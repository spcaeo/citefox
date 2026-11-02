import { useEffect, type JSX } from 'react'
import { replaceHash, structureRedirectHash } from '../shell/routes'

/**
 * `#/structure` was a screen; Site structure is All pages' Tree view now. Old
 * links (a tab, or a cluster or group id) open the same part there, in place,
 * so Back skips the old address.
 */
export function StructureRedirect(): JSX.Element {
  useEffect(() => {
    replaceHash(structureRedirectHash(window.location.hash))
  }, [])
  return <p role="status">Opening Pages · Tree…</p>
}
