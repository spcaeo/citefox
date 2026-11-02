import type { ApiKeyMetadata, AppSchedule } from '@shared/domain'
import type {
  ClaudeCheckupResult,
  PermissionId,
  PermissionRequestResult,
  PermissionsSnapshot
} from '@shared/ipc'
import { isRequestablePermission } from '@shared/ipc'
import {
  buildPermissionsSnapshot,
  permissionPlatform,
  type PermissionInputs
} from '@shared/permissions'
import { usableExportFolder } from '../export/auto/folder'
import type { Logger } from '../logging/logger'
import type { SecretStore } from '../secrets/secret-store'
import type { AppStorage } from '../storage/app-storage'
import { listAutoExportRows } from '../storage/auto-exports'
import { getLatestClaudeCheckup } from '../storage/checkup-records'
import { listEmailAccounts } from '../storage/email-records'
import { projectDatabasePool } from '../storage/project-db-pool'
import { listProjects } from '../storage/records'
import type { PermissionConsentStore } from './consent'
import type { PermissionSystem } from './system'

export interface PermissionsScheduleControl {
  getApp(): AppSchedule
  /** `schedule:updateApp`: installs or removes the OS job and saves Open at login. */
  updateApp(patch: unknown): AppSchedule
}

export interface PermissionsServiceDeps {
  storage: AppStorage
  secrets: SecretStore
  now: () => Date
  system: PermissionSystem
  consent: PermissionConsentStore
  /** API key metadata as Connections shows it. Never a secret. */
  keys: () => readonly ApiKeyMetadata[]
  /** Null in a binding without the scheduler (some tests). */
  schedule: PermissionsScheduleControl | null
  /** Runs `claudeCode:runCheckup` with the saved path, emitting its progress. */
  runCheckup: () => Promise<ClaudeCheckupResult>
  logger?: Pick<Logger, 'error'>
}

export interface PermissionsService {
  list(): PermissionsSnapshot
  request(id: PermissionId): Promise<PermissionRequestResult>
}

/** Thrown for an item the user sets up on its own screen. Safe to show. */
export class PermissionRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermissionRequestError'
  }
}

