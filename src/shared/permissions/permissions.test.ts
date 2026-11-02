import { describe, expect, test } from 'vitest'
import type { ApiKeyMetadata } from '../domain'
import type { ClaudeCheckupResult, PermissionItem, PermissionsSnapshot } from '../ipc'
import {
  buildPermissionsSnapshot,
  claudeStatus,
  friendlyModel,
  permissionPlatform,
  type PermissionInputs
} from './index'

const NOW = '2026-10-22T12:00:00.000Z'

function row(
  state: 'ok' | 'warning' | 'skipped',
  detail = 'detail'
): ClaudeCheckupResult['rows']['binary'] {
  return { state, statusLabel: state, detail, nextStep: null }
}

function checkup(partial: Partial<ClaudeCheckupResult> = {}): ClaudeCheckupResult {
  return {
    binaryPath: '/usr/local/bin/claude',
    version: '2.1.305',
    login: 'logged_in',
    plan: 'Claude Max',
    roundTrip: 'ok',
    durationMs: 1200,
    resolvedModel: 'claude-sonnet-4-5-20250929',
    ready: true,
    message: 'Claude Code is ready.',
    nextStep: null,
    rows: { binary: row('ok'), login: row('ok'), roundTrip: row('ok') },
    ...partial
  }
}

function key(partial: Partial<ApiKeyMetadata>): ApiKeyMetadata {
  return {
    id: 'key-1',
    provider: 'serpapi',
    name: 'SerpApi',
    keychainRef: 'citefox.serpapi.key-1',
    hint: 'b1f4',
    rotationOrder: 0,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: { used: 38, planLimit: 250, plan: 'Developer' },
    ...partial
  }
}

function inputs(partial: Partial<PermissionInputs> = {}): PermissionInputs {
  return {
    platform: 'darwin',
    now: NOW,
    claudeProvider: 'claude-code',
    claudeModel: null,
    checkup: null,
    checkupAt: null,
    keys: [],
    jinaMode: 'fallback',
    keychain: { stored: 0, checkedAt: null, failed: 0 },
    notifications: { supported: true, asked: false, lastResult: null },
    background: { supported: true, installed: false },
    loginItem: { supported: true, enabled: false },
    autoExport: { enabled: 0, unusable: 0 },
    email: { accounts: 0 },
    ...partial
  }
}

function item(snapshot: PermissionsSnapshot, id: PermissionItem['id']): PermissionItem {
  const found = snapshot.items.find((entry) => entry.id === id)
  if (!found) throw new Error(`missing ${id}`)
  return found
}

