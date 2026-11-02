import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { ApiKeyMetadata, ApiKeyProvider } from '@shared/domain'
import type { AddApiKeyRequest } from '@shared/ipc'
import { CLORO_SIGNUP_URL, KEY_GUIDES } from './providerLinks'
import { testAndSave, type TestAndSaveClient } from './testAndSave'

function key(provider: ApiKeyProvider, patch: Partial<ApiKeyMetadata> = {}): ApiKeyMetadata {
  return {
    id: 'key-1',
    provider,
    name: 'My key',
    keychainRef: 'ref',
    hint: 'zz99',
    rotationOrder: 0,
    cap: null,
    on: true,
    projectIds: [],
    state: 'unchecked',
    lastReason: null,
    serpapiUsage: null,
    ...patch
  }
}

function request(provider: ApiKeyProvider): AddApiKeyRequest {
  return { provider, name: 'My key', secret: 'sk-secret-123', cap: null, projectIds: [] }
}

function client(added: ApiKeyMetadata, test?: TestAndSaveClient['testKey']): TestAndSaveClient {
  return {
    addKey: vi.fn(async () => added),
    testKey: vi.fn(
      test ??
        (async () => ({
          key: { ...added, state: 'ok' as const },
          message: 'Key works.',
          reason: null
        }))
    ),
    removeKey: vi.fn(async () => ({ removed: true }) as never)
  }
}

describe('Test and save (the 3-step key card)', () => {
  test('a SerpApi key is added, then tested once', async () => {
    const api = client(key('serpapi'))
    const outcome = await testAndSave(api, request('serpapi'))
    expect(outcome).toMatchObject({ kind: 'saved', message: 'My key tested and saved. Key works.' })
    expect(api.testKey).toHaveBeenCalledWith({ id: 'key-1' })
    expect(api.removeKey).not.toHaveBeenCalled()
  })

  test('a cloro key is tested by keys:add itself (its free balance read): no second call', async () => {
    const api = client(
      key('cloro', {
        state: 'ok',
        cloroCredits: { remaining: 37_500, perCycle: 37_500, resetsAt: null }
      })
    )
    const outcome = await testAndSave(api, request('cloro'))
    expect(outcome).toMatchObject({
      kind: 'saved',
      message: 'My key tested and saved. It works. 37,500 credits left.'
    })
    expect(api.testKey).not.toHaveBeenCalled()
  })

  test('a rejected key is taken off again, and the message never repeats it', async () => {
    const api = client(key('cloro', { state: 'warning', lastReason: 'rejected' }))
    const outcome = await testAndSave(api, request('cloro'))
    expect(outcome.kind).toBe('rejected')
    expect(outcome.message).toMatch(/cloro did not accept this key, so nothing was saved/)
    expect(outcome.message).not.toContain('sk-secret-123')
    expect(api.removeKey).toHaveBeenCalledWith({ id: 'key-1' })
  })

  test('a busy provider keeps the key, with the reason', async () => {
    const api = client(key('jina'), async () => ({
      key: key('jina', { state: 'warning', lastReason: 'rate_limited' }),
      message: 'Jina returned 429. Wait a moment and test the key again.',
      reason: 'rate_limited'
    }))
    const outcome = await testAndSave(api, request('jina'))
    expect(outcome).toMatchObject({ kind: 'warning' })
    expect(outcome.message).toContain('Jina returned 429')
    expect(api.removeKey).not.toHaveBeenCalled()
  })

  test('a test that does not finish keeps the key and hides the secret', async () => {
    const api = client(key('serpapi'), async () => {
      throw new Error('keys:test: timed out with sk-secret-123')
    })
    const outcome = await testAndSave(api, request('serpapi'))
    expect(outcome.kind).toBe('warning')
    expect(outcome.message).not.toContain('sk-secret-123')
  })

  test('the cloro sign-up link lives in one constant', () => {
    expect(KEY_GUIDES.cloro.signupUrl).toBe(CLORO_SIGNUP_URL)
    expect(CLORO_SIGNUP_URL).toBe('https://cloro.dev?fpr=citifox')
    for (const guide of Object.values(KEY_GUIDES)) {
      expect(guide.signupUrl).toMatch(/^https:\/\//)
      expect(guide.dashboardUrl).toMatch(/^https:\/\//)
    }
    // The affiliate code lives in one file: no screen writes the address itself.
    const root = join(process.cwd(), 'src/renderer/src')
    const written = (readdirSync(root, { recursive: true }) as string[])
      .filter(
        (file) => /\.tsx?$/.test(file) && !file.endsWith('.test.ts') && !file.endsWith('.test.tsx')
      )
      .filter((file) => readFileSync(join(root, file), 'utf8').includes('https://cloro.dev'))
    expect(written).toEqual([join('keys', 'providerLinks.ts')])
  })
})
