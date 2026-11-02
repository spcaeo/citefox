/** App settings and the tracking defaults a new page starts with. */

import type { ClaudeProvider, JinaMode, SerpApiRotationMode } from './connections'
import type { MarketDevice } from './projects'

/**
 * FR-1.4. How often a page or topic is checked, in days. Every day and every 7 days
 * came in on 2026-11-01 (owner: "an option for 1 day, but default to 7 to be safe").
 */
export const INTERVAL_DAYS = [1, 7, 14, 30, 60, 90] as const

export type IntervalDays = (typeof INTERVAL_DAYS)[number]

/**
 * The short list Add page, Add topic and Re-check offer: every day, 7 days (the
 * default), 14 and 30. 60 and 90 stay for imports and settings.
 */
export const QUICK_INTERVAL_DAYS = [1, 7, 14, 30] as const satisfies readonly IntervalDays[]

/**
 * The left sidebar (v2 shell). `auto` is expanded and collapses to the icon rail
 * below {@link SIDEBAR_AUTO_COLLAPSE_WIDTH}; `collapsed` and `expanded` are the
 * person's own choice and hold at every window width.
 */
export const SIDEBAR_MODES = ['auto', 'collapsed', 'expanded'] as const

export type SidebarMode = (typeof SIDEBAR_MODES)[number]

export const DEFAULT_SIDEBAR_MODE: SidebarMode = 'auto'

/** Window width (CSS px) under which an `auto` sidebar shows as the icon rail. */
export const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1100

export function isSidebarMode(value: string): value is SidebarMode {
  return SIDEBAR_MODES.some((mode) => mode === value)
}

/**
 * Settings › Appearance. `system` follows the computer's light or dark mode
 * (macOS System Settings › Appearance, including Auto); `light`, `dark` and
 * `sepia` (a warm paper page for long reading, like Apple Books) hold.
 */
export const THEME_PREFERENCES = ['system', 'light', 'dark', 'sepia'] as const

export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** The theme on screen once `system` is worked out. */
export type ResolvedTheme = 'light' | 'dark' | 'sepia'

/** Sepia until the person picks another (owner, 2026-11-01). */
export const DEFAULT_THEME: ThemePreference = 'sepia'

export function isThemePreference(value: string): value is ThemePreference {
  return THEME_PREFERENCES.some((theme) => theme === value)
}

/** FR-1.5. Samples per prompt are 1–5. */
const SAMPLE_COUNTS = [1, 2, 3, 4, 5] as const

export type SampleCount = (typeof SAMPLE_COUNTS)[number]

/** FR-1.5. */
export const DEFAULT_SAMPLE_COUNT: SampleCount = 1

/** FR-1.5. */
export const DEFAULT_PROMPT_COUNT = 10

/**
 * Re-check interval before the user changes it (FR-1.4): 7 days (owner, 2026-11-01;
 * was 14). Every day stays a choice. Saved intervals keep their value.
 */
export const DEFAULT_INTERVAL_DAYS: IntervalDays = 7

/**
 * FR-1.6. Each prompt, in each market, at each sample, costs 1 or 2 searches.
 * The renderer uses these for the estimate before a page is saved.
 */
export const SEARCHES_PER_PROMPT_MIN = 1

export const SEARCHES_PER_PROMPT_MAX = 2

/**
 * App-wide settings M1 reads and writes (section 9.2).
 * Schedule, notifications, and export are the M3+ channels (`schedule:*`, `alerts:*`, `exports:*`).
 * They are not fields on this object. Country and language stay null until the user sets them.
 * Section 15 forbids a hard-coded market.
 */
export interface AppSettings {
  /**
   * The person's name from the profile step ("Your name").
   * App-level. Not a project column. Null until that step is saved.
   */
  userName: string | null
  /** ISO 3166-1 alpha-2. Null until onboarding or Settings sets it. SerpApi `gl`. */
  defaultCountry: string | null
  /** ISO 639-1 or BCP-47. Null until set. SerpApi `hl`. */
  defaultLanguage: string | null
  /** City or region for the app-wide default market. Null when unset. */
  defaultLocation: string | null
  /** CEO decision: starts as {@link DEFAULT_MARKET_DEVICE}. */
  defaultDevice: MarketDevice
  defaultIntervalDays: IntervalDays
  defaultSamples: SampleCount
  /** FR-1.5. The SRS sets the default at 10 and does not set a maximum. */
  defaultPromptCount: number
  /** Null searches PATH and the usual install folders (LLM-1). */
  claudeBinaryPath: string | null
  /** LLM-7. Default {@link DEFAULT_CLAUDE_CONCURRENCY}. */
  claudeConcurrency: number
  /** Null means the provider's default model (LLM-5). Not a fixed catalogue. */
  claudeModel: string | null
  /** Which AI connection runs the analysis (section 5.1): Claude Code, Anthropic API or Codex. */
  claudeProvider: ClaudeProvider
  /**
   * The Codex CLI path. Null searches PATH and the usual install folders, like
   * `claudeBinaryPath`. Main always returns this; absent reads as null.
   */
  codexBinaryPath?: string | null
  /** Codex model for heavy jobs (analysis, reports, web search). Null uses the default. */
  codexModel?: string | null
  /** Codex model for quick jobs (form helpers, the test call). Null uses the default. */
  codexQuickModel?: string | null
  jinaMode: JinaMode
  /**
   * FR-11.2. `in_order` (default), `spread_evenly`, or `project_keys`.
   * Main always returns this.
   */
  serpapiRotation?: SerpApiRotationMode
  /** Sidebar collapse choice. Main always returns this; absent reads as `auto`. */
  sidebar?: SidebarMode
  /** Settings › Appearance. Main always returns this; absent reads as `system`. */
  theme?: ThemePreference
  /**
   * Settings › Appearance › "Celebrate citations": a short full-window moment with confetti
   * the first time a running check finds the user's site cited. Main always returns this;
   * absent reads as on.
   */
  celebrate?: boolean
  /**
   * Settings › Appearance › "Play a sound": the celebration's short jingle. Main always
   * returns this; absent reads as on.
   */
  celebrateSound?: boolean
}

/** "1 day", "7 days": an interval after "Re-check every". */
export function intervalDaysText(days: IntervalDays): string {
  return days === 1 ? '1 day' : `${days} days`
}

/** "Every day", "Every 7 days". */
export function intervalLabel(days: IntervalDays): string {
  return days === 1 ? 'Every day' : `Every ${days} days`
}

export function isIntervalDays(value: number): value is IntervalDays {
  return INTERVAL_DAYS.some((item) => item === value)
}

export function isSampleCount(value: number): value is SampleCount {
  return SAMPLE_COUNTS.some((item) => item === value)
}
