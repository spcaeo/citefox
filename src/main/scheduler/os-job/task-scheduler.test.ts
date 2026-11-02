import { describe, expect, test } from 'vitest'
import { fail, fakeRunner, ok } from './fake-runner.test-helper'
import {
  TASK_NAME,
  createTaskArgs,
  quoteWindowsArgument,
  taskSchedulerInstaller,
  windowsCommandLine
} from './task-scheduler'
import { OsJobError } from './types'
import type { OsJobSpec } from './types'

const LOGS = 'C:\\Users\\me\\AppData\\Roaming\\CiteFox\\logs'

function spec(overrides: Partial<OsJobSpec> = {}): OsJobSpec {
  return {
    program: 'C:\\Program Files\\CiteFox\\CiteFox.exe',
    args: ['--check-due'],
    logDirectory: LOGS,
    minute: 5,
    ...overrides
  }
}

describe('Windows command line quoting', () => {
  test('quotes only parts that need it', () => {
    expect(windowsCommandLine(['C:\\Program Files\\CiteFox\\CiteFox.exe', '--check-due'])).toBe(
      '"C:\\Program Files\\CiteFox\\CiteFox.exe" --check-due'
    )
    expect(windowsCommandLine(['C:\\CiteFox\\CiteFox.exe', '--check-due'])).toBe(
      'C:\\CiteFox\\CiteFox.exe --check-due'
    )
    expect(quoteWindowsArgument('')).toBe('""')
    expect(quoteWindowsArgument('a\tb')).toBe('"a\tb"')
  })

  test('doubles trailing backslashes inside quotes so they do not escape the closing quote', () => {
    expect(quoteWindowsArgument('C:\\My App\\')).toBe('"C:\\My App\\\\"')
    expect(quoteWindowsArgument('C:\\MyApp\\')).toBe('C:\\MyApp\\')
  })

  test('refuses double quotes', () => {
    expect(() => quoteWindowsArgument('say "hi"')).toThrow(OsJobError)
  })
})

describe('taskSchedulerInstaller', () => {
  test('install creates an hourly task at the minute with a quoted command and /F', () => {
    const runner = fakeRunner()
    const installer = taskSchedulerInstaller({ runner })
    installer.install(spec())
    expect(installer.kind).toBe('task_scheduler')
    expect(runner.calls).toEqual([
      {
        file: 'schtasks',
        args: [
          '/Create',
          '/SC',
          'HOURLY',
          '/MO',
          '1',
          '/ST',
          '00:05',
          '/TN',
          'CiteFox\\CheckDue',
          '/TR',
          '"C:\\Program Files\\CiteFox\\CiteFox.exe" --check-due',
          '/F'
        ]
      }
    ])
  })

  test('dev builds pass the app path as its own quoted argument', () => {
    const args = createTaskArgs(
      spec({
        program: 'C:\\Users\\me\\citefox\\node_modules\\electron\\dist\\electron.exe',
        args: ['C:\\Users\\me\\my projects\\citefox', '--check-due'],
        minute: 45
      })
    )
    expect(args[6]).toBe('00:45')
    expect(args[10]).toBe(
      'C:\\Users\\me\\citefox\\node_modules\\electron\\dist\\electron.exe "C:\\Users\\me\\my projects\\citefox" --check-due'
    )
  })

  test('install rejects quotes, relative paths and over-long commands without running schtasks', () => {
    const runner = fakeRunner()
    const installer = taskSchedulerInstaller({ runner })
    expect(() => installer.install(spec({ args: ['--name="x"'] }))).toThrow(OsJobError)
    expect(() => installer.install(spec({ program: 'CiteFox.exe' }))).toThrow(OsJobError)
    expect(() => installer.install(spec({ program: '/usr/bin/citefox' }))).toThrow(OsJobError)
    expect(() => installer.install(spec({ program: `C:\\${'x'.repeat(300)}.exe` }))).toThrow(
      /longer than Windows Task Scheduler allows/
    )
    expect(runner.calls).toEqual([])
  })

  test('install throws a user-facing error when schtasks fails', () => {
    const runner = fakeRunner(() => fail(1, 'ERROR: Access is denied.\r\n'))
    const installer = taskSchedulerInstaller({ runner })
    expect(() => installer.install(spec())).toThrow(OsJobError)
    expect(() => installer.install(spec())).toThrow(/schtasks: ERROR: Access is denied\.\)/)
  })

  test('remove deletes the task with /F and confirms it is gone', () => {
    const runner = fakeRunner((call) => (call.args[0] === '/Query' ? fail(1) : undefined))
    taskSchedulerInstaller({ runner }).remove()
    expect(runner.calls.map((call) => [call.file, ...call.args])).toEqual([
      ['schtasks', '/Delete', '/TN', TASK_NAME, '/F'],
      ['schtasks', '/Query', '/TN', TASK_NAME]
    ])
  })

  test('remove of a missing task is fine', () => {
    const runner = fakeRunner(() => fail(1, 'ERROR: The system cannot find the file specified.'))
    expect(() => taskSchedulerInstaller({ runner }).remove()).not.toThrow()
  })

  test('remove throws when the task is still registered afterwards', () => {
    const runner = fakeRunner((call) =>
      call.args[0] === '/Query' ? ok() : fail(1, 'ERROR: Access is denied.')
    )
    expect(() => taskSchedulerInstaller({ runner }).remove()).toThrow(/Access is denied/)
  })

  test('isInstalled queries the task by name', () => {
    const present = fakeRunner(() => ok('CiteFox\\CheckDue  Ready'))
    expect(taskSchedulerInstaller({ runner: present }).isInstalled()).toBe(true)
    expect(present.calls).toEqual([{ file: 'schtasks', args: ['/Query', '/TN', TASK_NAME] }])
    const missing = fakeRunner(() => fail(1))
    expect(taskSchedulerInstaller({ runner: missing }).isInstalled()).toBe(false)
  })
})
