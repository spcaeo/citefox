import { afterEach, describe, expect, test } from 'vitest'
import type { AddApiKeyRequest } from '@shared/ipc'
import { usageMonth } from '../keys/present'
import { createLogger } from '../logging/logger'
import { ProviderTimeoutError } from '../providers/errors'
import type { HttpTransport } from '../providers/http'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import {
  addKeyUsage,
  getApiKey,
  listApiKeysByProvider,
  listConnectionEventsForKey,
  updateApiKey
} from '../storage/records'
import { createIpcHandlers } from './index'
import {
  BINARY,
  cleanupHarness,
  closers,
  fixtureResponse,
  harness,
  keyRequest,
  noSecret,
  probeFor,
  profile,
  scriptedCommand,
  SECRET,
  treeHas
} from './test-harness'

const SHORT_SECRET = 'sekret12'

const ANTHROPIC_SECRET = 'sk-ant-api03-FAKE000000000000000000'

afterEach(cleanupHarness)

describe('IPC handlers: keys', () => {
  test('keys:add stores the secret in the keychain, masks the hint, and tests Anthropic on save', async () => {
    const { handlers, secrets, storage, logs } = harness()
    await handlers['onboarding:saveProfile'](profile())
    const serp = await handlers['keys:add'](keyRequest('serpapi', SECRET, null))
    expect(serp).toMatchObject({
      provider: 'serpapi',
      name: 'Personal',
      state: 'unchecked',
      cap: null,
      on: true,
      projectIds: [],
      hint: '9f3c',
      serpapiUsage: null
    })
    expect(serp.keychainRef).toBe(`citefox.serpapi.${serp.id}`)
    expect(secrets.get(serp.keychainRef)).toBe(SECRET)
    expect(JSON.stringify(serp)).not.toContain(SECRET)

    const short = await handlers['keys:add'](keyRequest('jina', SHORT_SECRET, 0))
    expect(short.hint).toBe('')
    expect(short.cap).toBe(0)
    expect(JSON.stringify(short)).not.toContain(SHORT_SECRET)

    const anthropic = await handlers['keys:add'](keyRequest('anthropic', ANTHROPIC_SECRET, null))
    expect(anthropic.state).toBe('ok')
    expect(JSON.stringify(anthropic)).not.toContain(ANTHROPIC_SECRET)

    const second = await handlers['keys:add'](
      keyRequest('serpapi', 'second-serp-secret-value-abcd', null)
    )
    expect(second.rotationOrder).toBe(1)
    expect(second.provider).toBe('serpapi')
    expect(JSON.stringify(second)).not.toContain('second-serp-secret-value-abcd')
    expect(noSecret({ serp, short, anthropic }, logs, SECRET)).toBe(true)
    expect(noSecret(anthropic, logs, ANTHROPIC_SECRET)).toBe(true)
    expect(treeHas(storage.paths.root, SECRET)).toBe(false)
    expect(treeHas(storage.paths.root, ANTHROPIC_SECRET)).toBe(false)
    await expect(
      handlers['keys:add']({ ...keyRequest('youtube', SECRET), extra: true } as AddApiKeyRequest)
    ).rejects.toThrow('keys:add: Invalid request')
    await expect(
      handlers['keys:add']({ ...keyRequest('youtube', SECRET), projectIds: ['missing'] })
    ).rejects.toThrow('keys:add: That project was not found')
  })

  test('keys:test updates cached state and usage and records a connection event', async () => {
    const { handlers, storage, logs } = harness()
    const added = await handlers['keys:add'](keyRequest('serpapi', SECRET, 30))
    const tested = await handlers['keys:test']({ id: added.id })
    expect(tested.message).toMatch(/Key works/)
    expect(tested.reason).toBeNull()
    expect(tested.key.state).toBe('ok')
    expect(tested.key.serpapiUsage).toEqual({ used: 38, planLimit: 250, plan: 'Developer' })
    expect(tested.key.cap).toBe(30)
    const events = listConnectionEventsForKey(storage.db, added.id)
    // SerpApi's 38 is the whole account; CiteFox has counted none of them, so its
    // cap of 30 is not reached and no cap event is recorded (live run: false cap event).
    expect(events.map((event) => event.kind)).toEqual([])
    const overview = await handlers['connections:getOverview']()
    expect(overview.serpapi).toBe('ok')
    expect(overview.searchesLeft).toBe(30)
    expect(JSON.stringify(tested)).not.toContain(SECRET)
    expect(noSecret(overview, logs, SECRET)).toBe(true)

    const rejectedKey = await handlers['keys:add'](keyRequest('jina', SECRET, null))
    const failed = await handlers['keys:test']({ id: rejectedKey.id })
    await expect(
      handlers['keys:test']({ id: rejectedKey.id, nope: SECRET } as never)
    ).rejects.toThrow('keys:test: Invalid request')
    expect(failed.key.state).toBe('warning')
    expect(failed.reason).toBe('rejected')
    expect(
      listConnectionEventsForKey(storage.db, rejectedKey.id).map((event) => event.kind)
    ).toEqual(['failed'])
    expect(noSecret(failed, logs, SECRET)).toBe(true)
    await expect(handlers['keys:test']({ id: 'missing-key' })).rejects.toThrow(
      'keys:test: That key was not found'
    )
    await expect(handlers['keys:test']({ id: added.id, secret: SECRET } as never)).rejects.toThrow(
      'keys:test: Invalid request'
    )
  })

  test('persists lastReason for each failure, clears it on ok, and keeps it after reopen', async () => {
    const kinds = ['rejected', 'out_of_searches', 'rate_limited', 'timeout', 'other'] as const
    let mode: (typeof kinds)[number] | 'ok' = 'ok'
    const http: HttpTransport = {
      async request(request) {
        if (!request.url.startsWith('https://serpapi.com/account')) {
          throw new Error('unexpected provider request')
        }
        if (mode === 'timeout') throw new ProviderTimeoutError('SerpApi account', 15_000)
        if (mode === 'rejected') return fixtureResponse('serpapi/account-invalid-key.json')
        if (mode === 'out_of_searches')
          return fixtureResponse('serpapi/account-out-of-searches.json')
        if (mode === 'rate_limited') return { status: 429, body: '{}' }
        if (mode === 'other') return { status: 200, body: 'not-json' }
        return fixtureResponse('serpapi/account-ok.json')
      }
    }
    const { handlers, storage } = harness({ http })
    const added = await handlers['keys:add'](keyRequest('serpapi', SECRET, null))
    expect(added.lastReason).toBeNull()
    expect(added.state).toBe('unchecked')

    for (const kind of kinds) {
      mode = kind
      const tested = await handlers['keys:test']({ id: added.id })
      expect(tested.reason).toBe(kind)
      expect(tested.key.state).toBe('warning')
      expect(tested.key.lastReason).toBe(kind)
      const overview = await handlers['connections:getOverview']()
      expect(overview.keys.find((key) => key.id === added.id)?.lastReason).toBe(kind)
      expect(overview.keys.find((key) => key.id === added.id)?.state).toBe('warning')
    }

    mode = 'ok'
    const cleared = await handlers['keys:test']({ id: added.id })
    expect(cleared.reason).toBeNull()
    expect(cleared.key.state).toBe('ok')
    expect(cleared.key.lastReason).toBeNull()
    expect(
      (await handlers['connections:getOverview']()).keys.find((key) => key.id === added.id)
        ?.lastReason
    ).toBeNull()

    mode = 'rejected'
    const failed = await handlers['keys:test']({ id: added.id })
    expect(failed.key.lastReason).toBe('rejected')

    const directory = storage.paths.root
    storage.close()
    closers.pop()
    const reopened = openAppStorage(directory)
    closers.push(() => reopened.close())
    expect(getApiKey(reopened.db, added.id)).toMatchObject({
      state: 'warning',
      lastReason: 'rejected'
    })
    const again = createIpcHandlers({
      appInfo: () => ({ name: 'CiteFox', version: '9.9.9' }),
      storage: reopened,
      secrets: new MemorySecretStore(new SecretRegistry()),
      logger: createLogger({ write: () => undefined }),
      http,
      claudeCommand: scriptedCommand(),
      claudeProbe: probeFor([BINARY]),
      emitCheckupProgress: () => undefined,
      emit: () => undefined
    })
    const overview = await again['connections:getOverview']()
    expect(overview.keys).toEqual([
      expect.objectContaining({
        id: added.id,
        state: 'warning',
        lastReason: 'rejected'
      })
    ])
  })

  test('keys:rename, keys:setOn, keys:setCap, keys:replace, and keys:remove keep the secret in the keychain', async () => {
    const { handlers, secrets, storage, logs } = harness()
    const added = await handlers['keys:add'](keyRequest('serpapi', SECRET, 100))
    const renamed = await handlers['keys:rename']({ id: added.id, name: 'Work' })
    expect(renamed.name).toBe('Work')
    const off = await handlers['keys:setOn']({ id: added.id, on: false })
    expect(off.on).toBe(false)
    expect((await handlers['connections:getOverview']()).serpapi).toBe('off')
    expect(listConnectionEventsForKey(storage.db, added.id).at(-1)?.detail).toBe(
      'Key switched off.'
    )
    const capped = await handlers['keys:setCap']({ id: added.id, cap: null })
    expect(capped.cap).toBeNull()
    const replaced = await handlers['keys:replace']({
      id: added.id,
      secret: 'replacement-secret-value-abcd'
    })
    expect(replaced.hint).toBe('abcd')
    expect(replaced.state).toBe('unchecked')
    expect(replaced.serpapiUsage).toBeNull()
    expect(secrets.get(replaced.keychainRef)).toBe('replacement-secret-value-abcd')
    expect(JSON.stringify(replaced)).not.toContain('replacement-secret-value-abcd')
    const removed = await handlers['keys:remove']({ id: added.id })
    expect(removed).toEqual({ id: added.id })
    expect(secrets.get(replaced.keychainRef)).toBeNull()
    expect((await handlers['connections:getOverview']()).keys).toEqual([])

    await expect(
      handlers['keys:rename']({ id: added.id, name: 'X', secret: SECRET } as never)
    ).rejects.toThrow('keys:rename: Invalid request')
    await expect(handlers['keys:setOn']({ id: 'nope', on: 'yes' } as never)).rejects.toThrow(
      'keys:setOn: Invalid request'
    )
    await expect(handlers['keys:setCap']({ id: added.id, cap: -1 })).rejects.toThrow(
      'keys:setCap: Invalid request'
    )
    await expect(handlers['keys:replace']({ id: added.id } as never)).rejects.toThrow(
      'keys:replace: Invalid request'
    )
    await expect(handlers['keys:remove']({ identifier: SECRET } as never)).rejects.toThrow(
      'keys:remove: Invalid request'
    )
    expect(logs.join('\n')).not.toContain(SECRET)
    expect(logs.join('\n')).not.toContain('replacement-secret-value-abcd')
    expect(treeHas(storage.paths.root, 'replacement-secret-value-abcd')).toBe(false)
  })

  test('keys:add appends a second and third key and accepts an explicit order', async () => {
    const { handlers, logs } = harness()
    const first = await handlers['keys:add'](keyRequest('serpapi', SECRET, null))
    const secondSecret = 'second-serp-secret-value-abcd'
    const thirdSecret = 'third-serp-secret-value-wxyz'
    const second = await handlers['keys:add'](keyRequest('serpapi', secondSecret, 10))
    const third = await handlers['keys:add'](keyRequest('serpapi', thirdSecret, null))
    expect([first, second, third].map((key) => key.rotationOrder)).toEqual([0, 1, 2])
    expect(first).toMatchObject({
      maskedKey: '••••9f3c',
      enabled: true,
      monthlyCap: null,
      plan: null,
      planLimit: null,
      usedThisMonth: 0,
      status: 'unchecked',
      statusDetail: null,
      projectIds: []
    })
    expect(JSON.stringify([first, second, third])).not.toContain(SECRET)
    expect(JSON.stringify([first, second, third])).not.toContain(secondSecret)
    expect(JSON.stringify([first, second, third])).not.toContain(thirdSecret)

    const placed = await handlers['keys:add']({
      ...keyRequest('jina', 'jina-secret-value-zzzz', null),
      rotationOrder: 4
    })
    const appended = await handlers['keys:add'](keyRequest('jina', 'jina-secret-value-yyyy', 0))
    expect(placed.rotationOrder).toBe(4)
    expect(appended.rotationOrder).toBe(5)
    expect(placed.provider).toBe('jina')
    const short = await handlers['keys:add'](keyRequest('youtube', SHORT_SECRET, null))
    expect(short.maskedKey).toBe('')
    expect(noSecret([first, placed, short], logs, SECRET)).toBe(true)

    await expect(
      handlers['keys:add']({ ...keyRequest('serpapi', SECRET), rotationOrder: -1 })
    ).rejects.toThrow('keys:add: Invalid request')
    await expect(
      handlers['keys:add']({ ...keyRequest('serpapi', SECRET), rotationOrder: 1.5 })
    ).rejects.toThrow('keys:add: Invalid request')
  })

  test('keys:reorder returns the new order and rejects a list that is not the exact set', async () => {
    const { handlers, storage } = harness()
    const first = await handlers['keys:add'](keyRequest('serpapi', SECRET, null))
    const second = await handlers['keys:add'](
      keyRequest('serpapi', 'second-serp-secret-value-abcd', null)
    )
    const third = await handlers['keys:add'](
      keyRequest('serpapi', 'third-serp-secret-value-wxyz', null)
    )
    const jina = await handlers['keys:add'](keyRequest('jina', 'jina-secret-value-zzzz', null))
    const jinaNext = await handlers['keys:add'](keyRequest('jina', 'jina-secret-value-yyyy', null))
    const exact = "keys:reorder: The list must be exactly this provider's keys"

    const reordered = await handlers['keys:reorder']({
      provider: 'serpapi',
      ids: [third.id, first.id, second.id]
    })
    expect(reordered.map((key) => key.id)).toEqual([third.id, first.id, second.id])
    expect(reordered.map((key) => key.rotationOrder)).toEqual([0, 1, 2])
    expect(reordered.every((key) => key.provider === 'serpapi')).toBe(true)

    const jinaOrder = await handlers['keys:reorder']({ ids: [jinaNext.id, jina.id] })
    expect(jinaOrder.map((key) => [key.id, key.rotationOrder, key.provider])).toEqual([
      [jinaNext.id, 0, 'jina'],
      [jina.id, 1, 'jina']
    ])

    await expect(
      handlers['keys:reorder']({ provider: 'serpapi', ids: [first.id, first.id, second.id] })
    ).rejects.toThrow(exact)
    await expect(
      handlers['keys:reorder']({ provider: 'serpapi', ids: [third.id, first.id] })
    ).rejects.toThrow(exact)
    await expect(
      handlers['keys:reorder']({
        provider: 'serpapi',
        ids: [third.id, first.id, second.id, jina.id]
      })
    ).rejects.toThrow(exact)
    await expect(
      handlers['keys:reorder']({ provider: 'jina', ids: [third.id, first.id, second.id] })
    ).rejects.toThrow(exact)
    await expect(handlers['keys:reorder']({ ids: [first.id, jina.id] })).rejects.toThrow(exact)
    await expect(handlers['keys:reorder']({ ids: [] })).rejects.toThrow(exact)
    await expect(handlers['keys:reorder']({ ids: ['missing-key', first.id] })).rejects.toThrow(
      exact
    )
    await expect(
      handlers['keys:reorder']({
        provider: 'serpapi',
        ids: [third.id, first.id, second.id],
        extra: true
      } as never)
    ).rejects.toThrow('keys:reorder: Invalid request')
    expect(listApiKeysByProvider(storage.db, 'serpapi').map((key) => key.id)).toEqual([
      third.id,
      first.id,
      second.id
    ])
  })

  test('keys:update edits metadata, keeps a disabled key in order, and works for Jina', async () => {
    const { handlers, storage } = harness()
    await handlers['onboarding:saveProfile'](profile())
    const listed = await handlers['projects:list']()
    const projectId = listed.projects[0]?.id
    if (projectId === undefined) throw new Error('missing project')

    const serp = await handlers['keys:add'](keyRequest('serpapi', SECRET, 100))
    const unchanged = await handlers['keys:update']({ id: serp.id })
    expect(unchanged.rotationOrder).toBe(0)
    expect(unchanged.name).toBe('Personal')

    const edited = await handlers['keys:update']({
      id: serp.id,
      name: 'Backup',
      plan: 'Team',
      monthlyCap: 40,
      projectIds: [projectId]
    })
    expect(edited).toMatchObject({
      name: 'Backup',
      plan: 'Team',
      monthlyCap: 40,
      cap: 40,
      enabled: true,
      on: true,
      projectIds: [projectId],
      rotationOrder: 0
    })
    expect(getApiKey(storage.db, serp.id)?.serpapiUsage).toBeNull()

    const clearedProjects = await handlers['keys:update']({ id: serp.id, projectIds: [] })
    expect(clearedProjects.projectIds).toEqual([])

    const off = await handlers['keys:update']({ id: serp.id, enabled: false })
    expect(off.enabled).toBe(false)
    expect(off.on).toBe(false)
    expect(off.rotationOrder).toBe(0)
    expect(off.status).toBe('unchecked')
    expect(listConnectionEventsForKey(storage.db, serp.id).map((event) => event.detail)).toEqual([
      'Key switched off.'
    ])
    expect(listApiKeysByProvider(storage.db, 'serpapi')[0]?.rotationOrder).toBe(0)

    const jinaSecret = 'jina-secret-value-zzzz'
    const jina = await handlers['keys:add'](keyRequest('jina', jinaSecret, null))
    const named = await handlers['keys:update']({ id: jina.id, plan: 'Reader', name: 'Reader key' })
    expect(named.plan).toBe('Reader')
    expect(named.name).toBe('Reader key')
    expect(getApiKey(storage.db, jina.id)?.plan).toBe('Reader')
    const cleared = await handlers['keys:update']({ id: jina.id, plan: null })
    expect(cleared.plan).toBeNull()
    expect(getApiKey(storage.db, jina.id)?.plan).toBeNull()
    expect(JSON.stringify(cleared)).not.toContain(jinaSecret)

    await expect(handlers['keys:update']({ id: 'missing-key', name: 'Nope' })).rejects.toThrow(
      'keys:update: That key was not found'
    )
    await expect(
      handlers['keys:update']({ id: serp.id, projectIds: ['missing-project'] })
    ).rejects.toThrow('keys:update: That project was not found')
    await expect(handlers['keys:update']({ id: serp.id, monthlyCap: -1 })).rejects.toThrow(
      'keys:update: Invalid request'
    )
    await expect(handlers['keys:update']({ id: serp.id, plan: '' })).rejects.toThrow(
      'keys:update: Invalid request'
    )
    await expect(handlers['keys:update']({ id: serp.id, extra: true } as never)).rejects.toThrow(
      'keys:update: Invalid request'
    )
    expect(getApiKey(storage.db, serp.id)?.name).toBe('Backup')
  })

  test('keys:remove deletes the keychain item and closes the rotation gap', async () => {
    const { handlers, secrets, storage } = harness()
    const first = await handlers['keys:add'](keyRequest('serpapi', SECRET, null))
    const second = await handlers['keys:add'](
      keyRequest('serpapi', 'second-serp-secret-value-abcd', null)
    )
    const third = await handlers['keys:add'](
      keyRequest('serpapi', 'third-serp-secret-value-wxyz', null)
    )
    expect(secrets.get(second.keychainRef)).toBe('second-serp-secret-value-abcd')
    await expect(handlers['keys:remove']({ id: second.id })).resolves.toEqual({ id: second.id })
    expect(secrets.get(second.keychainRef)).toBeNull()
    expect(getApiKey(storage.db, second.id)).toBeNull()
    expect(
      listApiKeysByProvider(storage.db, 'serpapi').map((key) => [key.id, key.rotationOrder])
    ).toEqual([
      [first.id, 0],
      [third.id, 1]
    ])
    await expect(handlers['keys:remove']({ id: second.id })).rejects.toThrow(
      'keys:remove: That key was not found'
    )
    await expect(handlers['keys:remove']({ id: first.id, extra: true } as never)).rejects.toThrow(
      'keys:remove: Invalid request'
    )
  })

  test('usedThisMonth counts against the lower of the cap and the plan allowance', async () => {
    const { handlers, storage } = harness()
    const added = await handlers['keys:add'](keyRequest('serpapi', SECRET, 100))
    await handlers['keys:test']({ id: added.id })
    const month = usageMonth(new Date('2026-10-19T12:00:00.000Z'))
    setPresentedUsage(storage, added.id, month, 36, 100, 40)
    const nearPlan = await handlers['keys:update']({ id: added.id })
    expect(nearPlan.usedThisMonth).toBe(36)
    expect(nearPlan.monthlyCap).toBe(100)
    expect(nearPlan.planLimit).toBe(40)
    expect(nearPlan.status).toBe('ok')
    expect(nearPlan.statusDetail).toBe('Near cap')
    expect(nearPlan.plan).toBe('Developer')

    setPresentedUsage(storage, added.id, month, 36, 100, 250)
    const underCap = await handlers['keys:update']({ id: added.id })
    expect(underCap.usedThisMonth).toBe(36)
    expect(underCap.statusDetail).toBeNull()

    setPresentedUsage(storage, added.id, month, 28, 30, 250)
    const nearCap = await handlers['keys:update']({ id: added.id })
    expect(nearCap.usedThisMonth).toBe(28)
    expect(nearCap.status).toBe('ok')
    expect(nearCap.statusDetail).toBe('Near cap')

    setPresentedUsage(storage, added.id, month, 40, 100, 40)
    const atCap = await handlers['keys:update']({ id: added.id })
    expect(atCap.usedThisMonth).toBe(40)
    expect(atCap.status).toBe('ok')
    expect(atCap.statusDetail).toBe('At cap')

    const stored = getApiKey(storage.db, added.id)
    if (stored === null) throw new Error('missing key')
    updateApiKey(storage.db, { ...stored, state: 'warning', lastReason: 'rate_limited' })
    const limited = await handlers['keys:update']({ id: added.id })
    expect(limited.status).toBe('warning')
    expect(limited.statusDetail).toBe('Rate limited')

    const current = getApiKey(storage.db, added.id)
    if (current === null) throw new Error('missing key')
    updateApiKey(storage.db, { ...current, lastReason: 'rejected' })
    const rejectedKey = await handlers['connections:getOverview']()
    const shown = rejectedKey.keys.find((key) => key.id === added.id)
    expect(shown?.status).toBe('warning')
    expect(shown?.statusDetail).toBe('Auth failed')
    expect(rejectedKey.serpapiRotation).toBe('in_order')
    expect(shown?.maskedKey).toBe('••••9f3c')
    expect(JSON.stringify(rejectedKey)).not.toContain(SECRET)
  })

  test('enabled and monthlyCap stay copies of on and cap', async () => {
    const { handlers } = harness()
    const added = await handlers['keys:add'](keyRequest('serpapi', SECRET, 10))

    await handlers['keys:update']({ id: added.id, enabled: false, monthlyCap: 40 })
    const afterUpdate = (await handlers['keys:list']()).find((key) => key.id === added.id)
    expect(afterUpdate).toMatchObject({ on: false, enabled: false, cap: 40, monthlyCap: 40 })

    const turnedOn = await handlers['keys:setOn']({ id: added.id, on: true })
    expect(turnedOn).toMatchObject({ on: true, enabled: true, cap: 40, monthlyCap: 40 })
    const capped = await handlers['keys:setCap']({ id: added.id, cap: 7 })
    expect(capped).toMatchObject({ on: true, enabled: true, cap: 7, monthlyCap: 7 })
    const afterSet = (await handlers['keys:list']()).find((key) => key.id === added.id)
    expect(afterSet).toMatchObject({ on: true, enabled: true, cap: 7, monthlyCap: 7 })
  })
})

function setPresentedUsage(
  storage: AppStorage,
  keyId: string,
  month: string,
  searches: number,
  cap: number,
  planLimit: number
): void {
  const stored = getApiKey(storage.db, keyId)
  if (stored === null || stored.serpapiUsage === null) throw new Error('missing key')
  updateApiKey(storage.db, {
    ...stored,
    cap,
    state: 'ok',
    lastReason: null,
    serpapiUsage: { ...stored.serpapiUsage, planLimit }
  })
  const updated = storage.db
    .prepare(`UPDATE key_usage SET searches = ? WHERE key_id = ? AND month = ?`)
    .run(searches, keyId, month)
  if (updated.changes === 0) {
    addKeyUsage(storage.db, {
      id: `usage-${keyId}`,
      keyId,
      projectId: null,
      month,
      searches,
      calls: 0,
      tokens: 0
    })
  }
}
