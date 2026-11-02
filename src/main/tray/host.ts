/**
 * The slice of Electron the tray uses. Tests pass a fake.
 * `electron-host.ts` is the only file that imports Electron.
 */
export interface TrayCloseEvent {
  preventDefault(): void
}

/** A window the tray can show, hide, or point at a hash route. */
export interface TrayWindow {
  onClose(handler: (event: TrayCloseEvent) => void): void
  hide(): void
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  /** Fires when the window becomes visible, including the first automatic show. */
  onShown(handler: () => void): void
  /** Set the renderer location hash. The renderer already listens for `hashchange`. */
  openHash(hash: string): void
}

export interface TrayMenuEntry {
  id: string
  type: 'normal' | 'separator'
  label: string
  enabled: boolean
  click?: () => void
}

export interface TrayIcon {
  setToolTip(tooltip: string): void
  /** Runs before the menu pops up so the items match the latest queue and schedule. */
  onBeforeOpen(listener: () => void): void
  setMenu(items: readonly TrayMenuEntry[]): void
  destroy(): void
}

/** FR-24.7. `action` is the button label. A click runs `onClick`. */
export interface TrayNotification {
  title: string
  body: string
  action: string
  onClick(): void
}

export interface TrayHost {
  /** `png` is the 16px (@1x) image, `png2x` the 32px (@2x) one. */
  createTray(icon: { png: Uint8Array; png2x?: Uint8Array }, tooltip: string): TrayIcon
  windows(): readonly TrayWindow[]
  /** Windows created after this call. Existing windows come from `windows()`. */
  onWindow(listener: (win: TrayWindow) => void): void
  onActivate(listener: () => void): void
  /** Fires before windows close so the tray can tell a real quit from a hide. */
  onBeforeQuit(listener: () => void): void
  /** SCH-1. `openAtLogin` false removes the login item. */
  setLoginItem(openAtLogin: boolean): void
  /** SCH-1. Whether the system has CiteFox as a login item now. */
  loginItemEnabled(): boolean
  /** SCH-3. The computer woke from sleep or the screen was unlocked. */
  onWake(listener: () => void): void
  /** True when this process was started by the login item. */
  launchedAtLogin(): boolean
  quit(): void
  notify(notification: TrayNotification): void
  createWindow(): Promise<TrayWindow>
}
