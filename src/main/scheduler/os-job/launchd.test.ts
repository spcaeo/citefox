import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { fail, fakeRunner, ok } from './fake-runner.test-helper'
import { tempHome } from './fake-runner.test-helper'
import type { RecordedCall, TempHome } from './fake-runner.test-helper'
import { LAUNCHD_LABEL, launchAgentPlist, launchAgentPlistPath, launchdInstaller } from './launchd'
import { OsJobError } from './types'
import type { CommandResult, OsJobSpec } from './types'

const SERVICE = `gui/501/${LAUNCHD_LABEL}`

// Skipped on Windows: install writes into a real temp home, and launchd (macOS only) takes only
// POSIX paths, which a Windows temp folder is not. Windows uses Task Scheduler instead.
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
    program: '/Applications/CiteFox.app/Contents/MacOS/CiteFox',
    args: ['--check-due'],
    logDirectory: join(temp.home, 'Library', 'Logs', 'CiteFox'),
    minute: 7,
    ...overrides
  }
}

/** A launchd stand-in: bootstrap/load register the job, bootout/unload unregister it. */
function launchctl(
  options: {
    loaded?: boolean
    bootstrap?: CommandResult
    load?: CommandResult
    loadRegisters?: boolean
    bootout?: CommandResult
  } = {}
): (call: RecordedCall) => CommandResult | undefined {
  let loaded = options.loaded ?? false
  return (call) => {
    expect(call.file).toBe('launchctl')
    const [command] = call.args
    if (command === 'print') return loaded ? ok('state = waiting') : fail(113, 'Could not find')
    if (command === 'bootstrap') {
      const result = options.bootstrap ?? ok()
      if (result.status === 0) loaded = true
      return result
    }
    if (command === 'load') {
      const result = options.load ?? ok()
      if (result.status === 0 && options.loadRegisters !== false) loaded = true
      return result
    }
    if (command === 'bootout' || command === 'unload') {
      const result = options.bootout ?? (loaded ? ok() : fail(3, 'No such process'))
      if (result.status === 0) loaded = false
      return result
    }
    return undefined
  }
}

describe('launchAgentPlist', () => {
  test('is an hourly background LaunchAgent that runs the program with its arguments', () => {
    const xml = launchAgentPlist({
      program: '/Applications/CiteFox.app/Contents/MacOS/CiteFox',
      args: ['/Users/me/citefox', '--check-due'],
      logDirectory: '/Users/me/Library/Logs/CiteFox',
      minute: 7
    })
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '\t<key>Label</key>',
        '\t<string>app.citefox.checkdue</string>',
        '\t<key>ProgramArguments</key>',
        '\t<array>',
        '\t\t<string>/Applications/CiteFox.app/Contents/MacOS/CiteFox</string>',
        '\t\t<string>/Users/me/citefox</string>',
        '\t\t<string>--check-due</string>',
        '\t</array>',
        '\t<key>StartCalendarInterval</key>',
        '\t<dict>',
        '\t\t<key>Minute</key>',
        '\t\t<integer>7</integer>',
        '\t</dict>',
        '\t<key>RunAtLoad</key>',
        '\t<false/>',
        '\t<key>ProcessType</key>',
        '\t<string>Background</string>',
        '\t<key>StandardOutPath</key>',
        '\t<string>/Users/me/Library/Logs/CiteFox/check-due.log</string>',
        '\t<key>StandardErrorPath</key>',
        '\t<string>/Users/me/Library/Logs/CiteFox/check-due.err.log</string>',
        '</dict>',
        '</plist>',
        ''
      ].join('\n')
    )
  })

  test('XML-escapes every string', () => {
    const xml = launchAgentPlist({
      program: '/Apps/R&D <beta>/CiteFox',
      args: ['--name="a\'b"', '--check-due'],
      logDirectory: '/Logs/Q&A>',
      minute: 0
    })
    expect(xml).toContain('<string>/Apps/R&amp;D &lt;beta&gt;/CiteFox</string>')
    expect(xml).toContain('<string>--name=&quot;a&apos;b&quot;</string>')
    expect(xml).toContain('<string>/Logs/Q&amp;A&gt;/check-due.log</string>')
    expect(xml).toContain('<string>/Logs/Q&amp;A&gt;/check-due.err.log</string>')
    expect(xml).toContain('<integer>0</integer>')
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/)
  })
})

