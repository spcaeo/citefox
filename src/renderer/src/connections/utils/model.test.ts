import { describe, expect, test } from 'vitest'
import type { ApiKeyMetadata } from '@shared/domain'
import { defaultProjectClaudeSettings } from '@shared/domain'
import {
  accountLine,
  connectionOptions,
  connectionValue,
  fallbackOptions,
  fallbackValue,
  keysInRotation,
  limitOf,
  movedIds,
  nextSort,
  plainError,
  planOf,
  serpTotalsLine,
  servesLabel,
  sortedView,
  statusWhy,
  statusWords,
  usedLine,
  usedOf,
  withConnection,
  withFallback
} from './model'

function key(patch: Partial<ApiKeyMetadata>): ApiKeyMetadata {
  return {
    id: 'k1',
    provider: 'serpapi',
    name: 'My plan',
    keychainRef: 'ref',
    hint: 'ab12',
    rotationOrder: 0,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null,
    ...patch
  }
}

const mine = key({ id: 'a', name: 'My plan', rotationOrder: 0, usedThisMonth: 1240, cap: 5000 })
const backup = key({ id: 'b', name: 'Backup', rotationOrder: 1, usedThisMonth: 18, cap: 250 })
const client = key({ id: 'c', name: 'Acme', rotationOrder: 2, usedThisMonth: 312, on: false })

