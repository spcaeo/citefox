import { describe, expect, test } from 'vitest'
import { fakeRunner } from './fake-runner.test-helper'
import {
  OsJobError,
  LINUX_HEADLESS_SWITCHES,
  checkDueJobSpec,
  createOsJobInstaller,
  memoryOsJobInstaller,
  spawnCommandRunner,
  validateSpec
} from './index'
import type { OsJobSpec } from './index'

const SPEC: OsJobSpec = {
  program: '/Applications/CiteFox.app/Contents/MacOS/CiteFox',
  args: ['--check-due'],
  logDirectory: '/Users/me/Library/Logs/CiteFox',
  minute: 30
}

describe('createOsJobInstaller', () => {
  test('picks the scheduler for each platform without running anything', () => {
    const runner = fakeRunner()
    const make = (platform: NodeJS.Platform): string =>
      createOsJobInstaller({ platform, home: '/home/me', uid: 501, runner }).kind
    expect(make('darwin')).toBe('launchd')
    expect(make('win32')).toBe('task_scheduler')
    expect(make('linux')).toBe('systemd')
    expect(make('freebsd')).toBe('unsupported')
    expect(runner.calls).toEqual([])
  })

  test('defaults to the real spawn runner', () => {
    const installer = createOsJobInstaller({ platform: 'aix', home: '/home/me', uid: null })
    expect(installer.kind).toBe('unsupported')
  })

  test('an unsupported platform refuses to install and reports nothing installed', () => {
    const installer = createOsJobInstaller({ platform: 'sunos', home: '/home/me', uid: 1 })
    expect(() => installer.install(SPEC)).toThrow(OsJobError)
    expect(() => installer.install(SPEC)).toThrow(/not available on this system \(sunos\)/)
    expect(() => installer.remove()).not.toThrow()
    expect(installer.isInstalled()).toBe(false)
  })
})

describe('memoryOsJobInstaller', () => {
  test('install stores a copy of the spec and remove clears it', () => {
    const installer = memoryOsJobInstaller()
    expect(installer.isInstalled()).toBe(false)
    const args = ['--check-due']
    installer.install({ ...SPEC, args })
    args.push('--mutated')
    expect(installer.spec).toEqual(SPEC)
    expect(installer.isInstalled()).toBe(true)
    installer.remove()
    expect(installer.spec).toBeNull()
    expect(installer.isInstalled()).toBe(false)
    expect(memoryOsJobInstaller('systemd').kind).toBe('systemd')
  })

  test('install validates the spec like the real installers', () => {
    expect(() => memoryOsJobInstaller().install({ ...SPEC, minute: -1 })).toThrow(OsJobError)
  })
})

describe('checkDueJobSpec', () => {
  const base = {
    execPath: '/Applications/CiteFox.app/Contents/MacOS/CiteFox',
    appPath: '/Users/me/citefox',
    logDirectory: '/Users/me/Library/Logs/CiteFox',
    dailyCheckTime: '09:45',
    platform: 'darwin' as const
  }

  test('packaged builds run the executable with --check-due only', () => {
    expect(checkDueJobSpec({ ...base, isPackaged: true })).toEqual({
      program: base.execPath,
      args: ['--check-due'],
      logDirectory: base.logDirectory,
      minute: 45
    })
  })

  test('a custom --user-data-dir is passed on so the job checks the same data', () => {
    expect(
      checkDueJobSpec({ ...base, isPackaged: false, userDataDir: '/Users/me/citefox-data' }).args
    ).toEqual(['--user-data-dir=/Users/me/citefox-data', '/Users/me/citefox', '--check-due'])
    expect(
      checkDueJobSpec({ ...base, isPackaged: true, userDataDir: '/Users/me/citefox-data' }).args
    ).toEqual(['--user-data-dir=/Users/me/citefox-data', '--check-due'])
    expect(checkDueJobSpec({ ...base, isPackaged: true, userDataDir: null }).args).toEqual([
      '--check-due'
    ])
  })

  test('dev builds pass the app path before --check-due', () => {
    expect(checkDueJobSpec({ ...base, isPackaged: false })).toEqual({
      program: base.execPath,
      args: ['/Users/me/citefox', '--check-due'],
      logDirectory: base.logDirectory,
      minute: 45
    })
    expect(checkDueJobSpec({ ...base, isPackaged: true, dailyCheckTime: '00:00' }).minute).toBe(0)
    expect(checkDueJobSpec({ ...base, isPackaged: true, dailyCheckTime: '23:59' }).minute).toBe(59)
  })

  test('a packaged AppImage schedules the .AppImage file, not its temporary mount', () => {
    const linux = {
      ...base,
      execPath: '/tmp/.mount_CiteFoXy12ab/citefox',
      appPath: '/tmp/.mount_CiteFoXy12ab/resources/app.asar',
      logDirectory: '/home/me/.config/CiteFox/logs',
      platform: 'linux' as const
    }
    const appImage = '/home/me/Applications/CiteFox-0.1.0-arm64.AppImage'
    expect(checkDueJobSpec({ ...linux, isPackaged: true, appImage })).toEqual({
      program: appImage,
      args: ['--check-due', ...LINUX_HEADLESS_SWITCHES],
      logDirectory: linux.logDirectory,
      minute: 45
    })
    // A .deb install or a dev run has no usable $APPIMAGE.
    for (const value of [undefined, '', '  ', 'CiteFox.AppImage']) {
      expect(checkDueJobSpec({ ...linux, isPackaged: true, appImage: value }).program).toBe(
        linux.execPath
      )
    }
    expect(checkDueJobSpec({ ...linux, isPackaged: false, appImage }).program).toBe(linux.execPath)
  })

  test('the Linux job runs on the headless Ozone platform, so cron needs no display', () => {
    expect(LINUX_HEADLESS_SWITCHES).toEqual(['--ozone-platform=headless', '--disable-gpu'])
    const linux = { ...base, platform: 'linux' as const }
    expect(checkDueJobSpec({ ...linux, isPackaged: true }).args).toEqual([
      '--check-due',
      '--ozone-platform=headless',
      '--disable-gpu'
    ])
    expect(checkDueJobSpec({ ...linux, isPackaged: false }).args).toEqual([
      base.appPath,
      '--check-due',
      '--ozone-platform=headless',
      '--disable-gpu'
    ])
    for (const platform of ['darwin', 'win32'] as const) {
      expect(checkDueJobSpec({ ...base, platform, isPackaged: true }).args).toEqual(['--check-due'])
    }
  })

  test('rejects a time that is not HH:MM', () => {
    for (const time of ['9:45', '24:00', '12:60', '', '12:30:00']) {
      expect(() => checkDueJobSpec({ ...base, isPackaged: true, dailyCheckTime: time })).toThrow(
        OsJobError
      )
    }
  })
})

