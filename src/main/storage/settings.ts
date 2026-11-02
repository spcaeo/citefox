import {
  DEFAULT_CLAUDE_CONCURRENCY,
  DEFAULT_CLAUDE_PROVIDER,
  DEFAULT_INTERVAL_DAYS,
  DEFAULT_JINA_MODE,
  DEFAULT_MARKET_DEVICE,
  DEFAULT_PROMPT_COUNT,
  DEFAULT_SAMPLE_COUNT,
  DEFAULT_SERPAPI_ROTATION,
  DEFAULT_SIDEBAR_MODE,
  DEFAULT_THEME,
  isClaudeProvider,
  isCountryCode,
  isIntervalDays,
  isJinaMode,
  isLanguageTag,
  isMarketDevice,
  isSampleCount,
  isSerpApiRotationMode,
  isSidebarMode,
  isThemePreference
} from '@shared/domain'
import type {
  AppSchedule,
  AppSettings,
  SerpApiRotationMode,
  SidebarMode,
  ThemePreference
} from '@shared/domain'

export type { AppSettings }
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { createLogger } from '../logging/logger'
import { containsSecret } from '../logging/redact'
import { atomicWriteFile } from './atomic-file'
import { StorageError } from './errors'
import { MAX_PROMPT_COUNT } from './pages'
import { DEFAULT_DAILY_CHECK_TIME, requireClockTime } from './values'

/**
 * File envelope for `settings.json`. The stored object is {@link AppSettings}
 * from the IPC contract, the app-wide {@link AppSchedule} fields (SCH-1), and
 * this version. Notifications stay out of the file.
 *
 * Version 2 adds the schedule fields. A version 1 file still opens: the
 * schedule reads as {@link defaultAppSchedule} until a schedule write.
 */
export const SETTINGS_SCHEMA_VERSION = 2

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/
const MAX_CLAUDE_CONCURRENCY = 32

type ParseMode = 'strict' | 'defaults'

/**
 * Fresh install. Country and language stay null until the profile step or
 * Settings sets them (section 15). The re-check interval default is 7 days.
 */
export function defaultSettings(): AppSettings {
  return {
    userName: null,
    defaultCountry: null,
    defaultLanguage: null,
    defaultLocation: null,
    defaultDevice: DEFAULT_MARKET_DEVICE,
    defaultIntervalDays: DEFAULT_INTERVAL_DAYS,
    defaultSamples: DEFAULT_SAMPLE_COUNT,
    defaultPromptCount: DEFAULT_PROMPT_COUNT,
    claudeBinaryPath: null,
    claudeConcurrency: DEFAULT_CLAUDE_CONCURRENCY,
    claudeModel: null,
    claudeProvider: DEFAULT_CLAUDE_PROVIDER,
    codexBinaryPath: null,
    codexModel: null,
    codexQuickModel: null,
    jinaMode: DEFAULT_JINA_MODE,
    serpapiRotation: DEFAULT_SERPAPI_ROTATION,
    sidebar: DEFAULT_SIDEBAR_MODE,
    theme: defaultTheme(),
    celebrate: true,
    celebrateSound: true
  }
}

/**
 * The theme a fresh install starts on: Sepia, unless CITEFOX_DEFAULT_THEME names
 * another (the e2e launcher sets `system`, so its light/dark media emulation works).
 */
function defaultTheme(): ThemePreference {
  const fromEnv = process.env.CITEFOX_DEFAULT_THEME
  return fromEnv !== undefined && isThemePreference(fromEnv) ? fromEnv : DEFAULT_THEME
}

/**
 * SCH-1 defaults.
 * Catch-up is on (SCH-3). The headless job stays off until the user opts in.
 * Section 8 runs CiteFox in the tray from login, so start-at-login begins on.
 * The daily check is 08:00 in the computer's local timezone. Quiet hours are
 * per project (SCH-9), not an app setting.
 */
export function defaultAppSchedule(): AppSchedule {
  return {
    startAtLogin: true,
    catchUpAfterSleep: true,
    checkWhenClosed: false,
    dailyCheckTime: DEFAULT_DAILY_CHECK_TIME
  }
}

type SettingsWarningSink = (message: string, extra?: unknown) => void

const defaultWarningSink: SettingsWarningSink = (message, extra) => {
  createLogger().warn(message, extra)
}
let warnSink: SettingsWarningSink = defaultWarningSink

/** Where a kept-aside or defaulted settings file is reported. Null restores the console logger. */
export function setSettingsWarningSink(sink: SettingsWarningSink | null): void {
  warnSink = sink ?? defaultWarningSink
}

