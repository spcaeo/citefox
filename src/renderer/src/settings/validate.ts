import {
  isCountryCode,
  isIntervalDays,
  isLanguageTag,
  isSampleCount,
  type AppSettings,
  type ClaudeProvider,
  type IntervalDays,
  type JinaMode,
  type MarketDevice,
  type SampleCount
} from '@shared/domain'
import type { AppSettingsPatch } from '@shared/ipc'
import { parseSearchBudget, PROFILE_COPY } from '../onboarding/validate'
import { errorText } from '../components/errorText'

/**
 * Settings validation (section 9.2, FR-2.5, FR-9.3, LLM-1, LLM-5, LLM-7).
 * Empty model is the CLI default. Empty budget is no cap. Re-check defaults to 14.
 */

export interface SettingsDraft {
  userName: string
  defaultCountry: string
  defaultLanguage: string
  defaultLocation: string
  defaultDevice: MarketDevice
  defaultIntervalDays: string
  defaultSamples: string
  defaultPromptCount: string
  claudeBinaryPath: string
  claudeConcurrency: string
  claudeModel: string
  claudeProvider: ClaudeProvider
  codexBinaryPath: string
  codexModel: string
  codexQuickModel: string
  jinaMode: JinaMode
  budget: string
}

export interface SettingsErrors {
  userName?: string
  defaultCountry?: string
  defaultLanguage?: string
  defaultSamples?: string
  defaultPromptCount?: string
  defaultIntervalDays?: string
  claudeConcurrency?: string
  claudeBinaryPath?: string
  codexBinaryPath?: string
  budget?: string
}

export const SETTINGS_COPY = {
  userName: 'Enter your name.',
  country: 'Choose a country, or leave it unset. UK and GB are both accepted.',
  countryInvalid: 'Enter a two-letter country code. UK and GB are both accepted.',
  language: 'Choose a language, or leave it unset.',
  languageInvalid: 'Enter a language code such as en or pt-BR.',
  samples: 'Enter a whole number from 1 to 5.',
  prompts: 'Enter a whole number of questions, at least 1.',
  concurrency: 'Enter a whole number of calls, at least 1.',
  interval: 'Choose 1, 7, 14, 30, 60, or 90 days.',
  budget: PROFILE_COPY.budget,
  claudePathRelative: (names: string): string =>
    `The Claude Code path must be a full path to the ${names} program.`,
  claudePathName: (names: string): string =>
    `The Claude Code path must point to the ${names} program.`,
  codexPathRelative: (names: string): string =>
    `The Codex path must be a full path to the ${names} program.`,
  codexPathName: (names: string): string => `The Codex path must point to the ${names} program.`,
  saveFailed: 'Could not save settings. Try again.'
} as const

const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/
const WINDOWS_NAMES = ['claude.exe', 'claude.cmd'] as const
const CODEX_WINDOWS_NAMES = ['codex.exe', 'codex.cmd'] as const

/**
 * Mirrors `claudeBinaryPathProblem` in main (providers/claude/binary.ts), which
 * checks the path again on save. The renderer does not know the platform, so the
 * path's own shape decides: `C:\…`, `C:/…` or `\\server\…` is a Windows path and
 * must end in `claude.exe` or `claude.cmd` (any case). `/…` is a POSIX path and must
 * end in exactly `claude`. Anything else is not a full path. Empty means search
 * PATH and the usual install folders, so it is allowed.
 */
export function claudeBinaryPathError(value: string): string | null {
  const filePath = value.trim()
  if (filePath.length === 0) return null
  const windows = WINDOWS_ABSOLUTE.test(filePath)
  if (!windows && !filePath.startsWith('/')) {
    return SETTINGS_COPY.claudePathRelative('claude')
  }
  const name = filePath.split(windows ? /[\\/]/ : '/').at(-1) ?? ''
  if (windows) {
    return WINDOWS_NAMES.some((item) => item === name.toLowerCase())
      ? null
      : SETTINGS_COPY.claudePathName(WINDOWS_NAMES.join(' or '))
  }
  return name === 'claude' ? null : SETTINGS_COPY.claudePathName('claude')
}

/** The same rule for the Codex path (`codexBinaryPathProblem` in main). */
export function codexBinaryPathError(value: string): string | null {
  const filePath = value.trim()
  if (filePath.length === 0) return null
  const windows = WINDOWS_ABSOLUTE.test(filePath)
  if (!windows && !filePath.startsWith('/')) return SETTINGS_COPY.codexPathRelative('codex')
  const name = filePath.split(windows ? /[\\/]/ : '/').at(-1) ?? ''
  if (windows) {
    return CODEX_WINDOWS_NAMES.some((item) => item === name.toLowerCase())
      ? null
      : SETTINGS_COPY.codexPathName(CODEX_WINDOWS_NAMES.join(' or '))
  }
  return name === 'codex' ? null : SETTINGS_COPY.codexPathName('codex')
}

