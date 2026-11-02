import { describe, expect, test } from 'vitest'
import type { QueueKeyInput, QueueProjectInput } from './types'
import { eligibleKeys, nextKeyAfter, queueProvider } from './usage'

/** Keys of the project's search provider (cloro or SerpApi), project migration 045. */

function key(keyId: string, provider: QueueKeyInput['provider'], order: number): QueueKeyInput {
  return {
    keyId,
    name: keyId,
    provider,
    cap: null,
    planLimit: null,
    state: 'ok',
    rotationOrder: order,
    projectIds: []
  }
}

const PROJECT: QueueProjectInput = {
  projectId: 'proj-1',
  name: 'TextBolt',
  cap: null,
  capRule: 'pause',
  dedicatedKeyId: null,
  paused: false
}

const KEYS = [key('serp-1', 'serpapi', 0), key('cloro-1', 'cloro', 0), key('cloro-2', 'cloro', 1)]

describe('provider keys', () => {
  test('auto uses cloro keys when one is usable, else SerpApi', () => {
    expect(queueProvider(KEYS, PROJECT, 'in_order')).toBe('cloro')
    expect(eligibleKeys(KEYS, PROJECT).map((item) => item.keyId)).toEqual(['cloro-1', 'cloro-2'])
    const serpOnly = KEYS.filter((item) => item.provider === 'serpapi')
    expect(queueProvider(serpOnly, PROJECT, 'in_order')).toBe('serpapi')
    expect(eligibleKeys(serpOnly, PROJECT).map((item) => item.keyId)).toEqual(['serp-1'])
    const off = KEYS.map((item) =>
      item.provider === 'cloro' ? { ...item, state: 'off' as const } : item
    )
    expect(queueProvider(off, PROJECT, 'in_order')).toBe('serpapi')
  })

  test('an explicit provider is kept, and the named provider wins', () => {
    const serp = { ...PROJECT, provider: 'serpapi' as const }
    expect(eligibleKeys(KEYS, serp).map((item) => item.keyId)).toEqual(['serp-1'])
    expect(eligibleKeys(KEYS, PROJECT, 'in_order', 'serpapi').map((item) => item.keyId)).toEqual([
      'serp-1'
    ])
    // No cloro key: an explicit cloro choice has nothing to reserve on.
    expect(eligibleKeys([KEYS[0] as QueueKeyInput], { ...PROJECT, provider: 'cloro' })).toEqual([])
  })

  test('a dedicated key narrows its own provider only', () => {
    const dedicatedSerp = { ...PROJECT, dedicatedKeyId: 'serp-1' }
    expect(eligibleKeys(KEYS, dedicatedSerp, 'in_order', 'serpapi').map((k) => k.keyId)).toEqual([
      'serp-1'
    ])
    expect(eligibleKeys(KEYS, dedicatedSerp, 'in_order', 'cloro').map((k) => k.keyId)).toEqual([
      'cloro-1',
      'cloro-2'
    ])
    // Failover still moves between cloro keys; the dedicated SerpApi key has no next key.
    expect(nextKeyAfter(KEYS, 'cloro-1', dedicatedSerp, 'in_order', () => 1, 'cloro')?.keyId).toBe(
      'cloro-2'
    )
    expect(nextKeyAfter(KEYS, 'serp-1', dedicatedSerp, 'in_order', () => 1, 'serpapi')).toBeNull()
  })
})