describe('validateSpec', () => {
  test('accepts absolute POSIX and Windows paths for their platforms', () => {
    expect(() => validateSpec(SPEC, 'posix')).not.toThrow()
    expect(() =>
      validateSpec(
        { ...SPEC, program: 'C:\\Program Files\\CiteFox\\CiteFox.exe', logDirectory: 'D:\\logs' },
        'win32'
      )
    ).not.toThrow()
    const windows = { ...SPEC, program: 'C:\\CiteFox\\CiteFox.exe' }
    expect(() =>
      validateSpec({ ...windows, logDirectory: '\\\\server\\share\\logs' }, 'win32')
    ).not.toThrow()
    expect(() => validateSpec({ ...windows, logDirectory: '\\logs' }, 'win32')).toThrow(OsJobError)
    expect(() => validateSpec(SPEC, 'win32')).toThrow(OsJobError)
  })

  test('rejects relative paths, bad minutes and control characters', () => {
    const bad: OsJobSpec[] = [
      { ...SPEC, program: '' },
      { ...SPEC, program: 'CiteFox' },
      { ...SPEC, logDirectory: 'logs' },
      { ...SPEC, minute: 60 },
      { ...SPEC, minute: 1.5 },
      { ...SPEC, minute: Number.NaN },
      { ...SPEC, program: '/bin/cite\u0000fox' },
      { ...SPEC, args: ['--check-due\r'] },
      { ...SPEC, logDirectory: '/logs\nevil' }
    ]
    for (const spec of bad) expect(() => validateSpec(spec)).toThrow(OsJobError)
    expect(() => validateSpec({ ...SPEC, program: 'C:\\CiteFox.exe' }, 'posix')).toThrow(OsJobError)
  })

  test('error messages name the setting and a next step', () => {
    expect(() => validateSpec({ ...SPEC, minute: 99 })).toThrow(
      /0 to 59\. Turn "Also check when CiteFox is closed" off and on again/
    )
  })
})

describe('spawnCommandRunner', () => {
  test('runs a program with an argument array and stdin, without a shell', () => {
    const result = spawnCommandRunner().run(
      process.execPath,
      [
        '-e',
        'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(process.argv[1]+"|"+s);process.stderr.write("e");process.exit(3)})',
        'a b; echo $HOME'
      ],
      { input: 'piped' }
    )
    expect(result).toEqual({ status: 3, stdout: 'a b; echo $HOME|piped', stderr: 'e', error: null })
  })

  test('reports a missing program as an error, not a throw', () => {
    const result = spawnCommandRunner().run('citefox-no-such-program-xyz', [])
    expect(result.status).toBeNull()
    expect(result.error).toMatch(/ENOENT/)
  })
})
