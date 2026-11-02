/**
 * Pure helpers behind the v2 components (Tabs, GoalBar, Stepper, AiMenu).
 * Kept out of the .tsx files so those export components only (react-refresh).
 */
import type { MenuItem } from './Menu'
import type { UiIconName } from './UiIcon'

/** DOM id of a tab, for `aria-labelledby` on its panel. */
export function tabDomId(panelId: string, id: string): string {
  return `${panelId}-tab-${id}`
}

/** DOM id of a tab panel. */
export function tabPanelDomId(panelId: string, id: string): string {
  return `${panelId}-${id}`
}

/** A target band in percent, such as 50–70. */
export interface GoalBand {
  lo: number
  hi: number
}

/** A percentage clamped to 0–100; NaN reads as 0. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/** Accessible text for a goal bar: "42% cited, target 50–70%". */
export function goalBarText(value: number, band?: GoalBand): string {
  const shown = Math.round(clampPercent(value))
  return band ? `${shown}% cited, target ${band.lo}–${band.hi}%` : `${shown}% cited`
}

export interface StepperStep {
  id: string
  label: string
}

export type StepState = 'done' | 'current' | 'todo'

/** Each step's state from the current step's position. */
export function stepStates(steps: readonly StepperStep[], current: string): StepState[] {
  const at = steps.findIndex((step) => step.id === current)
  return steps.map((_, index) => (index < at ? 'done' : index === at ? 'current' : 'todo'))
}

/** One AI action, such as "Discover more" (about 15 s). */
export interface AiAction {
  id: string
  label: string
  icon?: UiIconName
  /** Typical run time in seconds, shown as "15 s". */
  seconds?: number
  disabled?: boolean
  onSelect: () => void
}

export const AI_MENU_FOOTER = 'Runs on your AI plan. Uses no searches.'

/** Menu items for AI actions: a fox sparkle when no icon is given, time estimates as hints. */
export function aiMenuItems(actions: readonly AiAction[]): MenuItem[] {
  return actions.map((action) => ({
    id: action.id,
    label: action.label,
    icon: action.icon ?? 'sparkle',
    tone: action.icon ? 'default' : 'ai',
    ...(action.seconds !== undefined ? { hint: `${action.seconds} s` } : {}),
    ...(action.disabled ? { disabled: true } : {}),
    onSelect: action.onSelect
  }))
}

/**
 * The address Copy and Open use. A full URL is used as it is; a site path
 * (`/blog/post`) is joined to `site`, the address of the site it belongs to
 * (`example.com` or `https://example.com`). A path without a site stays a path.
 */
export function urlTextHref(url: string, site?: string | null): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || !site) return url
  const base = /^[a-z][a-z\d+.-]*:\/\//i.test(site) ? site : `https://${site}`
  try {
    return new URL(url, base.endsWith('/') ? base : `${base}/`).toString()
  } catch {
    return url
  }
}
