import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanupHarness, closers, harness, keyRequest, profile } from '../handlers/test-harness'
import { createLogger } from '../logging/logger'
import { openAppStorage } from '../storage/app-storage'
import { insertApiKey, listApiKeys, listProjects, readOnboardingFinished } from '../storage/records'
import { readResetMarker, resetPending, writeResetMarker, type ResetMarker } from './marker'
import { ownedEntries, performPendingReset } from './perform'
import { requestResetKeepKeys } from './request'

const NOW = new Date('2026-10-22T20:00:00.000Z')
const SERP_SECRET = 'serp-reset-secret-value-41aa'
const ANTHROPIC_SECRET = `sk-ant-api03-${'r'.repeat(24)}wxyz`

const temp: string[] = []

afterEach(() => {
  cleanupHarness()
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function quietLogger(lines: string[] = []): ReturnType<typeof createLogger> {
  return createLogger({ write: (_level, line) => lines.push(line) })
}

function requested(): ResetMarker {
  return { version: 1, requestedAt: NOW.toISOString(), kept: null, backup: null }
}

/** A used install: a finished onboarding, a project, keys linked to it, and the side files. */
async function usedInstall(): Promise<{
  root: string
  keys: ReturnType<typeof listApiKeys>
  secrets: ReturnType<typeof harness>['secrets']
}> {
  const h = harness()
  await h.handlers['onboarding:saveProfile'](profile())
  const project = listProjects(h.storage.db)[0]
  if (project === undefined) throw new Error('no project')
  await h.handlers['keys:add']({ ...keyRequest('serpapi', SERP_SECRET), projectIds: [project.id] })
  await h.handlers['keys:add'](keyRequest('anthropic', ANTHROPIC_SECRET))
  await h.handlers['settings:update']({ claudeProvider: 'anthropic-api', userName: 'Ada' })
  await h.handlers['onboarding:finish']()
  const root = h.storage.paths.root
  const keys = listApiKeys(h.storage.db)
  h.storage.close()
  writeFileSync(join(root, 'window-state.json'), '{}')
  writeFileSync(join(root, 'permissions.json'), '{"version":1}')
  mkdirSync(join(root, 'outbox'))
  writeFileSync(join(root, 'outbox', 'mail.json'), '{}')
  mkdirSync(join(root, 'check-reports'))
  mkdirSync(join(root, 'logs'))
  writeFileSync(join(root, 'logs', 'citefox.log'), 'kept log\n')
  mkdirSync(join(root, 'backups', 'reset-2026-01-01T00-00-00-000Z'), { recursive: true })
  mkdirSync(join(root, 'backups', 'before-update'), { recursive: true })
  return { root, keys, secrets: h.secrets }
}

describe('reset, keep my keys', () => {
  test('does nothing without a request', () => {
    const root = mkdtempSync(join(tmpdir(), 'citefox-reset-'))
    temp.push(root)
    expect(performPendingReset({ userData: root, now: NOW, logger: quietLogger() })).toEqual({
      status: 'none'
    })
  })

  test('moves the data aside, keeps the keys, and opens on the first run', async () => {
    const { root, keys, secrets } = await usedInstall()
    writeResetMarker(root, requested())
    const lines: string[] = []

    const outcome = performPendingReset({ userData: root, now: NOW, logger: quietLogger(lines) })

    const backup = join(root, 'backups', 'reset-2026-10-22T20-00-00-000Z')
    expect(outcome).toEqual({ status: 'done', backupDir: backup, keptKeys: 2 })
    expect(resetPending(root)).toBe(false)
    // Everything storage owned is in the one backup; logs and other backups stay.
    expect(readdirSync(backup)).toEqual(
      expect.arrayContaining([
        'app.sqlite',
        'check-reports',
        'outbox',
        'permissions.json',
        'projects',
        'settings.json',
        'window-state.json'
      ])
    )
    expect(readdirSync(join(root, 'backups')).sort()).toEqual([
      'before-update',
      'reset-2026-10-22T20-00-00-000Z'
    ])
    expect(readFileSync(join(root, 'logs', 'citefox.log'), 'utf8')).toBe('kept log\n')
    expect(existsSync(join(root, 'window-state.json'))).toBe(false)
    expect(existsSync(join(root, 'permissions.json'))).toBe(false)
    expect(existsSync(join(root, 'outbox'))).toBe(false)

    const storage = openAppStorage(root)
    closers.push(() => storage.close())
    expect(listProjects(storage.db)).toEqual([])
    expect(readOnboardingFinished(storage.db)).toBe(false)
    const kept = listApiKeys(storage.db)
    expect(kept.map((key) => [key.id, key.provider, key.keychainRef, key.projectIds])).toEqual(
      keys.map((key) => [key.id, key.provider, key.keychainRef, []])
    )
    // The keychain items were never touched, so each kept record still reads its secret.
    for (const key of kept) expect(secrets.get(key.keychainRef)).not.toBeNull()
    const settings = storage.readSettings()
    expect(settings.userName).toBeNull()
    expect(settings.claudeProvider).toBe('anthropic-api')

    // Onboarding starts at the profile, with the saved keys already done.
    const h = harness({ storage })
    const state = await h.handlers['onboarding:getState']()
    expect(state.finished).toBe(false)
    expect(state.currentStep).toBe('profile')
    expect(state.steps).toEqual([
      { id: 'profile', status: 'pending' },
      { id: 'serpapi', status: 'done' },
      { id: 'claude', status: 'done' },
      { id: 'jina', status: 'pending' }
    ])
    expect(lines.join('\n')).not.toContain(SERP_SECRET)
  })

  test('a second reset keeps only the newest reset backup', async () => {
    const { root } = await usedInstall()
    writeResetMarker(root, requested())
    performPendingReset({ userData: root, now: NOW, logger: quietLogger() })
    writeResetMarker(root, requested())
    const later = new Date('2026-10-23T09:00:00.000Z')
    const outcome = performPendingReset({ userData: root, now: later, logger: quietLogger() })
    expect(outcome.status).toBe('done')
    expect(readdirSync(join(root, 'backups')).sort()).toEqual([
      'before-update',
      'reset-2026-10-23T09-00-00-000Z'
    ])
    const storage = openAppStorage(root)
    closers.push(() => storage.close())
    expect(listApiKeys(storage.db)).toHaveLength(2)
  })

  test('a move that fails part-way puts every file back', async () => {
    const { root } = await usedInstall()
    writeResetMarker(root, requested())
    const before = ownedEntries(root)
    let calls = 0
    const outcome = performPendingReset({
      userData: root,
      now: NOW,
      logger: quietLogger(),
      io: {
        rename: (from, to) => {
          calls += 1
          if (calls === 3) throw new Error('disk said no')
          renameSync(from, to)
        }
      }
    })
    expect(outcome).toEqual({
      status: 'failed',
      message: 'CiteFox could not move your data aside, so nothing was reset.'
    })
    expect(ownedEntries(root)).toEqual(before)
    expect(resetPending(root)).toBe(false)
    expect(readdirSync(join(root, 'backups')).sort()).toEqual([
      'before-update',
      'reset-2026-01-01T00-00-00-000Z'
    ])
    const storage = openAppStorage(root)
    closers.push(() => storage.close())
    expect(listProjects(storage.db)).toHaveLength(1)
    expect(readOnboardingFinished(storage.db)).toBe(true)
  })

  test('fresh storage that cannot be created puts the original data back', async () => {
    const { root } = await usedInstall()
    writeResetMarker(root, requested())
    const outcome = performPendingReset({
      userData: root,
      now: NOW,
      logger: quietLogger(),
      io: {
        openStorage: () => {
          writeFileSync(join(root, 'app.sqlite'), 'half made')
          throw new Error('cannot open')
        }
      }
    })
    expect(outcome.status).toBe('failed')
    expect(resetPending(root)).toBe(false)
    const storage = openAppStorage(root)
    closers.push(() => storage.close())
    expect(listProjects(storage.db)).toHaveLength(1)
  })

  test('a start that stopped part-way is put back and the reset runs again', async () => {
    const { root, keys } = await usedInstall()
    // The stopped start had saved the keys and moved app.sqlite into its backup.
    const partial = join(root, 'backups', 'reset-2026-10-22T19-00-00-000Z.partial')
    mkdirSync(partial, { recursive: true })
    renameSync(join(root, 'app.sqlite'), join(partial, 'app.sqlite'))
    writeResetMarker(root, {
      ...requested(),
      kept: { keys, settings: {} },
      backup: 'reset-2026-10-22T19-00-00-000Z'
    })

    const outcome = performPendingReset({ userData: root, now: NOW, logger: quietLogger() })

    expect(outcome.status).toBe('done')
    expect(existsSync(partial)).toBe(false)
    const backup = join(root, 'backups', 'reset-2026-10-22T20-00-00-000Z')
    expect(existsSync(join(backup, 'app.sqlite'))).toBe(true)
    const storage = openAppStorage(root)
    closers.push(() => storage.close())
    expect(listApiKeys(storage.db).map((key) => key.id)).toEqual(keys.map((key) => key.id))
  })

  test('a fresh install with nothing saved resets to an empty first run', () => {
    const root = mkdtempSync(join(tmpdir(), 'citefox-reset-'))
    temp.push(root)
    writeResetMarker(root, requested())
    const outcome = performPendingReset({ userData: root, now: NOW, logger: quietLogger() })
    expect(outcome).toMatchObject({ status: 'done', keptKeys: 0 })
  })

  test('kept key records keep their order, cap and on switch', () => {
    const root = mkdtempSync(join(tmpdir(), 'citefox-reset-'))
    temp.push(root)
    const storage = openAppStorage(root)
    insertApiKey(storage.db, {
      id: 'key-b',
      provider: 'serpapi',
      name: 'Backup',
      keychainRef: 'citefox.serpapi.key-b',
      rotationOrder: 1,
      cap: 40,
      on: false,
      projectIds: ['project-1'],
      hint: 'ab12',
      state: 'ok',
      lastReason: null,
      serpapiUsage: null
    })
    storage.close()
    writeResetMarker(root, requested())
    performPendingReset({ userData: root, now: NOW, logger: quietLogger() })
    const reopened = openAppStorage(root)
    closers.push(() => reopened.close())
    expect(listApiKeys(reopened.db)).toMatchObject([
      { id: 'key-b', name: 'Backup', rotationOrder: 1, cap: 40, on: false, projectIds: [] }
    ])
    // No Anthropic key was kept, so the Claude choice is asked again.
    expect(reopened.readSettings().claudeProvider).toBe('claude-code')
  })
})

describe('asking for the reset', () => {
  function deps(overrides: Partial<Parameters<typeof requestResetKeepKeys>[0]> = {}): {
    input: Parameters<typeof requestResetKeepKeys>[0]
    calls: string[]
    root: string
  } {
    const root = mkdtempSync(join(tmpdir(), 'citefox-reset-ask-'))
    temp.push(root)
    const calls: string[] = []
    return {
      root,
      calls,
      input: {
        userData: root,
        now: () => NOW,
        removeBackgroundJob: () => calls.push('job'),
        turnOffLoginItem: () => calls.push('login'),
        restart: () => calls.push('restart'),
        logger: quietLogger(),
        ...overrides
      }
    }
  }

  test('turns off the job and login item, saves the request, and restarts', () => {
    const { input, calls, root } = deps()
    expect(requestResetKeepKeys(input)).toEqual({ ok: true })
    expect(calls).toEqual(['job', 'login', 'restart'])
    expect(readResetMarker(root)).toEqual(requested())
  })

  test('a background job that stays installed changes nothing', () => {
    const { input, calls, root } = deps({
      removeBackgroundJob: () => {
        throw new Error('launchctl failed')
      }
    })
    const result = requestResetKeepKeys(input)
    expect(result).toEqual({
      ok: false,
      message: 'CiteFox could not turn off background checks, so nothing was reset. Try again.'
    })
    expect(calls).toEqual([])
    expect(resetPending(root)).toBe(false)
  })
})
