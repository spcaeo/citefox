import type { AppSettingsTab } from '../shell/routes'
import type { TabItem } from '../ui'
import type { SettingsErrors } from './validate'

/**
 * App settings tabs: everything that applies to every project, in four places.
 * Keys live on the Connections screen, templates on the Templates screen and
 * the theme in the top bar; an old tab link (`?tab=defaults`, `?tab=about`…)
 * redirects to the tab that holds it now.
 */
export type SettingsTab = AppSettingsTab

export const SETTINGS_PANELS = 'settings-panel'

export const SETTINGS_TABS: readonly TabItem<SettingsTab>[] = [
  { id: 'ai', label: 'AI & searches' },
  { id: 'general', label: 'General' },
  { id: 'email', label: 'Email' },
  { id: 'reports', label: 'Reports' },
  { id: 'data', label: 'Data & about' }
]

/** The tab a URL's `tab` value opens; anything else opens `fallback`. */
export function settingsTabFor(value: string | null, fallback: SettingsTab): SettingsTab {
  return SETTINGS_TABS.find((tab) => tab.id === value)?.id ?? fallback
}

const CONNECTION_FIELDS: readonly (keyof SettingsErrors)[] = [
  'budget',
  'claudeConcurrency',
  'claudeBinaryPath'
]

/** The tab that holds the first field with a problem, so Save can show it. Null when none. */
export function tabForErrors(errors: SettingsErrors): SettingsTab | null {
  const fields = (Object.keys(errors) as (keyof SettingsErrors)[]).filter((field) => errors[field])
  if (fields.length === 0) return null
  return fields.some((field) => !CONNECTION_FIELDS.includes(field)) &&
    !fields.some((field) => CONNECTION_FIELDS.includes(field))
    ? 'general'
    : 'ai'
}
