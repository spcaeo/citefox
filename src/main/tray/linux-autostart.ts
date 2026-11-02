import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { posix } from 'node:path'
import { writeFileAtomic } from '../scheduler/os-job/shared'

/**
 * SCH-1 "Start at login" on Linux. Electron's `setLoginItemSettings` only
 * works on macOS and Windows, so CiteFox writes an XDG autostart entry
 * (`~/.config/autostart/app.citefox.desktop`) that GNOME, KDE, Xfce and other
 * desktops run at login. The entry passes {@link LAUNCHED_AT_LOGIN_FLAG} so
 * the login launch starts hidden in the tray, like `wasOpenedAtLogin`.
 */
export const LAUNCHED_AT_LOGIN_FLAG = '--launched-at-login'
export const AUTOSTART_FILE = 'app.citefox.desktop'

/** `$XDG_CONFIG_HOME/autostart`, falling back to `~/.config/autostart`. */
export function autostartDirectory(home: string, env: Record<string, string | undefined>): string {
  const configured = env.XDG_CONFIG_HOME
  const configHome =
    configured !== undefined && configured !== '' && posix.isAbsolute(configured)
      ? configured
      : posix.join(home, '.config')
  return posix.join(configHome, 'autostart')
}

/**
 * The program the entry starts. A packaged AppImage runs from a temporary
 * mount, so the entry starts `$APPIMAGE` (the .AppImage file) instead.
 */
export function autostartProgram(
  execPath: string,
  env: Record<string, string | undefined>
): string {
  const appImage = env.APPIMAGE?.trim() ?? ''
  return posix.isAbsolute(appImage) ? appImage : execPath
}

/**
 * One `Exec` argument, quoted per the Desktop Entry spec: `"`, `` ` ``, `$`
 * and `\` are backslash-escaped inside double quotes, then the string-value
 * escape doubles every backslash, and `%` (a field code) becomes `%%`.
 */
export function desktopExecQuote(value: string): string {
  const quoted = `"${value.replace(/[\\"`$]/g, (c) => `\\${c}`)}"`
  return quoted.replace(/\\/g, '\\\\').replace(/%/g, '%%')
}

export function autostartDesktopEntry(program: string): string {
  if (/[\r\n\0]/.test(program)) {
    throw new Error('The CiteFox program path contains a line break or NUL character.')
  }
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=CiteFox',
    'Comment=Track whether Google AI Overviews cite your pages',
    `Exec=${desktopExecQuote(program)} ${LAUNCHED_AT_LOGIN_FLAG}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

export interface LinuxAutostart {
  isEnabled(): boolean
  /** Writes (true) or deletes (false) the autostart entry. Throws when the file cannot be changed. */
  set(openAtLogin: boolean): void
}

export function linuxAutostart(input: {
  home: string
  env: Record<string, string | undefined>
  execPath: string
}): LinuxAutostart {
  const directory = autostartDirectory(input.home, input.env)
  const file = posix.join(directory, AUTOSTART_FILE)
  return {
    isEnabled(): boolean {
      if (!existsSync(file)) return false
      try {
        // A user who turned the entry off in their desktop's startup settings.
        return !/^(X-GNOME-Autostart-enabled=false|Hidden=true)\s*$/m.test(
          readFileSync(file, 'utf8')
        )
      } catch {
        return false
      }
    },
    set(openAtLogin: boolean): void {
      if (!openAtLogin) {
        rmSync(file, { force: true })
        return
      }
      mkdirSync(directory, { recursive: true })
      writeFileAtomic(
        file,
        autostartDesktopEntry(autostartProgram(input.execPath, input.env)),
        0o644,
        'the start-at-login entry'
      )
    }
  }
}

/** True when this process was started by the autostart entry. */
export function launchedByAutostart(argv: readonly string[]): boolean {
  return argv.includes(LAUNCHED_AT_LOGIN_FLAG)
}
