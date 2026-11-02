import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppInfo } from '@shared/ipc'
import type { HttpRequest, HttpResponse, HttpTransport } from '../providers/http'
import { DEFAULT_APP_TOKEN, registerEndpoint } from './endpoint'
import { parseReply, postToScript } from './post'
import { createAccountService, localDay } from './service'
import { accountFilePath, createAccountStore, memoryAccountStore } from './store'

const URL_ = 'https://script.google.com/macros/s/TEST/exec'
const ENDPOINT = { url: URL_, token: DEFAULT_APP_TOKEN }
const INFO: AppInfo = {
  name: 'CiteFox',
  version: '0.12.0',
  build: { commit: 'abc1234', number: 1424, builtAt: '2026-11-02T13:49:00.000Z' }
}
const DETAILS = {
  name: 'Ana',
  email: 'ana@agency.com',
  company: 'Agency',
  role: 'agency',
  productUpdates: true,
  news: false
}
const silent = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

/** A fake Apps Script: a POST answers 302 to the reply, like Google does. */
function fakeScript(
  reply: () => HttpResponse | Error = () => ({ status: 200, body: '{"ok":true}' })
): { http: HttpTransport; calls: HttpRequest[]; posts: () => Record<string, unknown>[] } {
  const calls: HttpRequest[] = []
  const http: HttpTransport = {
    request(request) {
      calls.push(request)
      if (request.method === 'POST') {
        return Promise.resolve({
          status: 302,
          body: '',
          headers: {
            Location: 'https://script.googleusercontent.com/macros/echo?user_content_key=k'
          }
        })
      }
      const answer = reply()
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
    }
  }
  const posts = (): Record<string, unknown>[] =>
    calls
      .filter((c) => c.method === 'POST')
      .map((c) => JSON.parse(c.body ?? '{}') as Record<string, unknown>)
  return { http, calls, posts }
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the registration endpoint', () => {
  it('is off without a URL, so dev and tests send nothing', () => {
    expect(registerEndpoint(undefined)).toBeNull()
    expect(registerEndpoint({ url: null, token: null })).toBeNull()
    expect(registerEndpoint({ url: '' })).toBeNull()
    expect(registerEndpoint({ url: 'http://script.google.com/x' })).toBeNull()
    expect(registerEndpoint({ url: URL_, token: null })).toEqual(ENDPOINT)
    expect(registerEndpoint({ url: URL_, token: 'my-own-token-1' })?.token).toBe('my-own-token-1')
  })

  it('with no URL, saving still joins here and nothing goes over the network', async () => {
    const script = fakeScript()
    const service = createAccountService({
      store: memoryAccountStore(),
      endpoint: null,
      http: script.http,
      appInfo: () => INFO,
      logger: silent
    })
    expect(service.status()).toEqual({
      enabled: false,
      joined: false,
      waiting: false,
      details: null
    })
    const saved = await service.save(DETAILS)
    expect(saved.ok && saved.status).toMatchObject({ enabled: false, joined: true, waiting: false })
    await service.tick()
    expect(script.calls).toEqual([])
  })
})