describe('launchdInstaller', () => {
  test.skipIf(onWindows)(
    'install creates the folders, writes the plist and bootstraps it into gui/<uid>',
    () => {
      const runner = fakeRunner(launchctl())
      const installer = launchdInstaller({ home: temp.home, uid: 501, runner })
      const plistPath = launchAgentPlistPath(temp.home)
      expect(plistPath).toBe(
        join(temp.home, 'Library', 'LaunchAgents', 'app.citefox.checkdue.plist')
      )

      installer.install(spec())

      expect(installer.kind).toBe('launchd')
      expect(runner.calls.map((call) => call.args)).toEqual([
        ['print', SERVICE],
        ['bootstrap', 'gui/501', plistPath]
      ])
      expect(readFileSync(plistPath, 'utf8')).toBe(launchAgentPlist(spec()))
      expect(statSync(plistPath).mode & 0o777).toBe(0o644)
      expect(existsSync(spec().logDirectory)).toBe(true)
      expect(installer.isInstalled()).toBe(true)
    }
  )

  test.skipIf(onWindows)(
    'install replaces a loaded job: bootout first, then bootstrap the new plist',
    () => {
      const runner = fakeRunner(launchctl({ loaded: true }))
      const installer = launchdInstaller({ home: temp.home, uid: 501, runner })
      installer.install(spec({ minute: 30 }))
      expect(runner.calls.map((call) => call.args)).toEqual([
        ['print', SERVICE],
        ['bootout', SERVICE],
        ['bootstrap', 'gui/501', launchAgentPlistPath(temp.home)]
      ])
      expect(readFileSync(launchAgentPlistPath(temp.home), 'utf8')).toContain(
        '<integer>30</integer>'
      )
    }
  )

  test.skipIf(onWindows)('install ignores a failing bootout of the old job', () => {
    const runner = fakeRunner(launchctl({ loaded: true, bootout: fail(5, 'Input/output error') }))
    launchdInstaller({ home: temp.home, uid: 501, runner }).install(spec())
    expect(runner.commands()).toContain(
      `launchctl bootstrap gui/501 ${launchAgentPlistPath(temp.home)}`
    )
  })

  test.skipIf(onWindows)('install falls back to load -w when bootstrap fails', () => {
    const runner = fakeRunner(launchctl({ bootstrap: fail(5, 'Bootstrap failed: 5') }))
    const installer = launchdInstaller({ home: temp.home, uid: 501, runner })
    const plistPath = launchAgentPlistPath(temp.home)
    installer.install(spec())
    expect(runner.calls.map((call) => call.args)).toEqual([
      ['print', SERVICE],
      ['bootstrap', 'gui/501', plistPath],
      ['load', '-w', plistPath],
      ['print', SERVICE]
    ])
    expect(existsSync(plistPath)).toBe(true)
  })

  test.skipIf(onWindows)(
    'install deletes the plist and throws when bootstrap and load both fail',
    () => {
      const runner = fakeRunner(
        launchctl({ bootstrap: fail(5, 'Bootstrap failed: 5: Input/output error'), load: fail(1) })
      )
      const installer = launchdInstaller({ home: temp.home, uid: 501, runner })
      expect(() => installer.install(spec())).toThrow(OsJobError)
      expect(() => installer.install(spec())).toThrow(/Bootstrap failed: 5.*Nothing was installed/)
      expect(existsSync(launchAgentPlistPath(temp.home))).toBe(false)
      expect(installer.isInstalled()).toBe(false)
    }
  )

  test('install treats a load that exits 0 without registering as a failure', () => {
    const runner = fakeRunner(launchctl({ bootstrap: fail(5), loadRegisters: false }))
    const installer = launchdInstaller({ home: temp.home, uid: 501, runner })
    expect(() => installer.install(spec())).toThrow(OsJobError)
    expect(existsSync(launchAgentPlistPath(temp.home))).toBe(false)
  })

  test('install rejects an invalid spec before touching launchctl or the disk', () => {
    const runner = fakeRunner(launchctl())
    const installer = launchdInstaller({ home: temp.home, uid: 501, runner })
    expect(() => installer.install(spec({ program: 'CiteFox' }))).toThrow(OsJobError)
    expect(() => installer.install(spec({ minute: 60 }))).toThrow(OsJobError)
    expect(() => installer.install(spec({ args: ['--check-due\n--evil'] }))).toThrow(OsJobError)
    expect(runner.calls).toEqual([])
    expect(existsSync(dirname(launchAgentPlistPath(temp.home)))).toBe(false)
  })

  test.skipIf(onWindows)('install without a user ID throws a user-facing error', () => {
    const runner = fakeRunner(launchctl())
    const installer = launchdInstaller({ home: temp.home, uid: null, runner })
    expect(() => installer.install(spec())).toThrow(/user ID/)
    expect(runner.calls).toEqual([])
    expect(installer.isInstalled()).toBe(false)
  })

  test.skipIf(onWindows)('remove boots the job out, then deletes the plist', () => {
    const runner = fakeRunner(launchctl())
    const installer = launchdInstaller({ home: temp.home, uid: 501, runner })
    installer.install(spec())
    runner.calls.length = 0

    installer.remove()

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['bootout', SERVICE],
      ['print', SERVICE]
    ])
    expect(existsSync(launchAgentPlistPath(temp.home))).toBe(false)
    expect(installer.isInstalled()).toBe(false)
  })

  test('remove falls back to unload -w when bootout fails', () => {
    let loaded = true
    const runner = fakeRunner((call) => {
      if (call.args[0] === 'bootout') return fail(5, 'Boot-out failed')
      if (call.args[0] === 'unload') {
        loaded = false
        return ok()
      }
      if (call.args[0] === 'print') return loaded ? ok() : fail(113)
      return undefined
    })
    const plistPath = launchAgentPlistPath(temp.home)
    mkdirSync(dirname(plistPath), { recursive: true })
    writeFileSync(plistPath, launchAgentPlist(spec()))

    launchdInstaller({ home: temp.home, uid: 501, runner }).remove()

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['bootout', SERVICE],
      ['unload', '-w', plistPath],
      ['print', SERVICE]
    ])
    expect(existsSync(plistPath)).toBe(false)
  })

  test('remove is idempotent when nothing is installed', () => {
    const runner = fakeRunner(launchctl())
    const installer = launchdInstaller({ home: temp.home, uid: 501, runner })
    installer.remove()
    installer.remove()
    expect(installer.isInstalled()).toBe(false)
    expect(launchdInstaller({ home: temp.home, uid: null, runner }).remove()).toBeUndefined()
  })

  test('remove throws when the job is still registered afterwards', () => {
    const runner = fakeRunner((call) => (call.args[0] === 'print' ? ok() : fail(5, 'denied')))
    const installer = launchdInstaller({ home: temp.home, uid: 501, runner })
    expect(() => installer.remove()).toThrow(OsJobError)
  })

  test('isInstalled is false when the plist is missing, even if launchd still knows the job', () => {
    const runner = fakeRunner(() => ok())
    const installer = launchdInstaller({ home: temp.home, uid: 501, runner })
    expect(installer.isInstalled()).toBe(false)
  })

  test('isInstalled is false when the plist exists but launchctl print fails', () => {
    const plistPath = launchAgentPlistPath(temp.home)
    mkdirSync(dirname(plistPath), { recursive: true })
    writeFileSync(plistPath, launchAgentPlist(spec()))
    const runner = fakeRunner(() => fail(113, 'Could not find service'))
    const installer = launchdInstaller({ home: temp.home, uid: 501, runner })
    expect(installer.isInstalled()).toBe(false)
    expect(runner.calls.map((call) => call.args)).toEqual([['print', SERVICE]])
  })
})
