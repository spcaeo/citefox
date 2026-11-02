import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { appToolsMode, createFakeAppTools, E2E_APP_TOOLS_FILE } from '../app-tools'
import { createLogger } from '../logging/logger'
import { keychainServiceFor, TEST_PROFILE_KEYCHAIN_SERVICE } from '../secrets/keychain'
import {
  CLOSE_TEST_WINDOW_FIRST,
  clearTestProfile,
  openTestProfile,
  type ServiceKeychain,
  type TestProfileDeps
} from './open'
import {
  clearTestProfileRunning,
  isTestProfileLaunch,
  markTestProfileRunning,
  TEST_PROFILE_FOLDER,
  testProfileDataDir,
  testProfileLaunchArgs,
  testProfileRunning
} from './profile'

const temp: string[] = []

afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function appData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-appdata-'))
  temp.push(dir)
  return dir
}

function memoryKeychain(service: string, accounts: string[]): ServiceKeychain & { left: string[] } {
  const keychain = {
    service,
    left: [...accounts],
    accounts: () => [...keychain.left],
    remove(account: string): void {
      keychain.left = keychain.left.filter((item) => item !== account)
    }
  }
  return keychain
}

function deps(overrides: Partial<TestProfileDeps> = {}): TestProfileDeps & { launches: number } {
  const state = {
    launches: 0,
    dataDir: testProfileDataDir(appData()),
    keychain: memoryKeychain(TEST_PROFILE_KEYCHAIN_SERVICE, []),
    isRunning: () => false,
    launch: () => {
      state.launches += 1
    },
    logger: createLogger({ write: () => undefined }),
    ...overrides
  }
  return state
}

describe('test profile launch', () => {
  test('starts on its own folder and switch, with the app path only when unpackaged', () => {
    const dir = testProfileDataDir('/Users/ada/Library/Application Support')
    expect(dir).toBe(join('/Users/ada/Library/Application Support', 'CiteFox Test Profile'))
    expect(testProfileLaunchArgs({ isPackaged: true, appPath: '/app', dataDir: dir })).toEqual([
      `--user-data-dir=${dir}`,
      '--citefox-test-profile'
    ])
    expect(testProfileLaunchArgs({ isPackaged: false, appPath: '/app', dataDir: dir })).toEqual([
      '/app',
      `--user-data-dir=${dir}`,
      '--citefox-test-profile'
    ])
    expect(isTestProfileLaunch(['/CiteFox', '--citefox-test-profile'])).toBe(true)
    expect(isTestProfileLaunch(['/CiteFox', '--check-due'])).toBe(false)
  })

  test('uses its own keychain service, never the real one', () => {
    expect(keychainServiceFor(false)).toBe('CiteFox')
    expect(keychainServiceFor(true)).toBe('CiteFox Test')
  })

  test('knows a running test window by its process, and ignores one left by a crash', () => {
    const dir = testProfileDataDir(appData())
    expect(testProfileRunning(dir)).toBe(false)
    markTestProfileRunning(dir, process.pid)
    expect(testProfileRunning(dir)).toBe(true)
    expect(testProfileRunning(dir, () => false)).toBe(false)
    clearTestProfileRunning(dir, process.pid + 1)
    expect(testProfileRunning(dir)).toBe(true)
    clearTestProfileRunning(dir, process.pid)
    expect(testProfileRunning(dir)).toBe(false)
  })
})

