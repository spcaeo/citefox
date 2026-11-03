import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { fail, fakeRunner, notFound, ok, tempHome } from './fake-runner.test-helper'
import type { RecordedCall, TempHome } from './fake-runner.test-helper'
import { CRON_MARKER, cronInstaller, cronLine, rewriteCrontab, shQuote } from './cron'
import {
  SYSTEMD_SERVICE,
  SYSTEMD_TIMER,
  systemdInstaller,
  systemdQuote,
  systemdServiceUnit,
  systemdTimerUnit,
  systemdUserUnitDirectory
} from './systemd'
import { OsJobError } from './types'
import type { CommandResult, OsJobSpec } from './types'

// Skipped on Windows: install writes into a real temp home, and systemd and cron (Linux only) take
// only POSIX paths, which a Windows temp folder is not. Windows uses Task Scheduler instead.
const onWindows = process.platform === 'win32'

let temp: TempHome

beforeEach(() => {
  temp = tempHome()
})

afterEach(() => {
  temp.cleanup()
})

function spec(overrides: Partial<OsJobSpec> = {}): OsJobSpec {
  return {
    program: '/opt/CiteFox/citefox',
    args: ['--check-due'],
    logDirectory: join(temp.home, '.config', 'CiteFox', 'logs'),
    minute: 9,
    ...overrides
  }
}

/** A crontab stand-in holding the user's crontab text (null = "no crontab for user"). */
function crontab(initial: string | null): {
  respond: (call: RecordedCall) => CommandResult | undefined
  content: () => string | null
} {
  let content = initial
  return {
    content: () => content,
    respond: (call) => {
      if (call.file !== 'crontab') return undefined
      if (call.args[0] === '-l') {
        return content === null ? fail(1, 'no crontab for me') : ok(content)
      }
      content = call.input ?? ''
      return ok()
    }
  }
}

describe('systemd units', () => {
  test('the unit folder follows XDG_CONFIG_HOME, else ~/.config', () => {
    expect(systemdUserUnitDirectory('/home/me')).toBe('/home/me/.config/systemd/user')
    expect(systemdUserUnitDirectory('/home/me', { XDG_CONFIG_HOME: '/xdg' })).toBe(
      '/xdg/systemd/user'
    )
    expect(systemdUserUnitDirectory('/home/me', { XDG_CONFIG_HOME: 'relative' })).toBe(
      '/home/me/.config/systemd/user'
    )
  })

  test('the service is a oneshot with a quoted ExecStart and appended logs', () => {
    expect(
      systemdServiceUnit({
        program: '/opt/Cite Fox/citefox',
        args: ['/home/me/app', '--check-due'],
        logDirectory: '/home/me/logs',
        minute: 9
      })
    ).toBe(
      [
        '[Unit]',
        'Description=CiteFox: check pages that are due',
        '',
        '[Service]',
        'Type=oneshot',
        'ExecStart="/opt/Cite Fox/citefox" "/home/me/app" "--check-due"',
        'StandardOutput=append:/home/me/logs/check-due.log',
        'StandardError=append:/home/me/logs/check-due.err.log',
        ''
      ].join('\n')
    )
  })

  test('ExecStart words escape backslashes, quotes, specifiers and variables', () => {
    expect(systemdQuote('a\\b"c%d$e')).toBe('"a\\\\b\\"c%%d$$e"')
  })

  test('the timer fires hourly at the minute, persistently, and is wanted by timers.target', () => {
    expect(systemdTimerUnit(spec({ minute: 5 }))).toBe(
      [
        '[Unit]',
        'Description=CiteFox: hourly check for due pages',
        '',
        '[Timer]',
        'OnCalendar=*-*-* *:05:00',
        'Persistent=true',
        'Unit=citefox-checkdue.service',
        '',
        '[Install]',
        'WantedBy=timers.target',
        ''
      ].join('\n')
    )
  })
})

