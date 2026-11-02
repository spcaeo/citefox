import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  defaultAppSchedule,
  defaultSettings,
  readAppSchedule,
  readSettings,
  setSettingsWarningSink,
  writeAppSchedule,
  writeSettings
} from './settings'

const directories: string[] = []
const warnings: string[] = []

afterEach(() => {
  setSettingsWarningSink(null)
  warnings.splice(0)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('a corrupt settings.json', () => {
  test('is kept aside, logged, and read as explicit defaults instead of throwing', () => {
    const file = tempFile()
    setSettingsWarningSink((message) => {
      warnings.push(message)
    })
    writeFileSync(file, '{"schemaVersion":2,"dailyCheckTime":"09:30",')
    expect(readAppSchedule(file)).toEqual(defaultAppSchedule())
    expect(readSettings(file)).toEqual(defaultSettings())
    const backups = siblings(file).filter((name) => name.startsWith('settings.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(file, '..', backups[0] ?? ''), 'utf8')).toContain('09:30')
    expect(siblings(file)).not.toContain('settings.json')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('settings.json')

    writeAppSchedule(file, { ...defaultAppSchedule(), dailyCheckTime: '07:15' })
    expect(readAppSchedule(file).dailyCheckTime).toBe('07:15')
  })

  test('a bad schedule value reads as the default schedule and is kept aside before a write', () => {
    const file = tempFile()
    setSettingsWarningSink((message) => {
      warnings.push(message)
    })
    writeFileSync(
      file,
      JSON.stringify({ schemaVersion: 2, userName: 'Ada', dailyCheckTime: 'soon' })
    )
    expect(readAppSchedule(file)).toEqual(defaultAppSchedule())
    expect(readSettings(file).userName).toBe('Ada')
    writeSettings(file, { ...defaultSettings(), userName: 'Grace' })
    const backups = siblings(file).filter((name) => name.startsWith('settings.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(file, '..', backups[0] ?? ''), 'utf8')).toContain('soon')
    expect(readSettings(file).userName).toBe('Grace')
    expect(warnings.length).toBeGreaterThan(0)
  })
})

function siblings(file: string): string[] {
  return readdirSync(join(file, '..'))
}

function tempFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-settings-corrupt-'))
  directories.push(directory)
  return join(directory, 'settings.json')
}