describe('open the test profile', () => {
  test('opens a new window', () => {
    const d = deps()
    expect(openTestProfile(d, { fresh: false })).toEqual({ ok: true, alreadyOpen: false })
    expect(d.launches).toBe(1)
  })

  test('an open test window is focused through its own lock', () => {
    const d = deps({ isRunning: () => true })
    expect(openTestProfile(d, { fresh: false })).toEqual({ ok: true, alreadyOpen: true })
    expect(d.launches).toBe(1)
  })

  test('start fresh waits until the test window is closed', () => {
    const d = deps({ isRunning: () => true })
    mkdirSync(d.dataDir, { recursive: true })
    expect(openTestProfile(d, { fresh: true })).toEqual({
      ok: false,
      message: CLOSE_TEST_WINDOW_FIRST
    })
    expect(d.launches).toBe(0)
    expect(existsSync(d.dataDir)).toBe(true)
  })

  test('start fresh clears the folder and the test keychain items, then opens', () => {
    const keychain = memoryKeychain(TEST_PROFILE_KEYCHAIN_SERVICE, ['citefox.serpapi.a', 'b'])
    const d = deps({ keychain })
    mkdirSync(d.dataDir, { recursive: true })
    writeFileSync(join(d.dataDir, 'app.sqlite'), 'old test data')
    expect(openTestProfile(d, { fresh: true })).toEqual({ ok: true, alreadyOpen: false })
    expect(existsSync(d.dataDir)).toBe(false)
    expect(keychain.left).toEqual([])
    expect(d.launches).toBe(1)
  })

  test('never clears the real keychain service or another folder', () => {
    const real = memoryKeychain('CiteFox', ['citefox.serpapi.real'])
    expect(() => clearTestProfile(deps({ keychain: real }))).toThrow(/not the test profile/)
    expect(real.left).toEqual(['citefox.serpapi.real'])
    const realFolder = join(appData(), 'CiteFox')
    mkdirSync(realFolder)
    expect(() => clearTestProfile(deps({ dataDir: realFolder }))).toThrow(/not the test profile/)
    expect(existsSync(realFolder)).toBe(true)
    expect(TEST_PROFILE_FOLDER).toBe('CiteFox Test Profile')
  })

  test('a failed clear opens nothing and says so', () => {
    const keychain = memoryKeychain(TEST_PROFILE_KEYCHAIN_SERVICE, ['a'])
    keychain.remove = () => {
      throw new Error('locked')
    }
    const d = deps({ keychain })
    const result = openTestProfile(d, { fresh: true })
    expect(result.ok).toBe(false)
    expect(d.launches).toBe(0)
  })
})

describe('testing tools in test runs', () => {
  test('an unpackaged run uses the fake unless asked for the real tools', () => {
    expect(appToolsMode(true, { CITEFOX_E2E_APP_TOOLS: 'record' })).toBe('real')
    expect(appToolsMode(false, {})).toBe('record')
    expect(appToolsMode(false, { CITEFOX_E2E_APP_TOOLS: 'fail' })).toBe('fail')
    expect(appToolsMode(false, { CITEFOX_E2E_APP_TOOLS: 'real' })).toBe('real')
  })

  test('the fake records each call and follows the real rules', () => {
    const userData = appData()
    const tools = createFakeAppTools({
      userData,
      fail: false,
      now: () => new Date('2026-10-22T20:00:00.000Z')
    })
    expect(tools.openTestProfile({ fresh: false })).toEqual({ ok: true, alreadyOpen: false })
    expect(tools.openTestProfile({ fresh: false })).toEqual({ ok: true, alreadyOpen: true })
    expect(tools.openTestProfile({ fresh: true })).toEqual({
      ok: false,
      message: CLOSE_TEST_WINDOW_FIRST
    })
    expect(tools.resetKeepKeys()).toEqual({ ok: true })
    const lines = readFileSync(join(userData, E2E_APP_TOOLS_FILE), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown)
    expect(lines).toEqual([
      { channel: 'app:openTestProfile', request: { fresh: false }, at: '2026-10-22T20:00:00.000Z' },
      { channel: 'app:openTestProfile', request: { fresh: false }, at: '2026-10-22T20:00:00.000Z' },
      { channel: 'app:openTestProfile', request: { fresh: true }, at: '2026-10-22T20:00:00.000Z' },
      { channel: 'app:resetKeepKeys', request: null, at: '2026-10-22T20:00:00.000Z' }
    ])
  })

  test('the failing fake answers ok: false', () => {
    const tools = createFakeAppTools({ userData: appData(), fail: true })
    expect(tools.resetKeepKeys()).toEqual({
      ok: false,
      message: 'CiteFox could not reset (test run).'
    })
    expect(tools.openTestProfile({ fresh: false })).toEqual({
      ok: false,
      message: 'CiteFox could not open the test window (test run).'
    })
  })
})