describe('systemdInstaller', () => {
  test.skipIf(onWindows)(
    'install writes both units, reloads and enables the timer, and clears old cron lines',
    () => {
      const tab = crontab(`0 1 * * * backup\n5 * * * * old ${CRON_MARKER}\n`)
      const runner = fakeRunner(tab.respond)
      const installer = systemdInstaller({ home: temp.home, runner })
      const unitDirectory = join(temp.home, '.config', 'systemd', 'user')

      installer.install(spec())

      expect(installer.kind).toBe('systemd')
      expect(readFileSync(join(unitDirectory, SYSTEMD_SERVICE), 'utf8')).toBe(
        systemdServiceUnit(spec())
      )
      expect(readFileSync(join(unitDirectory, SYSTEMD_TIMER), 'utf8')).toBe(
        systemdTimerUnit(spec())
      )
      expect(statSync(join(unitDirectory, SYSTEMD_TIMER)).mode & 0o777).toBe(0o644)
      expect(existsSync(spec().logDirectory)).toBe(true)
      expect(runner.calls.slice(0, 2)).toEqual([
        { file: 'systemctl', args: ['--user', 'daemon-reload'] },
        { file: 'systemctl', args: ['--user', 'enable', '--now', 'citefox-checkdue.timer'] }
      ])
      expect(tab.content()).toBe('0 1 * * * backup\n')
      expect(installer.isInstalled()).toBe(true)
    }
  )

  test.skipIf(onWindows)('install honours XDG_CONFIG_HOME', () => {
    const runner = fakeRunner(crontab(null).respond)
    const xdg = join(temp.home, 'xdg')
    systemdInstaller({ home: temp.home, env: { XDG_CONFIG_HOME: xdg }, runner }).install(spec())
    expect(existsSync(join(xdg, 'systemd', 'user', SYSTEMD_TIMER))).toBe(true)
  })

  test.skipIf(onWindows)(
    'falls back to cron when systemctl is missing, deleting the unit files',
    () => {
      const tab = crontab('MAILTO=me@example.com\n0 3 * * * /usr/bin/backup --all\n')
      const runner = fakeRunner((call) =>
        call.file === 'systemctl' ? notFound('systemctl') : tab.respond(call)
      )
      const installer = systemdInstaller({ home: temp.home, runner })
      const unitDirectory = join(temp.home, '.config', 'systemd', 'user')

      installer.install(spec({ args: ['--check-due', '--label=50%'] }))

      expect(existsSync(join(unitDirectory, SYSTEMD_SERVICE))).toBe(false)
      expect(existsSync(join(unitDirectory, SYSTEMD_TIMER))).toBe(false)
      const write = runner.calls.find((call) => call.file === 'crontab' && call.args[0] === '-')
      expect(write?.args).toEqual(['-'])
      const lines = (write?.input ?? '').split('\n')
      expect(lines.filter((line) => line.includes(CRON_MARKER))).toHaveLength(1)
      expect(lines.slice(0, 2)).toEqual([
        'MAILTO=me@example.com',
        '0 3 * * * /usr/bin/backup --all'
      ])
      expect(lines[2]).toMatch(
        /^9 \* \* \* \* \/opt\/CiteFox\/citefox --check-due '--label=50\\%' /
      )
      expect(lines[2]).not.toMatch(/[^\\]%/)
      expect(lines[2]?.endsWith(` ${CRON_MARKER}`)).toBe(true)
      expect(write?.input?.endsWith('\n')).toBe(true)
      expect(installer.isInstalled()).toBe(true)
    }
  )

  test.skipIf(onWindows)(
    'falls back to cron when enabling the timer fails, and replaces an older cron line',
    () => {
      const tab = crontab(`7 * * * * /old/citefox --check-due ${CRON_MARKER}\n@reboot me\n`)
      const runner = fakeRunner((call) => {
        if (call.file === 'systemctl' && call.args[1] === 'enable') {
          return fail(1, 'Failed to connect to bus: No medium found')
        }
        if (call.file === 'systemctl' && call.args[1] === 'is-enabled') return fail(1)
        return tab.respond(call)
      })
      const installer = systemdInstaller({ home: temp.home, runner })
      installer.install(spec())

      expect(runner.commands()).toContain('systemctl --user disable --now citefox-checkdue.timer')
      expect(existsSync(join(temp.home, '.config', 'systemd', 'user', SYSTEMD_TIMER))).toBe(false)
      expect(tab.content()).toBe(`@reboot me\n${cronLine(spec())}\n`)
      expect(installer.isInstalled()).toBe(true)
    }
  )

  test.skipIf(onWindows)(
    'install throws and leaves nothing behind when systemd and cron both fail',
    () => {
      const runner = fakeRunner((call) =>
        call.file === 'systemctl' ? notFound('systemctl') : notFound('crontab')
      )
      const installer = systemdInstaller({ home: temp.home, runner })
      expect(() => installer.install(spec())).toThrow(OsJobError)
      expect(() => installer.install(spec())).toThrow(/systemd .*ENOENT.*cron .*ENOENT/)
      expect(existsSync(join(temp.home, '.config', 'systemd', 'user', SYSTEMD_SERVICE))).toBe(false)
      expect(installer.isInstalled()).toBe(false)
    }
  )

  test('remove disables the timer, deletes the units, reloads and strips the cron line', () => {
    const tab = crontab(`0 1 * * * backup\n${cronLine(spec())}\n`)
    const runner = fakeRunner(tab.respond)
    const installer = systemdInstaller({ home: temp.home, runner })
    const unitDirectory = join(temp.home, '.config', 'systemd', 'user')
    mkdirSync(unitDirectory, { recursive: true })
    writeFileSync(join(unitDirectory, SYSTEMD_SERVICE), systemdServiceUnit(spec()))
    writeFileSync(join(unitDirectory, SYSTEMD_TIMER), systemdTimerUnit(spec()))

    installer.remove()

    expect(runner.calls.slice(0, 2).map((call) => [call.file, ...call.args])).toEqual([
      ['systemctl', '--user', 'disable', '--now', 'citefox-checkdue.timer'],
      ['systemctl', '--user', 'daemon-reload']
    ])
    expect(existsSync(join(unitDirectory, SYSTEMD_SERVICE))).toBe(false)
    expect(existsSync(join(unitDirectory, SYSTEMD_TIMER))).toBe(false)
    expect(tab.content()).toBe('0 1 * * * backup\n')
    expect(installer.isInstalled()).toBe(false)
  })

  test('remove is idempotent and ignores a missing systemctl and crontab', () => {
    const runner = fakeRunner((call) => notFound(call.file))
    const installer = systemdInstaller({ home: temp.home, runner })
    installer.remove()
    installer.remove()
    expect(installer.isInstalled()).toBe(false)
    expect(runner.calls.some((call) => call.file === 'crontab' && call.args[0] === '-')).toBe(false)
  })

  test('remove throws when the cron line cannot be removed', () => {
    const runner = fakeRunner((call) => {
      if (call.file === 'crontab' && call.args[0] === '-l') return ok(`${cronLine(spec())}\n`)
      if (call.file === 'crontab') return fail(1, 'crontab: permission denied')
      return undefined
    })
    expect(() => systemdInstaller({ home: temp.home, runner }).remove()).toThrow(
      /permission denied/
    )
  })

  test('isInstalled needs the timer file and is-enabled, or the cron marker', () => {
    const unitDirectory = join(temp.home, '.config', 'systemd', 'user')
    const enabled = fakeRunner((call) => (call.file === 'crontab' ? fail(1, 'no crontab') : ok()))
    expect(systemdInstaller({ home: temp.home, runner: enabled }).isInstalled()).toBe(false)

    mkdirSync(unitDirectory, { recursive: true })
    writeFileSync(join(unitDirectory, SYSTEMD_TIMER), systemdTimerUnit(spec()))
    expect(systemdInstaller({ home: temp.home, runner: enabled }).isInstalled()).toBe(true)
    expect(enabled.commands()).toContain('systemctl --user is-enabled citefox-checkdue.timer')

    const disabled = fakeRunner((call) =>
      call.file === 'crontab' ? fail(1, 'no crontab') : fail(1, 'disabled')
    )
    expect(systemdInstaller({ home: temp.home, runner: disabled }).isInstalled()).toBe(false)
  })
})