/**
 * Missing file returns defaults and does not create the file.
 * A file that cannot be read or is not JSON is moved to
 * `settings.json.corrupt-<time>`, logged, and read as defaults.
 */
export function readSettings(filePath: string): AppSettings {
  const raw = readRawOrQuarantine(filePath)
  if (raw === null) return defaultSettings()
  return parseSettings(migrateSettings(raw), 'defaults')
}

/**
 * App-wide schedule (SCH-1). A missing file returns defaults and does not create it.
 * A corrupt file is kept aside as in {@link readSettings}. A schedule value that
 * does not parse reads as the default schedule, logged, so the tray and the
 * headless job keep running; the next write keeps a copy of the file first.
 */
export function readAppSchedule(filePath: string): AppSchedule {
  const raw = readRawOrQuarantine(filePath)
  if (raw === null) return defaultAppSchedule()
  const migrated = migrateSettings(raw)
  try {
    return parseAppSchedule(migrated, 'defaults')
  } catch (error) {
    if (!(error instanceof StorageError)) throw error
    warnSink('CiteFox is using the default schedule: settings.json has an invalid value', {
      reason: error.message
    })
    return defaultAppSchedule()
  }
}

/** Replace `settings.json` atomically. Refuses any secret-shaped value. Keeps the schedule. */
export function writeSettings(filePath: string, settings: AppSettings): void {
  assertNoSecrets(JSON.stringify(settings))
  writeEnvelope(filePath, settings, preservedSchedule(filePath))
}

/** Replace the schedule fields and keep the rest of `settings.json`. */
export function writeAppSchedule(filePath: string, schedule: AppSchedule): void {
  assertNoSecrets(JSON.stringify(schedule))
  writeEnvelope(filePath, preservedSettings(filePath), schedule)
}

function writeEnvelope(filePath: string, settings: AppSettings, schedule: AppSchedule): void {
  const parsedSettings = parseSettings(settings, 'strict')
  const parsedSchedule = parseAppSchedule(schedule, 'strict')
  const json = `${JSON.stringify(
    { schemaVersion: SETTINGS_SCHEMA_VERSION, ...parsedSettings, ...parsedSchedule },
    null,
    2
  )}\n`
  assertNoSecrets(json)
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  atomicWriteFile(filePath, json)
  if (process.platform !== 'win32') chmodSync(filePath, 0o600)
}

function preservedSchedule(filePath: string): AppSchedule {
  const raw = readRawOrQuarantine(filePath)
  if (raw === null) return defaultAppSchedule()
  try {
    return parseAppSchedule(migrateSettings(raw), 'defaults')
  } catch (error) {
    if (error instanceof StorageError && error.message.includes('newer than this app')) throw error
    if (error instanceof StorageError) {
      keepCopy(filePath, error)
      return defaultAppSchedule()
    }
    throw error
  }
}

function preservedSettings(filePath: string): AppSettings {
  const raw = readRawOrQuarantine(filePath)
  if (raw === null) return defaultSettings()
  try {
    return parseSettings(migrateSettings(raw), 'defaults')
  } catch (error) {
    if (error instanceof StorageError && error.message.includes('newer than this app')) throw error
    if (error instanceof StorageError) {
      keepCopy(filePath, error)
      return defaultSettings()
    }
    throw error
  }
}

/**
 * The parsed file, or null when it is missing or was corrupt (then it has been
 * moved aside). A file holding a secret still throws and is not copied.
 */
function readRawOrQuarantine(filePath: string): unknown {
  if (!existsSync(filePath)) return null
  try {
    const raw = readRawSettings(filePath)
    if (!isRecord(raw)) throw new StorageError('Invalid settings.json')
    return raw
  } catch (error) {
    if (!(error instanceof StorageError) || error.message.includes('secrets')) throw error
    const target = corruptName(filePath)
    try {
      renameSync(filePath, target)
    } catch {
      throw error
    }
    warnSink('CiteFox moved a corrupt settings.json aside and is using defaults', {
      reason: error.message,
      keptAs: target
    })
    return null
  }
}

/** Before a write replaces a file with a value that did not parse, keep a copy of it. */
function keepCopy(filePath: string, error: StorageError): void {
  const target = corruptName(filePath)
  try {
    copyFileSync(filePath, target)
    if (process.platform !== 'win32') chmodSync(target, 0o600)
  } catch {
    // The write still goes ahead. The value that did not parse was already unusable.
  }
  warnSink('CiteFox kept a copy of settings.json before replacing an invalid value', {
    reason: error.message,
    keptAs: target
  })
}