describe('What CiteFox needs: state mapping', () => {
  test('a first run lists every item, with Claude unchecked and SerpApi missing', () => {
    const snapshot = buildPermissionsSnapshot(inputs())
    expect(snapshot.items.map((entry) => entry.id)).toEqual([
      'claude',
      'serpapi',
      'keychain',
      'jina',
      'notifications',
      'background',
      'loginItem',
      'exportFolder',
      'email'
    ])
    expect(item(snapshot, 'claude')).toMatchObject({
      state: 'unchecked',
      statusLabel: 'Not checked yet',
      need: 'required',
      action: { kind: 'request', label: 'Check Claude Code' }
    })
    expect(item(snapshot, 'claude').checks.map((check) => check.state)).toEqual([
      'pending',
      'pending',
      'pending'
    ])
    expect(item(snapshot, 'serpapi')).toMatchObject({ state: 'action', statusLabel: 'No key yet' })
    expect(snapshot.requiredOpen).toBe(2)
    expect(snapshot.claude).toMatchObject({ state: 'unchecked', summary: 'not checked yet' })
  })

  test('a ready checkup shows plan, version and a friendly model, and is fresh for 6 hours', () => {
    const ready = inputs({ checkup: checkup(), checkupAt: '2026-10-22T09:00:00.000Z' })
    const snapshot = buildPermissionsSnapshot(ready)
    expect(item(snapshot, 'claude')).toMatchObject({
      state: 'ok',
      statusLabel: 'Connected · Claude Max',
      detail: 'Claude Code 2.1.305 · Sonnet 4.5'
    })
    expect(snapshot.claude).toMatchObject({
      state: 'ready',
      summary: 'connected',
      model: 'Sonnet 4.5',
      fresh: true
    })
    const stale = claudeStatus({ ...ready, checkupAt: '2026-10-21T12:00:00.000Z' })
    expect(stale).toMatchObject({ state: 'ready', fresh: false })
  })

  test('each Claude Code problem gets its own words and a set-up action', () => {
    const missing = checkup({
      ready: false,
      login: 'skipped',
      roundTrip: 'skipped',
      message: 'Claude Code was not found.',
      nextStep: 'Install Claude Code, then check again.',
      rows: { binary: row('warning'), login: row('skipped'), roundTrip: row('skipped') }
    })
    expect(claudeStatus(inputs({ checkup: missing, checkupAt: NOW }))).toMatchObject({
      state: 'needs_setup',
      summary: 'not found',
      nextStep: 'Install Claude Code, then check again.'
    })
    const loggedOut = checkup({
      ready: false,
      login: 'logged_out',
      roundTrip: 'skipped',
      rows: { binary: row('ok'), login: row('warning'), roundTrip: row('skipped') }
    })
    const snapshot = buildPermissionsSnapshot(inputs({ checkup: loggedOut, checkupAt: NOW }))
    expect(item(snapshot, 'claude')).toMatchObject({
      state: 'action',
      statusLabel: 'Not signed in',
      action: { kind: 'setup', label: 'Set up Claude' }
    })
    const failed = checkup({
      ready: false,
      roundTrip: 'failed',
      rows: { binary: row('ok'), login: row('ok'), roundTrip: row('warning') }
    })
    expect(claudeStatus(inputs({ checkup: failed, checkupAt: NOW })).summary).toBe(
      'test call failed'
    )
  })

  test('the Anthropic API connection reads the key, never a checkup', () => {
    const none = claudeStatus(inputs({ claudeProvider: 'anthropic-api', checkup: checkup() }))
    expect(none).toMatchObject({
      connection: 'anthropic-api',
      state: 'needs_setup',
      summary: 'no key'
    })
    const keyed = buildPermissionsSnapshot(
      inputs({
        claudeProvider: 'anthropic-api',
        keys: [key({ id: 'a', provider: 'anthropic', name: 'Anthropic', hint: '9x2z' })]
      })
    )
    expect(keyed.claude).toMatchObject({ state: 'ready', name: 'Anthropic API key' })
    expect(item(keyed, 'claude')).toMatchObject({
      title: 'Claude · Anthropic API key',
      statusLabel: 'Key works · ends 9x2z'
    })
  })

  test('SerpApi shows searches left from the shared allowance rule', () => {
    const snapshot = buildPermissionsSnapshot(inputs({ keys: [key({})] }))
    expect(item(snapshot, 'serpapi')).toMatchObject({
      state: 'ok',
      statusLabel: 'Works · 212 searches left',
      detail: 'Plan: Developer'
    })
    const rejected = buildPermissionsSnapshot(
      inputs({ keys: [key({ state: 'warning', lastReason: 'rejected' })] })
    )
    expect(item(rejected, 'serpapi')).toMatchObject({
      state: 'action',
      statusLabel: 'Key rejected'
    })
  })

  test('macOS explains the keychain prompt and the "Always Allow" choice before it appears', () => {
    const empty = buildPermissionsSnapshot(inputs())
    expect(item(empty, 'keychain')).toMatchObject({ title: 'macOS Keychain', state: 'ok' })
    expect(item(empty, 'keychain').osPrompt).toMatch(/Always Allow/)
    const saved = buildPermissionsSnapshot(
      inputs({ keychain: { stored: 2, checkedAt: null, failed: 0 } })
    )
    expect(item(saved, 'keychain')).toMatchObject({
      state: 'unchecked',
      action: { kind: 'request', label: 'Check access now' }
    })
    const denied = buildPermissionsSnapshot(
      inputs({ keychain: { stored: 2, checkedAt: NOW, failed: 1 } })
    )
    expect(item(denied, 'keychain')).toMatchObject({
      state: 'action',
      statusLabel: 'Could not read 1 key'
    })
  })

  test('notifications ask only on macOS, and only after a click', () => {
    const mac = buildPermissionsSnapshot(inputs())
    expect(item(mac, 'notifications')).toMatchObject({
      state: 'off',
      action: { kind: 'request', label: 'Turn on' }
    })
    expect(item(mac, 'notifications').osPrompt).toMatch(/would like to send you notifications/)
    const windows = buildPermissionsSnapshot(inputs({ platform: 'win32' }))
    expect(item(windows, 'notifications')).toMatchObject({
      state: 'not_needed',
      statusLabel: 'On · no permission needed',
      osPrompt: null
    })
    const blocked = buildPermissionsSnapshot(
      inputs({ notifications: { supported: true, asked: true, lastResult: 'failed' } })
    )
    expect(item(blocked, 'notifications')).toMatchObject({
      state: 'action',
      statusLabel: 'Blocked by the system'
    })
  })

  test('background checks and the login item name what each platform installs', () => {
    const mac = buildPermissionsSnapshot(inputs())
    expect(item(mac, 'background').detail).toMatch(/LaunchAgent \(app\.citefox\.checkdue\)/)
    expect(item(mac, 'background').osPrompt).toMatch(/Background Items Added/)
    expect(item(mac, 'loginItem').osPrompt).toMatch(/Login Item Added/)
    const windows = buildPermissionsSnapshot(inputs({ platform: 'win32' }))
    expect(item(windows, 'background').detail).toMatch(/CiteFox\\CheckDue/)
    const linux = buildPermissionsSnapshot(
      inputs({
        platform: 'linux',
        background: { supported: true, installed: true },
        loginItem: { supported: false, enabled: false }
      })
    )
    expect(item(linux, 'background')).toMatchObject({ state: 'ok', statusLabel: 'On · hourly' })
    expect(item(linux, 'background').detail).toMatch(/systemd/)
    expect(item(linux, 'loginItem')).toMatchObject({
      state: 'not_needed',
      statusLabel: 'Only in the installed app',
      action: null
    })
    expect(item(linux, 'keychain').title).toBe('System keyring')
  })

  test('export folder and email count only when used', () => {
    const unused = buildPermissionsSnapshot(inputs())
    expect(item(unused, 'exportFolder')).toMatchObject({ state: 'not_needed', need: 'if_used' })
    expect(item(unused, 'email')).toMatchObject({ state: 'not_needed', statusLabel: 'Not set up' })
    const used = buildPermissionsSnapshot(
      inputs({ autoExport: { enabled: 2, unusable: 1 }, email: { accounts: 1 } })
    )
    expect(item(used, 'exportFolder')).toMatchObject({
      state: 'action',
      statusLabel: '1 folder missing or not writable'
    })
    expect(item(used, 'email')).toMatchObject({ state: 'ok', statusLabel: '1 account' })
  })

  test('no item carries a secret-shaped value', () => {
    const snapshot = buildPermissionsSnapshot(
      inputs({ keys: [key({})], checkup: checkup(), checkupAt: NOW })
    )
    expect(JSON.stringify(snapshot)).not.toMatch(/sk-ant-|citefox\.serpapi/)
  })
})

describe('helpers', () => {
  test('friendlyModel names Claude models in plain words', () => {
    expect(friendlyModel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(friendlyModel('claude-opus-4-1')).toBe('Opus 4.1')
    expect(friendlyModel('claude-haiku-4')).toBe('Haiku 4')
    expect(friendlyModel('opus')).toBe('Opus')
    expect(friendlyModel('custom-model')).toBe('custom-model')
    expect(friendlyModel(null)).toBeNull()
    expect(friendlyModel('  ')).toBeNull()
  })

  test('permissionPlatform folds anything unknown to other', () => {
    expect(permissionPlatform('darwin')).toBe('darwin')
    expect(permissionPlatform('freebsd')).toBe('other')
  })
})
