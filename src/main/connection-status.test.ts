import { describe, expect, test } from 'vitest'
import type { ApiKeyMetadata } from '@shared/domain'
import { searchesLeft } from './connection-status'

function serpKey(patch: Partial<ApiKeyMetadata>): ApiKeyMetadata {
  return {
    id: 'serp-1',
    provider: 'serpapi',
    name: 'SerpApi',
    keychainRef: 'ref',
    hint: 'dc7b',
    rotationOrder: 0,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null,
    usedThisMonth: 0,
    ...patch
  }
}

describe('searchesLeft (status capsule)', () => {
  test('a shared SerpApi account does not use up CiteFox’s budget (live run: 0 left)', () => {
    const key = serpKey({
      cap: 60,
      usedThisMonth: 52,
      serpapiUsage: { used: 161_522, planLimit: 250_000, plan: 'Volume Plan' }
    })
    expect(searchesLeft([key])).toBe(8)
  })

  test('without a cap the plan figure is what is left', () => {
    const key = serpKey({ serpapiUsage: { used: 200, planLimit: 250, plan: null } })
    expect(searchesLeft([key])).toBe(50)
  })

  test('keys that are off or untested do not count', () => {
    expect(searchesLeft([serpKey({ cap: 10, on: false })])).toBeNull()
    expect(searchesLeft([serpKey({ cap: 10, state: 'unchecked' })])).toBeNull()
  })
})