describe('Join CiteFox', () => {
  it('sends the details with the install id and app facts, following the reply redirect', async () => {
    const script = fakeScript()
    const store = memoryAccountStore()
    const service = createAccountService({
      store,
      endpoint: ENDPOINT,
      http: script.http,
      appInfo: () => INFO,
      logger: silent,
      platform: 'darwin',
      arch: 'arm64'
    })
    const result = await service.save({ ...DETAILS, email: ' Ana@Agency.com ' })
    expect(result).toEqual({
      ok: true,
      status: {
        enabled: true,
        joined: true,
        waiting: false,
        details: { ...DETAILS, role: 'agency' }
      }
    })
    expect(script.posts()[0]).toEqual({
      kind: 'register',
      installId: 'install-test',
      ...DETAILS,
      version: '0.12.0',
      build: 1424,
      os: 'darwin',
      arch: 'arm64',
      token: DEFAULT_APP_TOKEN
    })
    // The reply is read with a GET that carries nothing from the POST.
    const get = script.calls[1]
    expect(get?.method).toBe('GET')
    expect(get?.body).toBeUndefined()
  })

  it('refuses bad details before anything is saved or sent', async () => {
    const script = fakeScript()
    const service = createAccountService({
      store: memoryAccountStore(),
      endpoint: ENDPOINT,
      http: script.http,
      appInfo: () => INFO,
      logger: silent
    })
    const result = await service.save({ ...DETAILS, email: 'nope', role: 'x' })
    expect(result.ok).toBe(false)
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(['email', 'role'])
    expect(service.status().joined).toBe(false)
    expect(script.calls).toEqual([])
  })

  it('offline: joins anyway, queues the details and sends them on a later tick', async () => {
    let online = false
    const script = fakeScript(() =>
      online ? { status: 200, body: '{"ok":true}' } : new Error('offline')
    )
    let clock = new Date('2026-11-02T10:00:00')
    const service = createAccountService({
      store: memoryAccountStore(),
      endpoint: ENDPOINT,
      http: script.http,
      appInfo: () => INFO,
      logger: silent,
      now: () => clock
    })
    const saved = await service.save(DETAILS)
    expect(saved.ok && saved.status).toMatchObject({ joined: true, waiting: true })
    online = true
    // Too soon: waits an hour between tries.
    clock = new Date('2026-11-02T10:30:00')
    await service.tick()
    expect(service.status().waiting).toBe(true)
    clock = new Date('2026-11-02T11:01:00')
    await service.tick()
    expect(service.status().waiting).toBe(false)
    expect(script.posts().filter((p) => p.kind === 'register')).toHaveLength(2)
  })

  it('sends an anonymous ping at most once a day', async () => {
    const script = fakeScript()
    let clock = new Date('2026-11-02T09:00:00')
    const service = createAccountService({
      store: memoryAccountStore(),
      endpoint: ENDPOINT,
      http: script.http,
      appInfo: () => INFO,
      logger: silent,
      now: () => clock,
      platform: 'linux',
      arch: 'x64'
    })
    await service.tick()
    clock = new Date('2026-11-02T22:00:00')
    await service.tick()
    expect(script.posts()).toEqual([
      {
        kind: 'ping',
        installId: 'install-test',
        day: localDay(new Date('2026-11-02T09:00:00')),
        version: '0.12.0',
        build: 1424,
        os: 'linux',
        arch: 'x64',
        token: DEFAULT_APP_TOKEN
      }
    ])
    clock = new Date('2026-11-03T08:00:00')
    await service.tick()
    expect(script.posts()).toHaveLength(2)
    // The ping never carries the person's details.
    expect(JSON.stringify(script.posts())).not.toContain('@')
  })

  it('keeps the state app-wide in account.json, with one install id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'citefox-account-'))
    dirs.push(dir)
    const file = accountFilePath(dir)
    const first = createAccountService({
      store: createAccountStore(file, () => 'install-file-0001'),
      endpoint: null,
      http: fakeScript().http,
      appInfo: () => INFO,
      logger: silent
    })
    await first.save(DETAILS)
    const again = createAccountStore(file).read()
    expect(again.installId).toBe('install-file-0001')
    expect(again.details?.email).toBe('ana@agency.com')
    expect(readFileSync(file, 'utf8')).not.toMatch(/token|password/i)
  })
})

describe('the script reply', () => {
  it('reads ok and errors, and treats a Google error page as unreadable', () => {
    expect(parseReply('{"ok":true}')).toEqual({ ok: true })
    expect(parseReply('{"ok":false,"error":"rate"}')).toEqual({ ok: false, error: 'rate' })
    expect(parseReply('<html>')).toEqual({ ok: false, error: 'unreadable' })
  })

  it('never follows a redirect to another host', async () => {
    const calls: HttpRequest[] = []
    const http: HttpTransport = {
      request(request) {
        calls.push(request)
        return Promise.resolve({
          status: 302,
          body: '',
          headers: { location: 'https://evil.example/x' }
        })
      }
    }
    expect(await postToScript(http, ENDPOINT, { kind: 'ping' })).toEqual({
      ok: false,
      error: 'redirect'
    })
    expect(calls).toHaveLength(1)
  })
})