describe('connections model', () => {
  test('a capped key near its plan says so: CiteFox 20 of 250,000, the account 218,102', () => {
    const nearPlan = key({
      cap: 250_000,
      usedThisMonth: 20,
      serpapiUsage: { used: 218_102, planLimit: 250_000, plan: 'Big Data' },
      statusDetail: 'Near cap'
    })
    expect(usedLine(nearPlan)).toBe('20 of 250,000')
    expect(accountLine(nearPlan)).toBe('Account 218,102 of 250,000')
    expect(statusWhy(nearPlan)).toBe(
      'Account near its plan: 218,102 of 250,000 searches used, other tools included.'
    )
    const nearCap = key({
      cap: 250,
      usedThisMonth: 230,
      serpapiUsage: { used: 300, planLimit: 5_000, plan: 'Developer' },
      statusDetail: 'Near cap'
    })
    expect(statusWhy(nearCap)).toBe('CiteFox near its cap: 230 of 250 searches.')
    expect(statusWhy(key({ statusDetail: 'At cap', cap: 10, usedThisMonth: 10 }))).toBe(
      'CiteFox at its cap: 10 of 10 searches.'
    )
    // No cap: the used figure is already the account's; a status that needs no reason has none.
    const plain = key({ serpapiUsage: { used: 40, planLimit: 250, plan: 'Free' } })
    expect(accountLine(plain)).toBe('Whole account, all tools')
    expect(statusWhy(plain)).toBeNull()
    expect(accountLine(key({}))).toBeNull()
  })

  test('a cloro key shows what CiteFox used and the account balance', () => {
    const cloro = key({
      provider: 'cloro',
      usedThisMonth: 12,
      plan: 'Lite',
      cloroCredits: { remaining: 1_230, perCycle: 37_500, resetsAt: null }
    })
    expect(usedLine(cloro)).toBe('12 by CiteFox')
    expect(accountLine(cloro)).toBe('Account 1,230 of 37,500 credits left')
    expect(statusWhy(cloro)).toBe('Account balance: 1,230 of 37,500 credits left at the last test.')
    expect(planOf(cloro)).toBe('Lite')
  })

  test('rotation order is the Order column; sorting is a view only (FR-11.2)', () => {
    const keys = [client, mine, backup]
    expect(sortedView(keys, null).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(sortedView(keys, { column: 'name', dir: 'asc' }).map((item) => item.id)).toEqual([
      'c',
      'b',
      'a'
    ])
    expect(sortedView(keys, { column: 'used', dir: 'desc' }).map((item) => item.id)).toEqual([
      'a',
      'c',
      'b'
    ])
    expect(keys.map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(nextSort(null, 'name')).toEqual({ column: 'name', dir: 'asc' })
    expect(nextSort({ column: 'name', dir: 'asc' }, 'name')).toEqual({
      column: 'name',
      dir: 'desc'
    })
    expect(nextSort({ column: 'name', dir: 'desc' }, 'name')).toBeNull()
  })

  test('moving a key sends the whole id list in the new order', () => {
    const keys = [mine, backup, client]
    expect(movedIds(keys, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(movedIds(keys, 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(movedIds(keys, 'a', -1)).toBeNull()
    expect(movedIds(keys, 'c', 1)).toBeNull()
    expect(
      keysInRotation([key({ id: 'j', provider: 'jina' }), backup, mine], 'serpapi').map(
        (item) => item.id
      )
    ).toEqual(['a', 'b'])
  })

  test('usage lines add up the keys in one plain sentence; a CiteFox cap counts CiteFox searches', () => {
    expect(serpTotalsLine([mine, backup])).toBe(
      '2 keys. CiteFox used 1,258 of 5,250 capped searches this month.'
    )
    expect(serpTotalsLine([mine, key({ id: 'x', usedThisMonth: 2 })])).toBe(
      '2 keys. 1,242 searches used this month, by CiteFox caps and SerpApi accounts.'
    )
    expect(
      serpTotalsLine([key({ id: 'p', serpapiUsage: { used: 40, planLimit: 250, plan: 'Free' } })])
    ).toBe('1 key. The SerpApi account used 40 of 250 searches this month, other tools included.')
    expect(serpTotalsLine([])).toBe('No key yet.')
    expect(
      limitOf(key({ cap: 5000, serpapiUsage: { used: 4, planLimit: 250, plan: 'Free' } }))
    ).toBe(5000)
    // Live run: the SerpApi account is shared with other tools (161,522 used). CiteFox's
    // budget of 60 is measured against CiteFox's own 52, never "161,522 of 60".
    const live = key({
      cap: 60,
      usedThisMonth: 52,
      serpapiUsage: { used: 161_522, planLimit: 250_000, plan: 'Volume Plan' }
    })
    expect(usedLine(live)).toBe('52 of 60')
    expect(usedOf(live)).toBe(52)
    expect(
      usedLine(key({ usedThisMonth: 3, serpapiUsage: { used: 40, planLimit: 250, plan: null } }))
    ).toBe('40 of 250')
    expect(usedLine(key({ usedThisMonth: 7 }))).toBe('7 · no limit')
    expect(statusWords(client)).toBe('Off')
    expect(statusWords(key({ state: 'unchecked' }))).toBe('Not tested')
    expect(statusWords(key({ state: 'warning', statusDetail: 'Auth failed' }))).toBe('Auth failed')
  })

  test('projects a key serves are named; removed projects are not', () => {
    const projects = [{ id: 'p1', name: 'TextBolt' }]
    expect(servesLabel([], projects)).toBe('All projects')
    expect(servesLabel(['p1', 'gone'], projects)).toBe('TextBolt')
    expect(servesLabel(['gone'], projects)).toBe('No project')
  })

  test('fallback options name every API key other than the chosen one (FR-11.7)', () => {
    const anthropic = [
      key({ id: 'mine', provider: 'anthropic', name: 'My key' }),
      key({ id: 'acme', provider: 'anthropic', name: 'Acme' })
    ]
    expect(connectionOptions(anthropic).map((option) => option.label)).toEqual([
      'App default (Settings)',
      'Claude Code on this computer',
      'Anthropic API · My key',
      'Anthropic API · Acme'
    ])
    const onAcme = withConnection(defaultProjectClaudeSettings(), 'key:acme')
    expect(onAcme).toMatchObject({ connection: 'api_key', keyId: 'acme' })
    expect(connectionValue(onAcme)).toBe('key:acme')
    expect(fallbackOptions(anthropic, onAcme).map((option) => option.label)).toEqual([
      'Wait for the plan limit to reset',
      'Switch to Anthropic API · My key',
      'Retry later',
      'Ask me'
    ])
    const switching = withFallback(onAcme, 'switch:mine')
    expect(switching).toMatchObject({ fallback: 'switch_key', fallbackKeyId: 'mine' })
    expect(fallbackValue(switching)).toBe('switch:mine')
    // Choosing the fallback key as the connection drops the fallback back to wait.
    expect(withConnection(switching, 'key:mine')).toMatchObject({
      keyId: 'mine',
      fallback: 'wait',
      fallbackKeyId: null
    })
    expect(withFallback(switching, 'ask')).toMatchObject({ fallback: 'ask', fallbackKeyId: null })
  })

  test('IPC errors lose the invoke wrapper and the channel prefix, never echo a secret', () => {
    expect(
      plainError(
        new Error(
          "Error invoking remote method 'keys:update': Error: keys:update: That key was not found"
        )
      )
    ).toBe('That key was not found')
    expect(plainError(new Error('keys:add: bad sk-secret-1234'), 'sk-secret-1234')).toBe(
      'Something went wrong. Try again.'
    )
  })
})