function corruptName(filePath: string): string {
  return `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
}

function readRawSettings(filePath: string): unknown {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    throw new StorageError('Could not read settings.json')
  }
  assertNoSecrets(text)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new StorageError('settings.json is not valid JSON')
  }
}

function migrateSettings(raw: unknown): unknown {
  let version = schemaVersionOf(raw)
  if (version > SETTINGS_SCHEMA_VERSION) {
    throw new StorageError('settings.json is newer than this app and cannot be opened')
  }
  let current = raw
  if (version === 0) {
    current = { ...(isRecord(current) ? current : {}), schemaVersion: 1 }
    version = 1
  }
  if (version === 1) {
    current = { ...(isRecord(current) ? current : {}), schemaVersion: SETTINGS_SCHEMA_VERSION }
    version = SETTINGS_SCHEMA_VERSION
  }
  if (version !== SETTINGS_SCHEMA_VERSION) {
    throw new StorageError('Unsupported settings schema version')
  }
  return current
}

function schemaVersionOf(raw: unknown): number {
  if (!isRecord(raw) || !Object.prototype.hasOwnProperty.call(raw, 'schemaVersion')) return 0
  const version = raw.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new StorageError('Invalid settings schema version')
  }
  return version
}

function parseSettings(input: unknown, mode: ParseMode): AppSettings {
  const record = readObject(input, 'settings.json')
  const defaults = defaultSettings()
  return {
    userName: readUserName(field(record, 'userName', defaults, mode, 'userName')),
    defaultCountry: readCountry(field(record, 'defaultCountry', defaults, mode, 'defaultCountry')),
    defaultLanguage: readLanguage(
      field(record, 'defaultLanguage', defaults, mode, 'defaultLanguage')
    ),
    defaultLocation: readLocation(
      field(record, 'defaultLocation', defaults, mode, 'defaultLocation')
    ),
    defaultDevice: readDevice(field(record, 'defaultDevice', defaults, mode, 'defaultDevice')),
    defaultIntervalDays: readInterval(
      field(record, 'defaultIntervalDays', defaults, mode, 'defaultIntervalDays')
    ),
    defaultSamples: readSamples(field(record, 'defaultSamples', defaults, mode, 'defaultSamples')),
    defaultPromptCount: readPromptCount(
      field(record, 'defaultPromptCount', defaults, mode, 'defaultPromptCount')
    ),
    claudeBinaryPath: readBinaryPath(
      field(record, 'claudeBinaryPath', defaults, mode, 'claudeBinaryPath')
    ),
    claudeConcurrency: readInteger(
      field(record, 'claudeConcurrency', defaults, mode, 'claudeConcurrency'),
      'claudeConcurrency',
      1,
      MAX_CLAUDE_CONCURRENCY
    ),
    claudeModel: readModel(field(record, 'claudeModel', defaults, mode, 'claudeModel')),
    claudeProvider: readClaudeProvider(
      field(record, 'claudeProvider', defaults, mode, 'claudeProvider')
    ),
    // Added with Codex: optional, so files written before it still parse strictly.
    codexBinaryPath: readBinaryPath(
      field(record, 'codexBinaryPath', defaults, 'defaults', 'codexBinaryPath')
    ),
    codexModel: readModel(field(record, 'codexModel', defaults, 'defaults', 'codexModel')),
    codexQuickModel: readModel(
      field(record, 'codexQuickModel', defaults, 'defaults', 'codexQuickModel')
    ),
    jinaMode: readJinaMode(field(record, 'jinaMode', defaults, mode, 'jinaMode')),
    serpapiRotation: readSerpApiRotation(
      field(record, 'serpapiRotation', defaults, mode, 'serpapiRotation')
    ),
    // A display preference: always optional, so files written before it still parse strictly.
    sidebar: readSidebarMode(field(record, 'sidebar', defaults, 'defaults', 'sidebar')),
    // Also a display preference: files written before it still parse strictly.
    theme: readTheme(field(record, 'theme', defaults, 'defaults', 'theme')),
    celebrate: readBoolean(
      field(record, 'celebrate', defaults, 'defaults', 'celebrate'),
      'celebrate'
    ),
    celebrateSound: readBoolean(
      field(record, 'celebrateSound', defaults, 'defaults', 'celebrateSound'),
      'celebrateSound'
    )
  }
}

function parseAppSchedule(input: unknown, mode: ParseMode): AppSchedule {
  const record = readObject(input, 'settings.json')
  const defaults = defaultAppSchedule()
  return {
    startAtLogin: readBoolean(
      field(record, 'startAtLogin', defaults, mode, 'startAtLogin'),
      'startAtLogin'
    ),
    catchUpAfterSleep: readBoolean(
      field(record, 'catchUpAfterSleep', defaults, mode, 'catchUpAfterSleep'),
      'catchUpAfterSleep'
    ),
    checkWhenClosed: readBoolean(
      field(record, 'checkWhenClosed', defaults, mode, 'checkWhenClosed'),
      'checkWhenClosed'
    ),
    dailyCheckTime: readClockTime(
      field(record, 'dailyCheckTime', defaults, mode, 'dailyCheckTime'),
      'daily check time'
    )
  }
}

function field<T extends object>(
  source: Record<string, unknown>,
  key: string,
  defaults: T,
  mode: ParseMode,
  label: string
): unknown {
  if (!Object.prototype.hasOwnProperty.call(source, key) || source[key] === undefined) {
    if (mode === 'defaults' && Object.prototype.hasOwnProperty.call(defaults, key)) {
      return defaults[key as keyof T]
    }
    throw new StorageError(`settings.json is missing ${label}`)
  }
  return source[key]
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new StorageError(`Invalid ${label}`)
  return value
}

function readUserName(value: unknown): string | null {
  if (value === null) return null
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 200 ||
    value.trim() !== value
  ) {
    throw new StorageError('Invalid userName')
  }
  if (hasControlCharacter(value)) throw new StorageError('Invalid userName')
  return value
}

function readCountry(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !isCountryCode(value)) throw new StorageError('Invalid country')
  return value
}

function readLanguage(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !isLanguageTag(value)) throw new StorageError('Invalid language')
  return value
}

function readLocation(value: unknown): string | null {
  if (value === null) return null
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 120 ||
    value.trim() !== value
  ) {
    throw new StorageError('Invalid location')
  }
  if (hasControlCharacter(value)) throw new StorageError('Invalid location')
  return value
}

function readDevice(value: unknown): AppSettings['defaultDevice'] {
  if (typeof value !== 'string' || !isMarketDevice(value)) throw new StorageError('Invalid device')
  return value
}

function readInterval(value: unknown): AppSettings['defaultIntervalDays'] {
  if (typeof value !== 'number' || !isIntervalDays(value))
    throw new StorageError('Invalid interval')
  return value
}

function readSamples(value: unknown): AppSettings['defaultSamples'] {
  if (typeof value !== 'number' || !isSampleCount(value)) throw new StorageError('Invalid samples')
  return value
}

function readBinaryPath(value: unknown): string | null {
  if (value === null) return null
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1024 ||
    value.trim() !== value
  ) {
    throw new StorageError('Invalid claude binary path')
  }
  if (hasControlCharacter(value)) throw new StorageError('Invalid claude binary path')
  return value
}

function readModel(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !MODEL.test(value))
    throw new StorageError('Invalid claude model')
  return value
}

function readClaudeProvider(value: unknown): AppSettings['claudeProvider'] {
  if (typeof value !== 'string' || !isClaudeProvider(value))
    throw new StorageError('Invalid claude provider')
  return value
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new StorageError(`Invalid ${label}`)
  return value
}

function readClockTime(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new StorageError(`Invalid ${label}`)
  return requireClockTime(value, label)
}

function readJinaMode(value: unknown): AppSettings['jinaMode'] {
  if (typeof value !== 'string' || !isJinaMode(value)) throw new StorageError('Invalid jina mode')
  return value
}

/** FR-11.2. `in_order`, `spread_evenly`, or `project_keys`. */
function readSerpApiRotation(value: unknown): SerpApiRotationMode {
  if (typeof value !== 'string' || !isSerpApiRotationMode(value)) {
    throw new StorageError('Invalid serpapi rotation')
  }
  return value
}

function readSidebarMode(value: unknown): SidebarMode {
  if (typeof value !== 'string' || !isSidebarMode(value)) {
    throw new StorageError('Invalid sidebar mode')
  }
  return value
}

function readTheme(value: unknown): ThemePreference {
  if (typeof value !== 'string' || !isThemePreference(value)) {
    throw new StorageError('Invalid theme')
  }
  return value
}

function readPromptCount(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > MAX_PROMPT_COUNT) {
    throw new StorageError(`The maximum prompt count is ${MAX_PROMPT_COUNT}.`)
  }
  return readInteger(value, 'defaultPromptCount', 1, MAX_PROMPT_COUNT)
}

function readInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new StorageError(`Invalid ${label}`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertNoSecrets(json: string): void {
  if (containsSecret(json)) throw new StorageError('settings.json cannot contain secrets')
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}
