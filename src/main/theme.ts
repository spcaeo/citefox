/**
 * Light / dark / system theme in main (Settings › Appearance, View › Appearance).
 *
 * `nativeTheme.themeSource` is the one switch: it makes native menus, context
 * menus, dialogs, scroll bars and form controls match, and it drives the
 * renderer's `prefers-color-scheme`, so the page's first frame (theme-boot.js)
 * is already right. The window background follows too, so there is no white
 * flash before the page paints.
 */

import type { ResolvedTheme, ThemePreference } from '@shared/domain'
import { nativeThemeSource, THEME_GROUND } from '@shared/theme'

/** The slice of Electron's `nativeTheme` this uses (tests pass a fake). */
export interface NativeThemeLike {
  themeSource: 'system' | 'light' | 'dark'
  readonly shouldUseDarkColors: boolean
  on(event: 'updated', listener: () => void): unknown
}

/** The slice of a `BrowserWindow` this paints. */
export interface ThemeWindow {
  isDestroyed(): boolean
  setBackgroundColor(color: string): void
}

/** The last choice applied, so a window opened later starts in it (sepia is not native). */
let applied: ThemePreference = 'system'

/** The theme on screen now: sepia when chosen, else what the computer shows after `themeSource`. */
export function resolvedNativeTheme(
  native: Pick<NativeThemeLike, 'shouldUseDarkColors'>,
  preference: ThemePreference = applied
): ResolvedTheme {
  if (preference === 'sepia') return 'sepia'
  return native.shouldUseDarkColors ? 'dark' : 'light'
}

/** The window background for the theme on screen: the page's `--ground`. */
export function windowBackground(
  native: Pick<NativeThemeLike, 'shouldUseDarkColors'>,
  preference: ThemePreference = applied
): string {
  return THEME_GROUND[resolvedNativeTheme(native, preference)]
}

export interface ThemeControllerDeps {
  native: NativeThemeLike
  windows: () => readonly ThemeWindow[]
  /** The saved choice. */
  read: () => ThemePreference
  /** Saves a choice made outside Settings (the View menu). */
  write: (theme: ThemePreference) => void
  /** Tells every window (`settings:themeChanged`). */
  emit: (theme: ThemePreference) => void
  /** After each change, such as rebuilding the menu so its tick moves. */
  onApplied?: (theme: ThemePreference) => void
}

export interface ThemeController {
  /** Applies the saved choice and follows the computer's changes. Call once at start. */
  start(): void
  /** Settings saved a new choice: apply it and tell the windows. */
  changed(theme: ThemePreference): void
  /** The View menu picked a choice: save it, apply it and tell the windows. */
  choose(theme: ThemePreference): void
  current(): ThemePreference
}

export function createThemeController(deps: ThemeControllerDeps): ThemeController {
  const paint = (): void => {
    const color = windowBackground(deps.native, applied)
    for (const win of deps.windows()) {
      if (!win.isDestroyed()) win.setBackgroundColor(color)
    }
  }
  const apply = (theme: ThemePreference): void => {
    applied = theme
    deps.native.themeSource = nativeThemeSource(theme)
    paint()
    deps.onApplied?.(theme)
  }
  const changed = (theme: ThemePreference): void => {
    apply(theme)
    deps.emit(theme)
  }
  return {
    start() {
      apply(deps.read())
      // macOS Auto appearance at sunset, or a change in System Settings.
      deps.native.on('updated', paint)
    },
    changed,
    choose(theme) {
      deps.write(theme)
      changed(theme)
    },
    current: () => deps.read()
  }
}
