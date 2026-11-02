/**
 * The application menu: the standard app, Edit and Window menus, plus
 * View › Appearance (System, Light, Dark) so a Mac user finds the theme where
 * they expect it, and File › Export / Import project and app settings for
 * moving to a new Mac. Without a menu of its own Electron shows its default one.
 */

import { THEME_PREFERENCES, type ThemePreference } from '@shared/domain'
import type { TransferMenuCommand } from '@shared/ipc'
import type { MenuItemConstructorOptions } from 'electron'

export interface AppMenuOptions {
  appName: string
  platform: NodeJS.Platform
  /** Unpackaged builds keep Reload and the developer tools. */
  dev: boolean
  theme: ThemePreference
  onTheme: (theme: ThemePreference) => void
  /** File › Export / Import: the renderer carries the command out (`transfer:menu`). */
  onFileCommand?: (command: TransferMenuCommand) => void
}

const FILE_ITEMS: readonly { command: TransferMenuCommand; label: string }[] = [
  { command: 'export-project', label: 'Export Project…' },
  { command: 'import-project', label: 'Import Project…' },
  { command: 'export-settings', label: 'Export App Settings…' },
  { command: 'import-settings', label: 'Import App Settings…' }
]

/** File: export and import, then Close Window (macOS) or Quit (Windows, Linux). */
export function fileMenu(
  platform: NodeJS.Platform,
  onFileCommand?: (command: TransferMenuCommand) => void
): MenuItemConstructorOptions {
  const transfer: MenuItemConstructorOptions[] = onFileCommand
    ? FILE_ITEMS.flatMap((item, index) => [
        ...(index === 2 ? [{ type: 'separator' as const }] : []),
        {
          id: `file-${item.command}`,
          label: item.label,
          click: () => {
            onFileCommand(item.command)
          }
        }
      ])
    : []
  return {
    id: 'file',
    label: 'File',
    submenu: [
      ...transfer,
      ...(transfer.length > 0 ? [{ type: 'separator' as const }] : []),
      platform === 'darwin' ? { role: 'close' as const } : { role: 'quit' as const }
    ]
  }
}

const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  sepia: 'Sepia'
}

/** View › Appearance: one radio item per choice, the saved one ticked. */
export function appearanceMenu(
  theme: ThemePreference,
  onTheme: (theme: ThemePreference) => void
): MenuItemConstructorOptions {
  return {
    id: 'appearance',
    label: 'Appearance',
    submenu: THEME_PREFERENCES.map((choice) => ({
      id: `appearance-${choice}`,
      label: THEME_LABELS[choice],
      type: 'radio' as const,
      checked: choice === theme,
      click: () => {
        onTheme(choice)
      }
    }))
  }
}

export function appMenuTemplate(options: AppMenuOptions): MenuItemConstructorOptions[] {
  const mac = options.platform === 'darwin'
  const view: MenuItemConstructorOptions[] = [
    appearanceMenu(options.theme, options.onTheme),
    { type: 'separator' },
    ...(options.dev
      ? ([
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' }
        ] satisfies MenuItemConstructorOptions[])
      : []),
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]
  return [
    ...(mac ? [{ label: options.appName, role: 'appMenu' as const }] : []),
    fileMenu(options.platform, options.onFileCommand),
    { role: 'editMenu' },
    { id: 'view', label: 'View', submenu: view },
    { role: 'windowMenu' }
  ]
}
