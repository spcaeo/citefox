import { homedir } from 'node:os'
import { app, Notification } from 'electron'
import { backgroundTestMode } from '../background-mode'
import { linuxAutostart } from '../tray/linux-autostart'
import { loginItemSettings } from '../tray/login'
import { memoryPermissionSystem, type PermissionSystem } from './system'

/**
 * The real OS pieces for "What CiteFox needs". A development or e2e build
 * (`app.isPackaged` false) never adds a login item, and a background test run
 * never puts a notification on the screen of the person at the computer.
 * The test profile never adds a login item: it is the real install's item.
 */
export function electronPermissionSystem(
  options: { testProfile?: boolean } = {}
): PermissionSystem {
  const packaged = app.isPackaged
  const background = backgroundTestMode(packaged)
  const testProfile = options.testProfile === true
  if (background) {
    // Tests read every state and click every action without touching the OS.
    return { ...memoryPermissionSystem({ platform: process.platform }), testProfile }
  }
  if (testProfile) {
    return {
      platform: process.platform,
      testProfile,
      notifications: {
        supported: () => Notification.isSupported(),
        test: () => showTestNotification()
      },
      loginItem: { supported: false, enabled: () => false, set: () => undefined }
    }
  }
  const autostart =
    process.platform === 'linux'
      ? linuxAutostart({ home: homedir(), env: process.env, execPath: process.execPath })
      : null
  return {
    platform: process.platform,
    notifications: {
      supported: () => Notification.isSupported(),
      test: () => showTestNotification()
    },
    loginItem: {
      supported: packaged,
      enabled(): boolean {
        if (autostart !== null) return autostart.isEnabled()
        return app.getLoginItemSettings().openAtLogin
      },
      set(openAtLogin: boolean): void {
        if (!packaged) return
        if (autostart !== null) autostart.set(openAtLogin)
        else app.setLoginItemSettings(loginItemSettings(openAtLogin))
      }
    }
  }
}

/** On macOS the first one opens "CiteFox would like to send you notifications". */
function showTestNotification(): Promise<'shown' | 'failed'> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: 'shown' | 'failed'): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    try {
      const note = new Notification({
        title: 'CiteFox notifications are on',
        body: 'You will see a note here when a check finishes or needs a decision.'
      })
      note.on('show', () => finish('shown'))
      note.on('failed', () => finish('failed'))
      note.show()
      // Some systems never report `show`; no failure within 8 seconds counts as shown.
      setTimeout(() => finish('shown'), 8_000)
    } catch {
      finish('failed')
    }
  })
}
