import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AppSettings } from '@shared/domain'
import type { Logger } from '../logging/logger'
import { PERMISSIONS_FILE } from '../permissions/consent'
import { openAppDatabase } from '../storage/app-database'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import { closeDatabase } from '../storage/database'
import { insertApiKey, listApiKeys, type ApiKeyRecord } from '../storage/records'
import { defaultSettings, readSettings } from '../storage/settings'
import {
  readResetMarker,
  removeResetMarker,
  writeResetMarker,
  type ResetKept,
  type ResetMarker
} from './marker'

/**
 * Files and folders the reset moves aside: everything storage owns in the data
 * folder. A name matches itself and anything that starts with it plus `-` or `.`
 * (`app.sqlite-wal`, `settings.json.corrupt-…`, atomic-write temp files).
 * `logs/`, `backups/` and Electron's own folders stay.
 */
const OWNED_FILES = [
  'app.sqlite',
  'settings.json',
  'window-state.json',
  'onboarding-draft.json',
  PERMISSIONS_FILE
]
const OWNED_FOLDERS = ['projects', 'outbox', 'check-reports']

export const BACKUPS_FOLDER = 'backups'
const RESET_PREFIX = 'reset-'
const PARTIAL_SUFFIX = '.partial'

export type ResetOutcome =
  | { status: 'none' }
  | { status: 'done'; backupDir: string; keptKeys: number }
  /** Nothing changed: the original data is in place. */
  | { status: 'failed'; message: string }

/** File steps a test can make fail part-way. Production uses the real ones. */
export interface ResetIo {
  rename(from: string, to: string): void
  openStorage(userData: string): AppStorage
}

const nodeIo: ResetIo = { rename: renameSync, openStorage: openAppStorage }

export interface PendingResetInput {
  /** Electron `userData`. Tests pass a temp folder. */
  userData: string
  now: Date
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  io?: Partial<ResetIo>
}

/**
 * Runs a reset the previous start asked for, before storage opens. Moves the
 * data into `backups/reset-<time>/` (only the newest reset backup is kept),
 * creates fresh storage, and puts the API key records back with no projects,
 * so their keychain items stay in use. No keychain item is read or removed.
 *
 * Any failure puts the original files back and removes the request, so the
 * app opens on the data it had. Only when the files cannot be put back does
 * the request stay, and the next start tries again.
 */
export function performPendingReset(input: PendingResetInput): ResetOutcome {
  const marker = readResetMarker(input.userData)
  if (marker === null) return { status: 'none' }
  const io: ResetIo = { ...nodeIo, ...input.io }
  const root = resolve(input.userData)
  const backups = join(root, BACKUPS_FOLDER)

  const earlier = finishOrUndoEarlierAttempt(root, backups, marker, io, input.logger)
  if (earlier !== null) return earlier

  let kept: ResetKept
  try {
    kept = marker.kept ?? readKept(root)
  } catch (error: unknown) {
    input.logger.error('CiteFox could not read the API keys to keep, so it did not reset', error)
    removeResetMarker(root)
    return failed('CiteFox could not read your saved keys, so nothing was reset.')
  }

  const name = backupName(backups, input.now)
  const partial = join(backups, `${name}${PARTIAL_SUFFIX}`)
  try {
    writeResetMarker(root, { ...marker, kept, backup: name })
    mkdirSync(partial, { recursive: true, mode: 0o700 })
  } catch (error: unknown) {
    input.logger.error('CiteFox could not start the reset', error)
    removeResetMarker(root)
    return failed('CiteFox could not make the backup folder, so nothing was reset.')
  }

  const moved: string[] = []
  try {
    for (const entry of ownedEntries(root)) {
      io.rename(join(root, entry), join(partial, entry))
      moved.push(entry)
    }
  } catch (error: unknown) {
    input.logger.error('CiteFox could not move the data aside, so it did not reset', error)
    return undo(root, partial, moved, io, input.logger, 'move')
  }

  try {
    createFreshStorage(root, kept, io)
  } catch (error: unknown) {
    input.logger.error('CiteFox could not create fresh data, so it did not reset', error)
    removeOwned(root)
    return undo(root, partial, moved, io, input.logger, 'fresh')
  }

  const backupDir = join(backups, name)
  let finalDir = backupDir
  try {
    io.rename(partial, backupDir)
  } catch (error: unknown) {
    // The data is reset; the backup keeps its working name.
    input.logger.warn('CiteFox could not rename the reset backup folder', error)
    finalDir = partial
  }
  pruneOlderBackups(backups, finalDir, input.logger)
  removeResetMarker(root)
  input.logger.info(
    `CiteFox reset its data and kept ${kept.keys.length} API ${kept.keys.length === 1 ? 'key' : 'keys'}; backup in ${finalDir}`
  )
  return { status: 'done', backupDir: finalDir, keptKeys: kept.keys.length }
}

/** Entries in the data folder the reset moves, sorted so the order is stable. */
export function ownedEntries(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((entry) => isOwned(entry))
    .sort()
}

function isOwned(entry: string): boolean {
  if (OWNED_FOLDERS.includes(entry)) return true
  return OWNED_FILES.some(
    (file) => entry === file || entry.startsWith(`${file}-`) || entry.startsWith(`${file}.`)
  )
}

