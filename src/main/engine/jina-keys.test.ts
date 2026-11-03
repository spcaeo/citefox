import { afterEach, describe, expect, test } from 'vitest'
import { cleanupHarness } from '../handlers/test-harness'
import { countActivitySince, latestActivityNotice } from '../storage/activity-events'
import { listConnectionEventsForKey } from '../storage/records'
import { jinaHooks, jinaKeysInOrder } from './jina-keys'
import { adminHarness, projectRequest } from './project-settings/admin.test-helper'

afterEach(() => {
  cleanupHarness()
})

describe('Jina keys for page reads (FR-11.5, FR-11.10)', () => {
  test('keys that are on, in rotation order, never with secrets', async () => {
    const opened = adminHarness()
    const add = (name: string, secret: string): ReturnType<(typeof opened.handlers)['keys:add']> =>
      opened.handlers['keys:add']({ provider: 'jina', name, secret, cap: null, projectIds: [] })
    const first = await add('Key A', 'jina_secret_aaaaaaaaaaaa')
    const second = await add('Key B', 'jina_secret_bbbbbbbbbbbb')
    const third = await add('Key C', 'jina_secret_cccccccccccc')
    await opened.handlers['keys:reorder']({ ids: [second.id, first.id, third.id] })
    await opened.handlers['keys:setOn']({ id: third.id, on: false })
    const keys = jinaKeysInOrder(opened.storage)
    expect(keys.map((key) => key.name)).toEqual(['Key B', 'Key A'])
    expect(JSON.stringify(keys)).not.toContain('jina_secret')
  })

  test('reads and failovers are recorded in plain words', async () => {
    const opened = adminHarness()
    const project = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const a = await opened.handlers['keys:add']({
      provider: 'jina',
      name: 'Key A',
      secret: 'jina_secret_aaaaaaaaaaaa',
      cap: null,
      projectIds: []
    })
    const hooks = jinaHooks(opened.host(), project.id)
    const ref = { id: a.id, name: 'Key A', keychainRef: a.keychainRef }
    hooks.onRead?.(a.id)
    hooks.onFailover?.(ref, null)
    hooks.onRead?.(null)
    expect(countActivitySince(opened.storage.db, '2026-01-01T00:00:00.000Z').jinaReads).toBe(2)
    const events = listConnectionEventsForKey(opened.storage.db, a.id)
    expect(events.map((event) => event.kind)).toEqual(['failover'])
    expect(events[0]?.detail).toBe(
      'The page reader did not accept "Key A", so CiteFox read the page without a key at the lower rate limit.'
    )
    expect(latestActivityNotice(opened.storage.db)).toMatchObject({
      kind: 'jina_failover',
      projectId: project.id
    })
  })
})
