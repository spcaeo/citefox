import { useCallback, useRef } from 'react'
import type { ThemePreference } from '@shared/domain'
import { useBuildTools } from '../buildMenu/buildClient'
import { signalGuide } from '../guide/signals'
import type { OnboardingClient } from '../onboarding/client'
import { getThemePreference, setThemePreference } from './themeStore'

/**
 * Picks a look (Light, Dark, Sepia or System) and saves it through
 * `settings:update`, as View › Appearance does, so every place shows one choice.
 * The top bar's theme menu and Ctrl+K's "Switch theme to …" both use it.
 */
export function useThemeChoice(
  client: Pick<OnboardingClient, 'updateSettings'>
): (next: ThemePreference) => Promise<void> {
  const { notify } = useBuildTools()
  const saving = useRef(false)
  return useCallback(
    async (next: ThemePreference): Promise<void> => {
      // The guide's "Change the look" step: picking a look, even the current one, is the step.
      signalGuide('theme-changed')
      const before = getThemePreference()
      if (next === before || saving.current) return
      setThemePreference(next)
      saving.current = true
      try {
        await client.updateSettings({ theme: next })
      } catch {
        setThemePreference(before)
        notify('CiteFox could not save the theme. Try again.', 'bad')
      } finally {
        saving.current = false
      }
    },
    [client, notify]
  )
}
