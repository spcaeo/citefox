import type { AppSchedule, AppSettings, ThemePreference } from '@shared/domain'
import type {
  ExportSettingsResult,
  SettingsImportPreview,
  SettingsTransferField,
  SettingsTransferFieldResult,
  TransferPickResult
} from '@shared/ipc'
import { IpcRequestError, parseSettingsPatch } from '../ipc-request'
import { containsSecret } from '../logging/redact'
import type { AppStorage } from '../storage/app-storage'
import { getEmailMode, setEmailMode } from '../storage/email-mode'
import { readSetupRunnerSettings, writeSetupRunnerSettings } from '../storage/setup-runner-settings'
import { openText, saveText, TokenStore } from './dialogs'

/**
 * App settings as one `.citefox-settings.json` file: defaults, Claude choices,
 * the schedule, appearance and how email is sent. API keys, tokens, Slack
 * webhooks and SMTP passwords are keychain items and are never read here, so
 * they cannot reach the file. The Claude program's path is this Mac's and stays.
 */

export const SETTINGS_FILE_FORMAT = 'citefox-settings'
export const SETTINGS_FILE_VERSION = 1
export const SETTINGS_KEYCHAIN_NOTE =
  "API keys stay in this Mac's keychain and are not included. Add them again on the new Mac."

type SettingKey = Exclude<keyof AppSettings, 'claudeBinaryPath' | 'codexBinaryPath'>
type ScheduleKey = keyof AppSchedule
type FieldValue = string | number | boolean | null

const SETTING_LABELS: Readonly<Record<SettingKey, string>> = {
  userName: 'Your name',
  defaultCountry: 'Default country',
  defaultLanguage: 'Default language',
  defaultLocation: 'Default location',
  defaultDevice: 'Default device',
  defaultIntervalDays: 'Re-check every (days)',
  defaultSamples: 'Samples per question',
  defaultPromptCount: 'Questions per page',
  claudeConcurrency: 'Claude runs at once',
  claudeModel: 'Claude model',
  claudeProvider: 'AI connection',
  codexModel: 'Codex model',
  codexQuickModel: 'Codex quick model',
  jinaMode: 'Page reader',
  serpapiRotation: 'SerpApi key order',
  sidebar: 'Sidebar',
  theme: 'Theme',
  celebrate: 'Celebrate citations',
  celebrateSound: 'Play a sound'
}

const SCHEDULE_LABELS: Readonly<Record<ScheduleKey, string>> = {
  startAtLogin: 'Start at login',
  catchUpAfterSleep: 'Catch up after sleep',
  checkWhenClosed: 'Check when CiteFox is closed',
  dailyCheckTime: 'Daily check time'
}

const OTHER_LABELS = {
  emailMode: 'How email is sent',
  setupPagesPerHour: 'Pages set up per hour'
} as const

type OtherKey = keyof typeof OTHER_LABELS

const LABELS: Readonly<Record<string, string>> = {
  ...SETTING_LABELS,
  ...SCHEDULE_LABELS,
  ...OTHER_LABELS
}

export interface SettingsFile {
  format: typeof SETTINGS_FILE_FORMAT
  formatVersion: typeof SETTINGS_FILE_VERSION
  appVersion: string
  exportedAt: string
  note: string
  values: Record<string, FieldValue>
}

export interface SettingsTransferDeps {
  storage: AppStorage
  now: () => Date
  appVersion: () => string
  /** The app schedule, read and changed the way Settings › Schedule does (the OS job follows). */
  getSchedule: () => AppSchedule
  updateSchedule: (patch: Partial<AppSchedule>) => AppSchedule
  onThemeChanged?: (theme: ThemePreference) => void
}

function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_LABELS, key)
}

function isScheduleKey(key: string): key is ScheduleKey {
  return Object.prototype.hasOwnProperty.call(SCHEDULE_LABELS, key)
}

function isOtherKey(key: string): key is OtherKey {
  return Object.prototype.hasOwnProperty.call(OTHER_LABELS, key)
}

/** Every value the file carries, read now. */
export function currentValues(deps: SettingsTransferDeps): Record<string, FieldValue> {
  const settings = deps.storage.readSettings()
  const values: Record<string, FieldValue> = {}
  for (const key of Object.keys(SETTING_LABELS) as SettingKey[]) values[key] = settings[key] ?? null
  const schedule = deps.getSchedule()
  for (const key of Object.keys(SCHEDULE_LABELS) as ScheduleKey[]) values[key] = schedule[key]
  values.emailMode = getEmailMode(deps.storage.db)
  values.setupPagesPerHour = readSetupRunnerSettings(deps.storage.db).pagesPerHour
  return values
}

export function buildSettingsFile(deps: SettingsTransferDeps): SettingsFile {
  return {
    format: SETTINGS_FILE_FORMAT,
    formatVersion: SETTINGS_FILE_VERSION,
    appVersion: deps.appVersion(),
    exportedAt: deps.now().toISOString(),
    note: SETTINGS_KEYCHAIN_NOTE,
    values: currentValues(deps)
  }
}

export class SettingsFileError extends Error {}

