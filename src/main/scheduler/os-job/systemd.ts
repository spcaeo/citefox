import { existsSync } from 'node:fs'
import { posix } from 'node:path'
import { installCronLine, crontabHasMarker, stripCronMarker, CRON_MARKER } from './cron'
import {
  NEXT_STEP,
  ensureDirectory,
  failureDetail,
  logPaths,
  removeFile,
  removeFileQuietly,
  succeeded,
  twoDigits,
  validateSpec,
  writeFileAtomic
} from './shared'
import { OsJobError } from './types'
import type { CommandResult, CommandRunner, OsJobInstaller, OsJobSpec } from './types'

export { cronInstaller, cronLine, CRON_MARKER, shQuote } from './cron'

export const SYSTEMD_SERVICE = 'citefox-checkdue.service'
export const SYSTEMD_TIMER = 'citefox-checkdue.timer'

/** `$XDG_CONFIG_HOME/systemd/user`, falling back to `~/.config/systemd/user`. Linux only: POSIX paths. */
export function systemdUserUnitDirectory(
  home: string,
  env: Record<string, string | undefined> = {}
): string {
  const configured = env.XDG_CONFIG_HOME
  const configHome =
    configured !== undefined && configured !== '' && posix.isAbsolute(configured)
      ? configured
      : posix.join(home, '.config')
  return posix.join(configHome, 'systemd', 'user')
}

/** `%` starts a unit-file specifier; `%%` is a literal percent sign. */
function escapeSpecifiers(value: string): string {
  return value.replace(/%/g, '%%')
}

/** One ExecStart word: always double-quoted, with backslash, quote, specifier and `$` escaped. */
export function systemdQuote(value: string): string {
  const escaped = escapeSpecifiers(value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')).replace(
    /\$/g,
    () => '$$'
  )
  return `"${escaped}"`
}

export function systemdServiceUnit(spec: OsJobSpec): string {
  const logs = logPaths(spec)
  return [
    '[Unit]',
    'Description=CiteFox: check pages that are due',
    '',
    '[Service]',
    'Type=oneshot',
    `ExecStart=${[spec.program, ...spec.args].map(systemdQuote).join(' ')}`,
    `StandardOutput=append:${escapeSpecifiers(logs.stdout)}`,
    `StandardError=append:${escapeSpecifiers(logs.stderr)}`,
    ''
  ].join('\n')
}

export function systemdTimerUnit(spec: OsJobSpec): string {
  return [
    '[Unit]',
    'Description=CiteFox: hourly check for due pages',
    '',
    '[Timer]',
    `OnCalendar=*-*-* *:${twoDigits(spec.minute)}:00`,
    'Persistent=true',
    `Unit=${SYSTEMD_SERVICE}`,
    '',
    '[Install]',
    'WantedBy=timers.target',
    ''
  ].join('\n')
}

/**
 * Linux: a systemd user timer. When systemctl is missing or refuses, the unit files are deleted
 * and the job goes into the user's crontab instead.
 */
export function systemdInstaller(input: {
  home: string
  env?: Record<string, string | undefined>
  runner: CommandRunner
}): OsJobInstaller {
  const { runner } = input
  const unitDirectory = systemdUserUnitDirectory(input.home, input.env)
  const servicePath = posix.join(unitDirectory, SYSTEMD_SERVICE)
  const timerPath = posix.join(unitDirectory, SYSTEMD_TIMER)
  const systemctl = (...args: string[]): CommandResult =>
    runner.run('systemctl', ['--user', ...args])

  function deleteUnitsQuietly(): void {
    removeFileQuietly(timerPath)
    removeFileQuietly(servicePath)
  }

  /** Returns a failure detail, or null when the timer is enabled and started. */
  function installSystemd(spec: OsJobSpec): string | null {
    try {
      ensureDirectory(unitDirectory, 'the systemd user unit folder')
      writeFileAtomic(servicePath, systemdServiceUnit(spec), 0o644, 'the background check service')
      writeFileAtomic(timerPath, systemdTimerUnit(spec), 0o644, 'the background check timer')
    } catch (error) {
      deleteUnitsQuietly()
      return error instanceof Error ? error.message : String(error)
    }
    const reload = systemctl('daemon-reload')
    const enable = succeeded(reload) ? systemctl('enable', '--now', SYSTEMD_TIMER) : reload
    if (succeeded(enable)) return null
    systemctl('disable', '--now', SYSTEMD_TIMER)
    deleteUnitsQuietly()
    if (succeeded(reload)) systemctl('daemon-reload')
    return `systemctl: ${failureDetail(enable)}`
  }

  function timerEnabled(): boolean {
    return existsSync(timerPath) && succeeded(systemctl('is-enabled', SYSTEMD_TIMER))
  }

  return {
    kind: 'systemd',

    install(spec: OsJobSpec): void {
      validateSpec(spec, 'posix')
      ensureDirectory(spec.logDirectory, 'the background check log folder')
      const systemdFailure = installSystemd(spec)
      if (systemdFailure === null) {
        // A cron line from an earlier fallback would make the check run twice.
        stripCronMarker(runner)
        return
      }
      const cronFailure = installCronLine(runner, spec)
      if (cronFailure === null) return
      throw new OsJobError(
        `CiteFox could not register its background check with systemd (${systemdFailure}) or cron (${cronFailure}). Nothing was installed. ${NEXT_STEP}`
      )
    },

    remove(): void {
      systemctl('disable', '--now', SYSTEMD_TIMER)
      removeFile(timerPath, 'the background check timer')
      removeFile(servicePath, 'the background check service')
      systemctl('daemon-reload')
      const cronFailure = stripCronMarker(runner)
      if (existsSync(timerPath) || existsSync(servicePath)) {
        throw new OsJobError(
          `CiteFox could not delete its systemd timer in ${unitDirectory}. Delete ${SYSTEMD_TIMER} and ${SYSTEMD_SERVICE} there, then turn the setting off again.`
        )
      }
      if (cronFailure !== null || crontabHasMarker(runner)) {
        throw new OsJobError(
          `CiteFox could not remove its background check from your crontab (crontab: ${cronFailure ?? 'the line is still there'}). Run "crontab -e" and delete the line ending in "${CRON_MARKER}".`
        )
      }
    },

    isInstalled(): boolean {
      return timerEnabled() || crontabHasMarker(runner)
    }
  }
}
