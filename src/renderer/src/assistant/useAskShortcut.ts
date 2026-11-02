import { useEffect } from 'react'
import { closeDrawer, currentDrawers, useDrawerStack } from '../shell/drawers'
import { isAskShortcut } from '../shell/askShortcut'
import { openAsk } from './openAsk'

/**
 * ⌘J / Ctrl J from anywhere in the shell: opens Ask CiteFox over the screen,
 * or closes it when it is the top drawer. Returns whether Ask is open.
 */
export function useAskShortcut(enabled: boolean): boolean {
  const { stack } = useDrawerStack()
  const open = stack.some((entry) => entry.id === 'ask')

  useEffect(() => {
    if (!enabled) return
    function onKeyDown(event: KeyboardEvent): void {
      if (!isAskShortcut(event) || event.defaultPrevented) return
      event.preventDefault()
      const drawers = currentDrawers()
      const top = drawers.length - 1
      if (top >= 0 && drawers[top]?.id === 'ask') closeDrawer(top)
      else if (!drawers.some((entry) => entry.id === 'ask')) openAsk()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])

  return open
}
