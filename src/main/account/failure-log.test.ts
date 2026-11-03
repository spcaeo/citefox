import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppInfo } from '@shared/ipc'
import { createLogger } from '../logging/logger'
import type { HttpTransport } from '../providers/http'
import { ProviderError } from '../providers/errors'
import { DEFAULT_APP_TOKEN } from './endpoint'
import { createAccountService } from './service'
import { createAccountStore, memoryAccountStore } from './store'
import { createUpdateService } from '../updates/service'

const INFO: AppInfo = {
  name: 'CiteFox',
  version: '0.12.0',
  build: { commit: 'abc1234', number: 1424, builtAt: '2026-11-02T13:49:00.000Z' }
}
const ENDPOINT = { url: 'https://script.google.com/macros/s/TEST/exec', token: DEFAULT_APP_TOKEN }
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    chmodSync(dir, 0o700)
    rmSync(dir, { recursive: true, force: true })
  }
})

function capture(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = []
  return { lines, logger: createLogger({ write: (_level, line) => lines.push(line) }) }
}

const offline: HttpTransport = {
  request: () => Promise.reject(new Error('connect ECONNREFUSED script.google.com'))
}

describe('the daily ping', () => {
  it('logs that it is offline, with no address', async () => {
    const { logger, lines } = capture()
    const service = createAccountService({
      store: memoryAccountStore(),
      endpoint: ENDPOINT,
      http: offline,
      appInfo: () => INFO,
      logger
    })
    await service.tick()
    const line = lines.find((entry) => entry.includes('daily ping'))
    expect(line).toContain('offline')
    expect(lines.join('\n')).not.toContain('ECONNREFUSED')
  })

  it('logs a ping the server did not accept, with its short reason', async () => {
    const { logger, lines } = capture()
    const http: HttpTransport = {
      request: (request) =>
        Promise.resolve(
          request.method === 'POST'
            ? {
                status: 302,
                body: '',
                headers: { Location: 'https://script.googleusercontent.com/x' }
              }
            : { status: 200, body: '{"ok":false,"error":"bad token"}' }
        )
    }
    const service = createAccountService({
      store: memoryAccountStore(),
      endpoint: ENDPOINT,
      http,
      appInfo: () => INFO,
      logger
    })
    await service.tick()
    const line = lines.find((entry) => entry.includes('daily ping was not accepted'))
    expect(line).toContain('"reason":"bad token"')
  })
})

describe('the account file', () => {
  it('logs the error code when it cannot be saved, never the folder', () => {
    if (process.platform === 'win32') return
    const { logger, lines } = capture()
    const dir = mkdtempSync(join(tmpdir(), 'citefox-acct-log-'))
    dirs.push(dir)
    chmodSync(dir, 0o500)
    const store = createAccountStore(
      join(dir, 'secret-folder-name', 'account.json'),
      undefined,
      logger
    )
    store.read()
    const line = lines.find((entry) => entry.includes('could not be saved'))
    expect(line).toMatch(/"code":"E[A-Z]+"/)
    expect(lines.join('\n')).not.toContain('secret-folder-name')
  })
})

describe('the update check', () => {
  function updates(
    answer: () => Promise<{ status: number; body: string }>,
    logger: ReturnType<typeof createLogger>
  ): ReturnType<typeof createUpdateService> {
    return createUpdateService({
      store: memoryAccountStore(),
      http: { request: answer },
      appInfo: () => INFO,
      logger,
      repo: 'spcaeo/citefox',
      autoCheck: true,
      platform: 'darwin',
      arch: 'arm64'
    })
  }

  it('logs the status when GitHub answers with an error', async () => {
    const { logger, lines } = capture()
    await updates(() => Promise.resolve({ status: 503, body: 'private body' }), logger).check()
    expect(lines[0]).toContain('answered with an error')
    expect(lines[0]).toContain('"status":503')
    expect(lines.join('\n')).not.toContain('private body')
  })

  it('logs a release answer it could not understand', async () => {
    const { logger, lines } = capture()
    await updates(() => Promise.resolve({ status: 200, body: 'not json' }), logger).check()
    expect(lines[0]).toContain('could not be understood')
  })

  it('logs why the request failed as a short code', async () => {
    const { logger, lines } = capture()
    await updates(
      () =>
        Promise.reject(
          new ProviderError('Network request failed for api.github.com', {
            code: 'network',
            state: 'warning',
            nextStep: null
          })
        ),
      logger
    ).check()
    expect(lines[0]).toContain('"reason":"network"')
    expect(lines[0]).not.toContain('api.github.com')
  })
})