/** Key records and the settings that go with them, read from the current data. */
function readKept(root: string): ResetKept {
  const appDatabase = join(root, 'app.sqlite')
  let keys: ApiKeyRecord[] = []
  if (existsSync(appDatabase)) {
    const db = openAppDatabase(appDatabase)
    try {
      keys = listApiKeys(db)
    } finally {
      closeDatabase(db)
    }
  }
  const settings = readSettings(join(root, 'settings.json'))
  return { keys, settings: keptSettings(settings, keys) }
}

/**
 * How the kept keys are used. The Claude provider stays on the API only when an
 * Anthropic key is kept; otherwise the first run asks again, as on a new install.
 */
export function keptSettings(
  settings: AppSettings,
  keys: readonly ApiKeyRecord[]
): Partial<AppSettings> {
  const kept: Partial<AppSettings> = {
    jinaMode: settings.jinaMode,
    serpapiRotation: settings.serpapiRotation
  }
  if (settings.claudeProvider === 'anthropic-api' && keys.some((k) => k.provider === 'anthropic')) {
    kept.claudeProvider = settings.claudeProvider
    kept.claudeModel = settings.claudeModel
  }
  return kept
}

function createFreshStorage(root: string, kept: ResetKept, io: ResetIo): void {
  const storage = io.openStorage(root)
  try {
    const transaction = storage.db.transaction(() => {
      // Projects are gone, so no key is limited to one any more.
      for (const key of kept.keys) insertApiKey(storage.db, { ...key, projectIds: [] })
    })
    transaction()
    const defaults = defaultSettings()
    const next: AppSettings = { ...defaults, ...kept.settings }
    if (JSON.stringify(next) !== JSON.stringify(defaults)) storage.writeSettings(next)
  } finally {
    storage.close()
  }
}

/**
 * A start that stopped part-way through a reset left the marker naming its
 * backup. Finished moving and renamed: only the clean-up is left. Otherwise
 * the files go back first, and the reset starts again. Null means carry on.
 */
function finishOrUndoEarlierAttempt(
  root: string,
  backups: string,
  marker: ResetMarker,
  io: ResetIo,
  logger: PendingResetInput['logger']
): ResetOutcome | null {
  if (marker.backup === null) return null
  const finalDir = join(backups, marker.backup)
  const partial = `${finalDir}${PARTIAL_SUFFIX}`
  if (existsSync(finalDir) && !existsSync(partial)) {
    pruneOlderBackups(backups, finalDir, logger)
    removeResetMarker(root)
    return { status: 'done', backupDir: finalDir, keptKeys: marker.kept?.keys.length ?? 0 }
  }
  if (!existsSync(partial)) return null
  try {
    const inBackup = readdirSync(partial)
    // Whatever the stopped attempt created in place of these is not the user's data.
    for (const entry of inBackup) rmSync(join(root, entry), { recursive: true, force: true })
    for (const entry of inBackup) io.rename(join(partial, entry), join(root, entry))
    rmSync(partial, { recursive: true, force: true })
    logger.warn('CiteFox put back the data from a reset that stopped part-way')
    return null
  } catch (error: unknown) {
    logger.error('CiteFox could not put back the data from a reset that stopped part-way', error)
    return failed(
      `CiteFox could not finish an earlier reset. Your data is in ${partial}; CiteFox tries again next start.`
    )
  }
}

/** Moves the moved entries back and drops the empty backup. Keeps the request only if that fails. */
function undo(
  root: string,
  partial: string,
  moved: readonly string[],
  io: ResetIo,
  logger: PendingResetInput['logger'],
  step: 'move' | 'fresh'
): ResetOutcome {
  try {
    for (const entry of moved) io.rename(join(partial, entry), join(root, entry))
    rmSync(partial, { recursive: true, force: true })
  } catch (error: unknown) {
    logger.error('CiteFox could not put the data back after a failed reset', error)
    return failed(
      `CiteFox could not reset, and some data is still in ${partial}. CiteFox tries again next start.`
    )
  }
  removeResetMarker(root)
  return failed(
    step === 'move'
      ? 'CiteFox could not move your data aside, so nothing was reset.'
      : 'CiteFox could not create fresh data, so nothing was reset.'
  )
}

function removeOwned(root: string): void {
  for (const entry of ownedEntries(root))
    rmSync(join(root, entry), { recursive: true, force: true })
}

function backupName(backups: string, now: Date): string {
  let at = now.getTime()
  for (;;) {
    const name = `${RESET_PREFIX}${new Date(at).toISOString().replace(/[:.]/g, '-')}`
    if (
      !existsSync(join(backups, name)) &&
      !existsSync(join(backups, `${name}${PARTIAL_SUFFIX}`))
    ) {
      return name
    }
    at += 1
  }
}

/** Keeps only the newest reset backup. Other backups in the folder are not touched. */
function pruneOlderBackups(
  backups: string,
  keep: string,
  logger: PendingResetInput['logger']
): void {
  if (!existsSync(backups)) return
  for (const entry of readdirSync(backups)) {
    const path = join(backups, entry)
    if (!entry.startsWith(RESET_PREFIX) || path === keep) continue
    try {
      rmSync(path, { recursive: true, force: true })
    } catch (error: unknown) {
      logger.warn('CiteFox could not remove an older reset backup', error)
    }
  }
}

function failed(message: string): ResetOutcome {
  return { status: 'failed', message }
}