/**
 * Plain text for a rejected `settings:update`, without Electron's invoke wrapper
 * or the channel name. A Claude Code path problem belongs on that field.
 */
export function settingsSaveError(error: unknown): {
  message: string
  field: 'claudeBinaryPath' | 'codexBinaryPath' | null
} {
  const message = errorText(error, '', { keepProviders: true })
  if (message.length === 0) return { message: SETTINGS_COPY.saveFailed, field: null }
  return {
    message,
    field: message.startsWith('The Claude Code path')
      ? 'claudeBinaryPath'
      : message.startsWith('The Codex path')
        ? 'codexBinaryPath'
        : null
  }
}

export function draftFromSettings(settings: AppSettings, budget: string): SettingsDraft {
  return {
    userName: settings.userName ?? '',
    defaultCountry: settings.defaultCountry ?? '',
    defaultLanguage: settings.defaultLanguage ?? '',
    defaultLocation: settings.defaultLocation ?? '',
    defaultDevice: settings.defaultDevice,
    defaultIntervalDays: String(settings.defaultIntervalDays),
    defaultSamples: String(settings.defaultSamples),
    defaultPromptCount: String(settings.defaultPromptCount),
    claudeBinaryPath: settings.claudeBinaryPath ?? '',
    claudeConcurrency: String(settings.claudeConcurrency),
    claudeModel: settings.claudeModel ?? '',
    claudeProvider: settings.claudeProvider,
    codexBinaryPath: settings.codexBinaryPath ?? '',
    codexModel: settings.codexModel ?? '',
    codexQuickModel: settings.codexQuickModel ?? '',
    jinaMode: settings.jinaMode,
    budget
  }
}

function wholeNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed)) return null
  return parsed
}

export function validateSettings(
  draft: SettingsDraft
):
  | { ok: true; patch: AppSettingsPatch; cap: number | null }
  | { ok: false; errors: SettingsErrors } {
  const errors: SettingsErrors = {}
  const userName = draft.userName.trim()
  if (!userName) errors.userName = SETTINGS_COPY.userName

  const country = draft.defaultCountry.trim()
  if (country && !isCountryCode(country)) errors.defaultCountry = SETTINGS_COPY.countryInvalid

  const language = draft.defaultLanguage.trim()
  if (language && !isLanguageTag(language)) errors.defaultLanguage = SETTINGS_COPY.languageInvalid

  const interval = Number(draft.defaultIntervalDays)
  if (!isIntervalDays(interval)) errors.defaultIntervalDays = SETTINGS_COPY.interval

  const samples = wholeNumber(draft.defaultSamples)
  if (samples === null || !isSampleCount(samples)) errors.defaultSamples = SETTINGS_COPY.samples

  const prompts = wholeNumber(draft.defaultPromptCount)
  if (prompts === null) errors.defaultPromptCount = SETTINGS_COPY.prompts

  const concurrency = wholeNumber(draft.claudeConcurrency)
  if (concurrency === null) errors.claudeConcurrency = SETTINGS_COPY.concurrency

  const binaryProblem = claudeBinaryPathError(draft.claudeBinaryPath)
  if (binaryProblem !== null) errors.claudeBinaryPath = binaryProblem

  const codexProblem = codexBinaryPathError(draft.codexBinaryPath)
  if (codexProblem !== null) errors.codexBinaryPath = codexProblem

  const budget = parseSearchBudget(draft.budget)
  if ('error' in budget) errors.budget = budget.error

  if (
    errors.userName ||
    errors.defaultCountry ||
    errors.defaultLanguage ||
    errors.defaultIntervalDays ||
    errors.defaultSamples ||
    errors.defaultPromptCount ||
    errors.claudeConcurrency ||
    errors.claudeBinaryPath ||
    errors.codexBinaryPath ||
    errors.budget
  ) {
    return { ok: false, errors }
  }

  const location = draft.defaultLocation.trim()
  const binary = draft.claudeBinaryPath.trim()
  const model = draft.claudeModel.trim()
  return {
    ok: true,
    cap: 'cap' in budget ? budget.cap : null,
    patch: {
      userName,
      defaultCountry: country || null,
      defaultLanguage: language || null,
      defaultLocation: location || null,
      defaultDevice: draft.defaultDevice,
      defaultIntervalDays: interval as IntervalDays,
      defaultSamples: samples as SampleCount,
      defaultPromptCount: prompts as number,
      claudeBinaryPath: binary || null,
      claudeConcurrency: concurrency as number,
      claudeModel: model || null,
      claudeProvider: draft.claudeProvider,
      codexBinaryPath: draft.codexBinaryPath.trim() || null,
      codexModel: draft.codexModel.trim() || null,
      codexQuickModel: draft.codexQuickModel.trim() || null,
      jinaMode: draft.jinaMode
    }
  }
}
