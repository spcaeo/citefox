/**
 * Event a screen with tabs listens for: an element inside a hidden tab panel
 * asks to be shown (the event's target is that element). Project settings
 * switches to the tab that holds it.
 */
export const REVEAL_EVENT = 'citefox:reveal'

/**
 * Moves focus to an element once the next screen has drawn it, such as a
 * Project settings section heading after "Cap" opens that project's settings.
 * An element in a hidden tab asks its screen to show that tab first. Gives up
 * quietly after about two seconds.
 */
export function focusWhenReady(elementId: string, tries = 40): void {
  const found = document.getElementById(elementId)
  if (found && found.closest('[hidden]') && tries > 0) {
    found.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true }))
    window.setTimeout(() => focusWhenReady(elementId, tries - 1), 50)
    return
  }
  if (found) {
    if (!found.hasAttribute('tabindex')) found.setAttribute('tabindex', '-1')
    found.scrollIntoView?.({ block: 'start' })
    found.focus({ preventScroll: true })
    return
  }
  if (tries <= 0) return
  window.setTimeout(() => focusWhenReady(elementId, tries - 1), 50)
}

/** The heading id of a Project settings section (`Section` in projectSettings/components/bits). */
export function settingsHeading(sectionId: string): string {
  return `${sectionId}-h`
}
