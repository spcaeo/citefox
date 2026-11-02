import { useEffect, type JSX } from 'react'
import { replaceHash } from '../shell/routes'
import { askRedirectHash } from './askLinks'

/**
 * `#/ask` was a screen; Ask CiteFox is now a drawer over the screen you are
 * on. Old links (the sidebar, the tray, a topic's "Ask about this topic")
 * open the page they name, or Overview, with the drawer and the question
 * filled in. The link never sends the question by itself.
 */
export function AskRedirect(): JSX.Element {
  useEffect(() => {
    replaceHash(askRedirectHash(window.location.hash))
  }, [])
  return <p role="status">Opening Ask CiteFox…</p>
}
