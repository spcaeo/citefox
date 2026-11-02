import type { JSX } from 'react'
import type { ThemePreference } from '@shared/domain'
import type { OnboardingClient } from '../onboarding/client'
import { useThemePreference } from '../theme/themeStore'
import { useThemeChoice } from '../theme/useThemeChoice'
import { MenuButton, type MenuItem } from '../ui/Menu'
import { UiIcon, type UiIconName } from '../ui/UiIcon'

type ThemeChoice = { id: ThemePreference; label: string; icon: UiIconName }

const SYSTEM: ThemeChoice = { id: 'system', label: 'System', icon: 'monitor' }

const THEMES: readonly ThemeChoice[] = [
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
  { id: 'sepia', label: 'Sepia', icon: 'book-open' },
  SYSTEM
]

/**
 * The theme switch in the top bar, next to the ⚙ menu: an icon for the current
 * choice (sun, moon, book or screen) opening Light, Dark, Sepia and System, with a tick on
 * the current one. One click to open, one to pick. It saves through
 * `settings:update`, like View › Appearance, so every place shows one choice.
 * The setup screens use it too, on their light top bar (`plain`).
 */
export function ThemeMenu({
  client,
  plain = false
}: {
  /** Saves the theme choice (`settings:update`). */
  client: Pick<OnboardingClient, 'updateSettings'>
  /** A plain icon button for a light bar (setup) instead of the dark top bar's. */
  plain?: boolean
}): JSX.Element {
  const theme = useThemePreference()
  const choose = useThemeChoice(client)
  const current = THEMES.find((choice) => choice.id === theme) ?? SYSTEM

  const items: MenuItem[] = THEMES.map((choice) => ({
    id: `theme-${choice.id}`,
    label: choice.label,
    ariaLabel: `Theme: ${choice.label}`,
    icon: choice.icon,
    checked: theme === choice.id,
    onSelect: () => void choose(choice.id)
  }))

  return (
    <MenuButton
      label="Theme"
      align="end"
      width={160}
      items={items}
      trigger={(props, open) => (
        <button
          type="button"
          className={plain ? 'ui-icon-btn' : 'topbar-icon topbar-theme'}
          aria-label="Theme"
          data-tip={`Theme: ${current.label}`}
          data-open={open || undefined}
          data-guide={plain ? undefined : 'topbar-theme'}
          {...props}
        >
          <UiIcon name={current.icon} />
        </button>
      )}
    />
  )
}