export function createPermissionsService(deps: PermissionsServiceDeps): PermissionsService {
  function inputs(): PermissionInputs {
    const settings = deps.storage.readSettings()
    const record = safe(() => getLatestClaudeCheckup(deps.storage.db), null, deps.logger)
    const keys = deps.keys()
    const consent = deps.consent.read()
    const platform = permissionPlatform(deps.system.platform)
    const schedule = deps.schedule ? safe(() => deps.schedule?.getApp() ?? null, null) : null
    return {
      platform,
      now: deps.now().toISOString(),
      claudeProvider: settings.claudeProvider,
      claudeModel: settings.claudeModel,
      checkup: record?.result ?? null,
      checkupAt: record?.ranAt ?? null,
      keys,
      jinaMode: settings.jinaMode,
      keychain: {
        stored: secretRefs(deps.storage, keys).length,
        checkedAt: consent.keychainCheckedAt,
        failed: consent.keychainFailed
      },
      notifications: {
        supported: safe(() => deps.system.notifications.supported(), false),
        asked: consent.notifications,
        lastResult: consent.notificationResult
      },
      background: {
        supported: deps.schedule !== null && platform !== 'other',
        installed: schedule?.checkWhenClosed === true
      },
      testProfile: deps.system.testProfile === true,
      loginItem: {
        supported: deps.system.loginItem.supported,
        enabled:
          deps.system.loginItem.supported && safe(() => deps.system.loginItem.enabled(), false)
      },
      autoExport: autoExportSummary(deps.storage, deps.logger),
      email: { accounts: safe(() => listEmailAccounts(deps.storage.db).length, 0) }
    }
  }

  function list(): PermissionsSnapshot {
    return buildPermissionsSnapshot(inputs())
  }

  async function run(id: PermissionId): Promise<{ ok: boolean; message: string }> {
    if (id === 'claude') {
      const result = await deps.runCheckup()
      return {
        ok: result.ready,
        message: result.ready
          ? result.message
          : [result.message, result.nextStep].filter(Boolean).join(' ')
      }
    }
    if (id === 'keychain') return checkKeychain()
    if (id === 'notifications') {
      if (!deps.system.notifications.supported()) {
        return { ok: false, message: 'This computer does not support desktop notifications.' }
      }
      const result = await deps.system.notifications.test()
      deps.consent.update({ notifications: true, notificationResult: result })
      return result === 'shown'
        ? { ok: true, message: 'Notifications are on. A test note was sent.' }
        : { ok: false, message: 'The system blocked the notification. Allow it in its settings.' }
    }
    if ((id === 'background' || id === 'loginItem') && deps.system.testProfile === true) {
      return {
        ok: false,
        message: 'Not available in a test profile. Use your main CiteFox window.'
      }
    }
    if (id === 'background') {
      const schedule = requireSchedule()
      const next = schedule.updateApp({ checkWhenClosed: true })
      return next.checkWhenClosed
        ? { ok: true, message: 'Background checks are on. CiteFox checks due pages hourly.' }
        : { ok: false, message: 'The system did not keep the background job.' }
    }
    if (id === 'loginItem') {
      if (!deps.system.loginItem.supported) {
        return { ok: false, message: 'Open at login works in the installed app only.' }
      }
      deps.consent.update({ loginItem: true })
      deps.system.loginItem.set(true)
      // The tray applies the saved choice; save it so the item is not removed again.
      deps.schedule?.updateApp({ startAtLogin: true })
      const enabled = deps.system.loginItem.enabled()
      return enabled
        ? { ok: true, message: 'CiteFox now opens at login.' }
        : { ok: false, message: 'The system did not add the login item.' }
    }
    throw new PermissionRequestError('Set this up on its own screen.')
  }

  function requireSchedule(): PermissionsScheduleControl {
    if (deps.schedule === null) {
      throw new PermissionRequestError('Background checks are not available here.')
    }
    return deps.schedule
  }

  /** Reads each saved secret once, so any system prompt shows now, after the explanation. */
  function checkKeychain(): { ok: boolean; message: string } {
    const refs = secretRefs(deps.storage, deps.keys())
    let failed = 0
    for (const ref of refs) {
      try {
        if (deps.secrets.get(ref) === null) failed += 1
      } catch {
        failed += 1
      }
    }
    deps.consent.update({ keychainCheckedAt: deps.now().toISOString(), keychainFailed: failed })
    if (refs.length === 0) return { ok: true, message: 'Nothing is saved in the keychain yet.' }
    if (failed === 0) {
      return {
        ok: true,
        message:
          refs.length === 1
            ? 'CiteFox can read the saved secret.'
            : `CiteFox can read all ${refs.length} saved secrets.`
      }
    }
    return {
      ok: false,
      message: `CiteFox could not read ${failed} of ${refs.length} saved ${refs.length === 1 ? 'secret' : 'secrets'}.`
    }
  }

  return {
    list,
    async request(id: PermissionId): Promise<PermissionRequestResult> {
      if (!isRequestablePermission(id)) {
        throw new PermissionRequestError('Set this up on its own screen.')
      }
      const outcome = await run(id)
      return { snapshot: list(), ...outcome }
    }
  }
}

/** Keychain items CiteFox reads: every API key and each email account's password. */
export function secretRefs(storage: AppStorage, keys: readonly ApiKeyMetadata[]): string[] {
  const refs = new Set<string>()
  for (const key of keys) if (key.keychainRef) refs.add(key.keychainRef)
  const accounts = safe(() => listEmailAccounts(storage.db), [])
  for (const account of accounts) if (account.keychainRef) refs.add(account.keychainRef)
  return [...refs]
}

/** Automatic exports to a folder, across projects; a folder that is gone counts as unusable. */
export function autoExportSummary(
  storage: AppStorage,
  logger?: Pick<Logger, 'error'>
): { enabled: number; unusable: number } {
  let enabled = 0
  let unusable = 0
  const projects = safe(() => listProjects(storage.db), [], logger)
  const pool = projectDatabasePool(storage)
  for (const project of projects) {
    const rows = safe(() => listAutoExportRows(pool.get(project.slug)), [], logger)
    for (const row of rows) {
      if (!row.enabled || row.destination !== 'folder') continue
      enabled += 1
      if (!usableExportFolder(row.folder)) unusable += 1
    }
  }
  return { enabled, unusable }
}

function safe<T>(read: () => T, fallback: T, logger?: Pick<Logger, 'error'>): T {
  try {
    return read()
  } catch (error: unknown) {
    logger?.error('CiteFox could not read a permission state', error)
    return fallback
  }
}
