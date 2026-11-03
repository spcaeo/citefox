import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { atomicWriteFile, type AtomicFileIo } from './atomic-file'
import { StorageError } from './errors'
import {
  defaultAppSchedule,
  defaultSettings,
  readAppSchedule,
  readSettings,
  writeAppSchedule,
  writeSettings,
  type AppSettings
} from './settings'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('settings.json', () => {
  test('returns typed defaults when the file is missing and does not create it', () => {
    const file = tempFile()
    expect(readSettings(file)).toEqual(defaultSettings())
    expect(() => statSync(file)).toThrow()
    const again = defaultSettings()
    again.userName = 'Ada'
    expect(defaultSettings().userName).toBeNull()
    expect(defaultSettings().defaultCountry).toBeNull()
    expect(defaultSettings().defaultLanguage).toBeNull()
    expect(defaultSettings().defaultIntervalDays).toBe(7)
    expect(defaultSettings().defaultDevice).toBe('desktop')
    expect(defaultSettings().claudeConcurrency).toBe(2)
    expect(defaultSettings().claudeProvider).toBe('claude-code')
    expect(defaultSettings().jinaMode).toBe('fallback')
    expect(defaultSettings().serpapiRotation).toBe('in_order')
  })

  test('writes atomically and reads the same settings back', () => {
    const file = tempFile()
    const settings = defaultSettings()
    settings.userName = 'Ada Lovelace'
    settings.defaultCountry = 'GB'
    settings.defaultLanguage = 'en'
    settings.defaultLocation = 'London'
    settings.defaultIntervalDays = 30
    settings.defaultSamples = 3
    writeSettings(file, settings)
    expect(readSettings(file)).toEqual(settings)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true)
    const leftovers = readFileSync(file, 'utf8')
    expect(leftovers).not.toMatch(/\.tmp/)
  })

  test('fills defaults for a partial current schema and migrates a versionless file', () => {
    const partial = tempFile()
    writeFileSync(partial, JSON.stringify({ schemaVersion: 1, userName: 'Ada' }))
    const read = readSettings(partial)
    expect(read.userName).toBe('Ada')
    expect(read.defaultIntervalDays).toBe(7)
    expect(read.defaultCountry).toBeNull()
    expect(read.claudeConcurrency).toBe(2)
    expect(read.serpapiRotation).toBe('in_order')

    const legacy = tempFile()
    writeFileSync(legacy, JSON.stringify({ userName: 'Grace' }))
    expect(readSettings(legacy).userName).toBe('Grace')
    expect(readSettings(legacy).defaultIntervalDays).toBe(7)

    // A saved interval keeps its value: 14 stays 14, and every day reads back.
    const saved = tempFile()
    writeFileSync(saved, JSON.stringify({ schemaVersion: 1, defaultIntervalDays: 14 }))
    expect(readSettings(saved).defaultIntervalDays).toBe(14)
    const daily = tempFile()
    writeFileSync(daily, JSON.stringify({ schemaVersion: 1, defaultIntervalDays: 1 }))
    expect(readSettings(daily).defaultIntervalDays).toBe(1)
    expect(readSettings(legacy).jinaMode).toBe('fallback')
    expect(readSettings(legacy).serpapiRotation).toBe('in_order')
  })

  test('refuses a newer schema and an invalid market without echoing the file', () => {
    const newer = tempFile()
    writeFileSync(newer, '{"schemaVersion":3,"note":"keep"}')
    expect(() => readSettings(newer)).toThrow(StorageError)
    expect(() => readSettings(newer)).toThrow(/newer/)

    const badCountry = tempFile()
    const settings = defaultSettings()
    writeSettings(badCountry, settings)
    const broken = JSON.parse(readFileSync(badCountry, 'utf8')) as AppSettings & {
      schemaVersion: number
    }
    broken.defaultCountry = 'USA'
    writeFileSync(badCountry, JSON.stringify(broken))
    expect(() => readSettings(badCountry)).toThrow(/country/)

    const uk = defaultSettings()
    uk.defaultCountry = 'UK'
    uk.defaultLanguage = 'pt-BR'
    const ukFile = tempFile()
    writeSettings(ukFile, uk)
    expect(readSettings(ukFile).defaultCountry).toBe('UK')
    expect(readSettings(ukFile).defaultLanguage).toBe('pt-BR')

    const badLanguage = defaultSettings()
    badLanguage.defaultLanguage = 'EN'
    expect(() => writeSettings(tempFile(), badLanguage)).toThrow(/language/)

    const badInterval = defaultSettings()
    badInterval.defaultIntervalDays = 15 as AppSettings['defaultIntervalDays']
    expect(() => writeSettings(tempFile(), badInterval)).toThrow(/interval/)
  })

  test('accepts a prompt count of 1000 and rejects 1001', () => {
    const accepted = defaultSettings()
    accepted.defaultPromptCount = 1000
    const file = tempFile()
    writeSettings(file, accepted)
    expect(readSettings(file).defaultPromptCount).toBe(1000)

    const rejected = defaultSettings()
    rejected.defaultPromptCount = 1001
    expect(() => writeSettings(tempFile(), rejected)).toThrow('The maximum prompt count is 1000.')
    const planted = tempFile()
    writeFileSync(
      planted,
      JSON.stringify({ ...defaultSettings(), schemaVersion: 1, defaultPromptCount: 1001 })
    )
    expect(() => readSettings(planted)).toThrow('The maximum prompt count is 1000.')
  })

  test('refuses secret-shaped values and leaves an existing file unchanged', () => {
    const file = tempFile()
    writeSettings(file, defaultSettings())
    const before = readFileSync(file, 'utf8')
    const secret = `sk-ant-api03-${'a'.repeat(24)}`
    const poisoned = defaultSettings()
    poisoned.userName = secret
    expect(() => writeSettings(file, poisoned)).toThrow(/secrets/)
    expect(readFileSync(file, 'utf8')).toBe(before)
    try {
      writeSettings(file, poisoned)
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError)
      expect(error instanceof Error ? error.message : '').not.toContain(secret)
    }

    const planted = tempFile()
    writeFileSync(planted, JSON.stringify({ schemaVersion: 1, location: secret }))
    expect(() => readSettings(planted)).toThrow(/secrets/)
    try {
      readSettings(planted)
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain(secret)
    }
  })

  test('stores the app schedule with SCH-1 defaults and keeps it across a settings write', () => {
    const file = tempFile()
    expect(readAppSchedule(file)).toEqual(defaultAppSchedule())
    expect(() => statSync(file)).toThrow()
    expect(defaultAppSchedule()).toEqual({
      startAtLogin: true,
      catchUpAfterSleep: true,
      checkWhenClosed: false,
      dailyCheckTime: '08:00'
    })

    writeAppSchedule(file, {
      startAtLogin: false,
      catchUpAfterSleep: false,
      checkWhenClosed: true,
      dailyCheckTime: '23:05'
    })
    const settings = defaultSettings()
    settings.userName = 'Ada'
    writeSettings(file, settings)
    expect(readSettings(file).userName).toBe('Ada')
    expect(readAppSchedule(file).checkWhenClosed).toBe(true)
    expect(readAppSchedule(file).dailyCheckTime).toBe('23:05')

    writeAppSchedule(file, { ...defaultAppSchedule(), dailyCheckTime: '07:30' })
    expect(readSettings(file).userName).toBe('Ada')
    expect(readAppSchedule(file).dailyCheckTime).toBe('07:30')
  })

  test('saves each of the three rotation modes (FR-11.2) and refuses an unknown one', () => {
    const file = tempFile()
    writeSettings(file, defaultSettings())
    expect(readSettings(file).serpapiRotation).toBe('in_order')
    for (const mode of ['spread_evenly', 'project_keys', 'in_order'] as const) {
      writeSettings(file, { ...defaultSettings(), serpapiRotation: mode })
      expect(readSettings(file).serpapiRotation).toBe(mode)
    }

    const projectKeys = tempFile()
    writeFileSync(
      projectKeys,
      JSON.stringify({ schemaVersion: 1, serpapiRotation: 'project_keys' })
    )
    expect(readSettings(projectKeys).serpapiRotation).toBe('project_keys')

    const garbage = tempFile()
    writeFileSync(garbage, JSON.stringify({ schemaVersion: 1, serpapiRotation: 'round_robin' }))
    expect(() => readSettings(garbage)).toThrow('Invalid serpapi rotation')
  })

  test('keeps the sidebar collapse choice and reads an older file as auto', () => {
    const file = tempFile()
    writeSettings(file, defaultSettings())
    expect(readSettings(file).sidebar).toBe('auto')
    for (const mode of ['collapsed', 'expanded', 'auto'] as const) {
      writeSettings(file, { ...defaultSettings(), sidebar: mode })
      expect(readSettings(file).sidebar).toBe(mode)
    }
    const older = { ...defaultSettings() }
    delete older.sidebar
    writeSettings(file, older)
    expect(readSettings(file).sidebar).toBe('auto')

    const garbage = tempFile()
    writeFileSync(garbage, JSON.stringify({ schemaVersion: 1, sidebar: 'hidden' }))
    expect(() => readSettings(garbage)).toThrow('Invalid sidebar mode')
  })

  test('keeps the theme choice and reads an older file as the sepia default', () => {
    const file = tempFile()
    writeSettings(file, defaultSettings())
    expect(readSettings(file).theme).toBe('sepia')
    for (const theme of ['light', 'dark', 'system', 'sepia'] as const) {
      writeSettings(file, { ...defaultSettings(), theme })
      expect(readSettings(file).theme).toBe(theme)
    }
    const older = { ...defaultSettings() }
    delete older.theme
    writeSettings(file, older)
    expect(readSettings(file).theme).toBe('sepia')

    const garbage = tempFile()
    writeFileSync(garbage, JSON.stringify({ schemaVersion: 1, theme: 'auto' }))
    expect(() => readSettings(garbage)).toThrow('Invalid theme')
  })

  test('keeps the celebration and sound switches and reads an older file as on', () => {
    const file = tempFile()
    writeSettings(file, defaultSettings())
    expect(readSettings(file)).toMatchObject({ celebrate: true, celebrateSound: true })
    writeSettings(file, { ...defaultSettings(), celebrate: false, celebrateSound: false })
    expect(readSettings(file)).toMatchObject({ celebrate: false, celebrateSound: false })
    writeSettings(file, { ...defaultSettings(), celebrateSound: false })
    expect(readSettings(file)).toMatchObject({ celebrate: true, celebrateSound: false })
    const older = { ...defaultSettings() }
    delete older.celebrate
    delete older.celebrateSound
    writeSettings(file, older)
    expect(readSettings(file)).toMatchObject({ celebrate: true, celebrateSound: true })

    const garbage = tempFile()
    writeFileSync(garbage, JSON.stringify({ schemaVersion: 1, celebrateSound: 'loud' }))
    expect(() => readSettings(garbage)).toThrow()
  })

  test('fills schedule defaults on a version 1 file and rejects a bad clock', () => {
    const legacy = tempFile()
    writeFileSync(legacy, JSON.stringify({ schemaVersion: 1, userName: 'Ada' }))
    expect(readAppSchedule(legacy)).toEqual(defaultAppSchedule())
    expect(readSettings(legacy).userName).toBe('Ada')

    const file = tempFile()
    writeAppSchedule(file, defaultAppSchedule())
    const before = readFileSync(file, 'utf8')
    expect(() =>
      writeAppSchedule(file, { ...defaultAppSchedule(), dailyCheckTime: '8:00' })
    ).toThrow(/daily check time/)
    expect(() =>
      writeAppSchedule(file, { ...defaultAppSchedule(), dailyCheckTime: '24:00' })
    ).toThrow(/daily check time/)
    expect(readFileSync(file, 'utf8')).toBe(before)

    const newer = tempFile()
    writeFileSync(newer, '{"schemaVersion":3,"dailyCheckTime":"09:00"}')
    expect(() => writeAppSchedule(newer, defaultAppSchedule())).toThrow(/newer/)
    expect(readFileSync(newer, 'utf8')).toContain('"schemaVersion":3')
  })
})

describe('atomic write', () => {
  test('keeps the original file when the rename fails', () => {
    const file = tempFile()
    writeFileSync(file, 'original')
    const removed: string[] = []
    const io: AtomicFileIo = {
      write: (target, contents) => writeFileSync(target, contents),
      rename: () => {
        throw new Error('disk full')
      },
      unlink: (target) => {
        removed.push(target)
        rmSync(target, { force: true })
      }
    }
    expect(() => atomicWriteFile(file, 'replacement', io)).toThrow(/disk full/)
    expect(readFileSync(file, 'utf8')).toBe('original')
    expect(removed.some((target) => target.includes('.tmp'))).toBe(true)
  })
})

function tempFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-settings-'))
  directories.push(directory)
  return join(directory, 'settings.json')
}