/** Reads and checks a settings file. Throws {@link SettingsFileError} with a plain reason. */
export function parseSettingsFile(text: string): SettingsFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new SettingsFileError('This file is not valid JSON.')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SettingsFileError('This file is not a CiteFox settings file.')
  }
  const record = raw as Record<string, unknown>
  if (record.format !== SETTINGS_FILE_FORMAT) {
    throw new SettingsFileError('This file is not a CiteFox settings file.')
  }
  if (record.formatVersion !== SETTINGS_FILE_VERSION) {
    throw new SettingsFileError('This settings file was made by another version of CiteFox.')
  }
  if (containsSecret(text)) {
    throw new SettingsFileError(
      'This file holds what looks like a key or a password. CiteFox does not import those.'
    )
  }
  const values = record.values
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    throw new SettingsFileError('The file has no settings.')
  }
  const out: Record<string, FieldValue> = {}
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (!(key in LABELS))
      throw new SettingsFileError(
        `The file has a setting CiteFox does not know (${key.slice(0, 40)}).`
      )
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new SettingsFileError(`The value of “${LABELS[key] ?? key}” is not valid.`)
    }
    out[key] = value as FieldValue
  }
  return {
    format: SETTINGS_FILE_FORMAT,
    formatVersion: SETTINGS_FILE_VERSION,
    appVersion: typeof record.appVersion === 'string' ? record.appVersion.slice(0, 40) : '',
    exportedAt: typeof record.exportedAt === 'string' ? record.exportedAt.slice(0, 40) : '',
    note: SETTINGS_KEYCHAIN_NOTE,
    values: out
  }
}

function display(value: FieldValue | undefined): string {
  if (value === null || value === undefined) return 'Not set'
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  return String(value)
}

interface PickedSettings {
  filename: string
  file: SettingsFile
  result: SettingsTransferFieldResult[] | null
}

export interface SettingsTransferService {
  exportSettings: () => Promise<ExportSettingsResult>
  pick: () => Promise<TransferPickResult>
  preview: (token: string) => SettingsImportPreview
  apply: (token: string) => SettingsTransferFieldResult[]
}

export function createSettingsTransferService(deps: SettingsTransferDeps): SettingsTransferService {
  const picked = new TokenStore<PickedSettings>()

  async function exportSettings(): Promise<ExportSettingsResult> {
    const file = buildSettingsFile(deps)
    const day = file.exportedAt.slice(0, 10)
    const saved = await saveText(
      {
        title: 'Export app settings',
        defaultName: `citefox-settings-${day}.citefox-settings.json`,
        filter: { name: 'CiteFox settings', extensions: ['json'] }
      },
      `${JSON.stringify(file, null, 2)}\n`
    )
    if (!saved.ok) return saved
    return { ...saved, fieldCount: Object.keys(file.values).length }
  }

  async function pick(): Promise<TransferPickResult> {
    const read = await openText({
      title: 'Import app settings',
      filter: { name: 'CiteFox settings', extensions: ['json'] }
    })
    if (!read.ok) return read
    try {
      const file = parseSettingsFile(read.text)
      return {
        ok: true,
        token: picked.add({ filename: read.filename, file, result: null }),
        filename: read.filename
      }
    } catch (error) {
      if (error instanceof SettingsFileError) {
        return {
          ok: false,
          cancelled: false,
          reason: `${read.filename}: ${error.message}`,
          nextStep: 'Choose a .citefox-settings.json file exported from CiteFox.'
        }
      }
      throw error
    }
  }

  function entry(token: string, channel: string): PickedSettings {
    const found = picked.get(token)
    if (found === undefined)
      throw new IpcRequestError(channel, 'That file is no longer open', 'Choose the file again.')
    return found
  }

  function fields(file: SettingsFile): SettingsTransferField[] {
    const now = currentValues(deps)
    return Object.keys(LABELS)
      .filter((key) => key in file.values)
      .map((key) => ({
        key,
        label: LABELS[key] ?? key,
        current: display(now[key]),
        incoming: display(file.values[key]),
        changed: now[key] !== file.values[key]
      }))
  }

  function preview(token: string): SettingsImportPreview {
    const found = entry(token, 'transfer:settingsPreview')
    return {
      token,
      filename: found.filename,
      formatVersion: found.file.formatVersion,
      appVersion: found.file.appVersion,
      exportedAt: found.file.exportedAt,
      fields: fields(found.file),
      result: found.result
    }
  }

  function applyOne(key: string, value: FieldValue): void {
    if (isSettingKey(key)) {
      const patch = parseSettingsPatch({ [key]: value })
      deps.storage.writeSettings({ ...deps.storage.readSettings(), ...patch })
      if (patch.theme !== undefined) deps.onThemeChanged?.(patch.theme)
    } else if (isScheduleKey(key)) {
      deps.updateSchedule({ [key]: value } as Partial<AppSchedule>)
    } else if (key === 'emailMode') {
      setEmailMode(deps.storage.db, value as 'smtp' | 'mail_app')
    } else if (isOtherKey(key)) {
      const current = readSetupRunnerSettings(deps.storage.db)
      writeSetupRunnerSettings(deps.storage.db, { ...current, pagesPerHour: value as number })
    }
  }

  function apply(token: string): SettingsTransferFieldResult[] {
    const found = entry(token, 'transfer:applySettings')
    const now = currentValues(deps)
    const result = Object.keys(LABELS)
      .filter((key) => key in found.file.values)
      .map((key): SettingsTransferFieldResult => {
        const label = LABELS[key] ?? key
        const value = found.file.values[key] ?? null
        if (now[key] === value) return { key, label, outcome: 'unchanged', reason: null }
        try {
          applyOne(key, value)
          return { key, label, outcome: 'applied', reason: null }
        } catch (error) {
          return { key, label, outcome: 'failed', reason: plainReason(error) }
        }
      })
    found.result = result
    return result
  }

  return { exportSettings, pick, preview, apply }
}

function plainReason(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const text = message.replace(/^[a-zA-Z]+:[a-zA-Z]+:\s*/, '').trim()
  return text.length > 0 && text.length < 160 ? text : 'This value is not allowed on this Mac.'
}