describe('cron', () => {
  test('shQuote leaves plain words bare and single-quotes the rest', () => {
    expect(shQuote('/opt/CiteFox/citefox')).toBe('/opt/CiteFox/citefox')
    expect(shQuote("/opt/Cite Fox/it's")).toBe(`'/opt/Cite Fox/it'\\''s'`)
    expect(shQuote('')).toBe(`''`)
  })

  test('cronLine runs hourly at the minute with quoted parts, logs and the marker', () => {
    expect(
      cronLine({
        program: '/opt/Cite Fox/citefox',
        args: ['/home/me/app', '--check-due'],
        logDirectory: '/home/me/logs',
        minute: 15
      })
    ).toBe(
      `15 * * * * '/opt/Cite Fox/citefox' /home/me/app --check-due >>/home/me/logs/check-due.log 2>>/home/me/logs/check-due.err.log ${CRON_MARKER}`
    )
  })

  test('rewriteCrontab keeps user lines and holds exactly one marker line', () => {
    expect(rewriteCrontab('', 'NEW')).toBe('NEW\n')
    expect(rewriteCrontab(`a\nold ${CRON_MARKER}\nb`, 'NEW')).toBe('a\nb\nNEW\n')
    expect(rewriteCrontab(`a\nx ${CRON_MARKER}\ny ${CRON_MARKER}\n`, null)).toBe('a\n')
    expect(rewriteCrontab(`x ${CRON_MARKER}\n`, null)).toBe('')
  })

  test.skipIf(onWindows)('cronInstaller installs, reports and removes its line', () => {
    const tab = crontab(null)
    const runner = fakeRunner(tab.respond)
    const installer = cronInstaller({ runner })
    expect(installer.kind).toBe('cron')
    expect(installer.isInstalled()).toBe(false)

    installer.install(spec())
    expect(tab.content()).toBe(`${cronLine(spec())}\n`)
    expect(installer.isInstalled()).toBe(true)

    installer.remove()
    expect(tab.content()).toBe('')
    expect(installer.isInstalled()).toBe(false)
    installer.remove()
  })

  test.skipIf(onWindows)('cronInstaller throws when crontab cannot be read', () => {
    const runner = fakeRunner(() => fail(1, 'crontab: you are not allowed to use this program'))
    expect(() => cronInstaller({ runner }).install(spec())).toThrow(/not allowed/)
    expect(runner.calls.some((call) => call.args[0] === '-')).toBe(false)
  })
})
