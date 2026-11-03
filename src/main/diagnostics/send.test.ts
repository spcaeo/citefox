import { inflateRawSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppInfo } from '@shared/ipc'
import type { ReportRoute } from '../handlers/account'
import {
  addGoogle,
  addRun,
  cleanupEngineSeeds,
  openEngineSeed,
  withDb
} from '../handlers/engines.test-helper'
import { appLogFilePath } from '../logging/file-sink'
import { createLogger } from '../logging/logger'
import type { HttpRequest, HttpResponse, HttpTransport } from '../providers/http'
import { MemorySecretStore } from '../secrets/secret-store'
import { packReport, ZIP_LOG_MAX_BYTES } from './pack'
import { newReportId, reportSummary, sendReport } from './send'
import { createDiagnosticsService, type DiagnosticsService, type SystemFacts } from './service'
import { zipDeflate } from './zip'

const SERP_SECRET = 'fixture-serpapi-secret-progress'
const ENDPOINT = {
  url: 'https://script.google.com/macros/s/AKfake/exec',
  token: 'citefox-public-v1'
}
const SYSTEM: SystemFacts = {
  platform: 'darwin',
  arch: 'arm64',
  osRelease: '25.6.0',
  electron: '39.2.7',
  node: '24.19.0',
  chrome: '142.0.7444.175',
  locale: 'en-CA',
  timeZone: 'America/Toronto'
}
const INFO: AppInfo = {
  name: 'CiteFox',
  version: '0.13.2',
  build: { commit: 'abc1234', number: 1424, builtAt: '2026-11-02T13:49:00.000Z' }
}

/** Reads the files out of a deflate zip written by zipDeflate. */
function unzip(zip: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  let end = zip.length - 22
  while (zip.readUInt32LE(end) !== 0x06054b50) end -= 1
  const count = zip.readUInt16LE(end + 10)
  let cursor = zip.readUInt32LE(end + 16)
  for (let index = 0; index < count; index += 1) {
    const method = zip.readUInt16LE(cursor + 10)
    const packedSize = zip.readUInt32LE(cursor + 20)
    const nameLength = zip.readUInt16LE(cursor + 28)
    const local = zip.readUInt32LE(cursor + 42)
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(start, start + packedSize)
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8')
    cursor += 46 + nameLength
  }
  return out
}

function fakeHttp(reply: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>): {
  http: HttpTransport
  requests: HttpRequest[]
} {
  const requests: HttpRequest[] = []
  return {
    requests,
    http: {
      async request(request) {
        requests.push(request)
        return reply(request)
      }
    }
  }
}

const json = (body: unknown, status = 200): HttpResponse => ({ status, body: JSON.stringify(body) })

afterEach(() => cleanupEngineSeeds())

function setup(options: { log?: string; http?: HttpTransport; route?: ReportRoute | null } = {}): {
  seed: ReturnType<typeof openEngineSeed>
  service: DiagnosticsService
} {
  const seed = openEngineSeed()
  const logFile = appLogFilePath(seed.storage.paths.root)
  mkdirSync(join(seed.storage.paths.root, 'logs'), { recursive: true })
  writeFileSync(logFile, options.log ?? 'one\ntwo\n')
  const secrets = new MemorySecretStore()
  secrets.set('citefox.serpapi.progress-key-1', SERP_SECRET)
  const route: ReportRoute | undefined =
    options.route === null
      ? undefined
      : (options.route ?? { endpoint: ENDPOINT, installId: () => 'inst-1' })
  const service = createDiagnosticsService({
    storage: seed.storage,
    secrets,
    appInfo: () => INFO,
    logger: createLogger({ write: () => undefined }),
    now: () => new Date('2026-11-03T14:00:00.000Z'),
    system: () => SYSTEM,
    home: () => '/Users/jane.doe',
    ...(route ? { reports: route } : {}),
    ...(options.http ? { http: options.http } : {}),
    newReportId: () => 'CF-ABC234'
  })
  return { seed, service }
}

const REQUEST = { includeQuestions: false, note: 'It broke', projectId: null, consent: true }

describe('report id', () => {
  it('is CF- and six characters without look-alikes, from a secure source', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(newReportId()).toMatch(/^CF-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)
    }
    expect(newReportId(() => 0)).toBe('CF-AAAAAA')
    expect(newReportId((below) => below - 1)).toBe('CF-999999')
  })
})

describe('the zip', () => {
  it('holds report.txt, citefox.log and environment.json', () => {
    const files = unzip(
      packReport({ report: 'REPORT', log: ['a', 'b'], environment: '{"x":1}\n' }).zip
    )
    expect(Object.keys(files)).toEqual(['report.txt', 'citefox.log', 'environment.json'])
    expect(files['report.txt']).toBe('REPORT')
    expect(files['citefox.log']).toBe('a\nb\n')
    expect(JSON.parse(files['environment.json'] ?? '')).toEqual({ x: 1 })
  })

  it('starts with the zip signature, as the server checks', () => {
    expect(
      zipDeflate([{ name: 'a', data: Buffer.from('x') }])
        .toString('base64')
        .startsWith('UEs')
    ).toBe(true)
  })

  it('cuts the log from the front to 400 KB', () => {
    const lines = Array.from(
      { length: 6000 },
      (_, index) => `${String(index).padStart(5, '0')} ${'x'.repeat(100)}`
    )
    const files = unzip(packReport({ report: 'R', log: lines, environment: '{}' }).zip)
    const log = files['citefox.log'] ?? ''
    expect(Buffer.byteLength(log)).toBeLessThanOrEqual(ZIP_LOG_MAX_BYTES)
    expect(log).toContain('05999 ')
    expect(log).not.toContain('00000 ')
  })

  it('drops the log first when the zip is too big, then cuts the report', () => {
    // Random-looking text does not compress, so sizes are real.
    const noise = (length: number): string => {
      let seed = 12345
      let out = ''
      for (let index = 0; index < length; index += 1) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
        out += String.fromCharCode(33 + ((seed >>> 16) % 90))
      }
      return out
    }
    const log = Array.from({ length: 40 }, (_, index) => `${index} ${noise(9000)}`)
    const big = packReport({ report: 'R', log, environment: '{}' }, 4000)
    expect(big.trimmed).toBe('log')
    expect(unzip(big.zip)['citefox.log']).toBe('')
    const huge = packReport({ report: noise(60_000), log, environment: '{}' }, 4000)
    expect(huge.trimmed).toBe('report')
    expect(huge.zip.length).toBeLessThanOrEqual(4000)
    expect(unzip(huge.zip)['report.txt']).toContain('[report cut to fit]')
    expect(packReport({ report: 'R', log: ['x'], environment: '{}' }).trimmed).toBe('none')
  })
})

describe('summary', () => {
  it('is the report up to its log, at most 4000 characters', () => {
    expect(reportSummary('head\n## Log (last 300 lines)\nsecret-ish line')).toBe('head')
    expect(reportSummary('x'.repeat(9000))).toHaveLength(4000)
  })
})

describe('sendReport', () => {
  const report = {
    version: '0.13.2',
    build: 1424,
    os: 'darwin',
    arch: 'arm64',
    note: 'n'.repeat(3000),
    summary: 's'.repeat(5000),
    zip: Buffer.from('PK-fake')
  }
  const route: ReportRoute = { endpoint: ENDPOINT, installId: () => 'inst-1' }

  it('posts exactly these message keys to the script, with the token', async () => {
    const { http, requests } = fakeHttp(() => json({ ok: true, reportId: 'CF-ABC234' }))
    const result = await sendReport(route, http, report, 'CF-ABC234')
    expect(result).toEqual({ ok: true, reportId: 'CF-ABC234' })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.url).toBe(ENDPOINT.url)
    const body = JSON.parse(requests[0]?.body ?? '') as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(
      [
        'arch',
        'build',
        'installId',
        'kind',
        'note',
        'os',
        'reportId',
        'summary',
        'token',
        'version',
        'zipBase64',
        'zipName'
      ].sort()
    )
    expect(body).toMatchObject({
      kind: 'report',
      reportId: 'CF-ABC234',
      installId: 'inst-1',
      version: '0.13.2',
      build: 1424,
      os: 'darwin',
      arch: 'arm64',
      zipName: 'CF-ABC234.zip',
      zipBase64: Buffer.from('PK-fake').toString('base64'),
      token: ENDPOINT.token
    })
    expect((body.note as string).length).toBe(2000)
    expect((body.summary as string).length).toBe(4000)
  })

  it.each(['token', 'invalid', 'size', 'rate', 'busy', 'unreadable'])(
    'passes the server error %s on, and loses nothing',
    async (error) => {
      const { http } = fakeHttp(() => json({ ok: false, error }))
      expect(await sendReport(route, http, report)).toEqual({ ok: false, error })
    }
  )

  it('reports an http status, a bad redirect and an unreadable page', async () => {
    expect(await sendReport(route, fakeHttp(() => json({}, 503)).http, report)).toEqual({
      ok: false,
      error: 'http-503'
    })
    expect(
      await sendReport(
        route,
        fakeHttp(() => ({ status: 302, body: '', headers: { location: 'https://evil.test/x' } }))
          .http,
        report
      )
    ).toEqual({ ok: false, error: 'redirect' })
    expect(
      await sendReport(route, fakeHttp(() => ({ status: 200, body: '<html>' })).http, report)
    ).toEqual({ ok: false, error: 'unreadable' })
  })

  it('treats a thrown network error as a failure, never as a crash', async () => {
    const { http } = fakeHttp(() => Promise.reject(new Error('ENOTFOUND')))
    expect(await sendReport(route, http, report)).toEqual({ ok: false, error: 'network' })
  })

  it('does nothing without an endpoint: the dev and test no-op', async () => {
    const { http, requests } = fakeHttp(() => json({ ok: true }))
    expect(await sendReport({ endpoint: null, installId: () => 'i' }, http, report)).toEqual({
      ok: false,
      error: 'offline'
    })
    expect(await sendReport(undefined, http, report)).toEqual({ ok: false, error: 'offline' })
    expect(requests).toHaveLength(0)
  })
})

describe('service.send', () => {
  it('sends a zip whose report.txt is the previewed text, with the log tail and no key', async () => {
    const log = `fetch failed ${SERP_SECRET}\nline two /Users/jane.doe/x\n`
    const { http, requests } = fakeHttp(() => json({ ok: true, reportId: 'CF-ABC234' }))
    const { service, seed } = setup({ log, http })
    withDb(seed, (db) => {
      addRun(db, { id: 'run-a', startedAt: '2026-11-03T10:00:00.000Z' })
      addGoogle(db, 'run-a', 'prompt-1', 1, 'error', {
        errorCode: 'rate_limited',
        message: 'Refused'
      })
    })
    const preview = service.build({ ...REQUEST, includeQuestions: false })
    const result = await service.send({ ...REQUEST, text: preview.text })
    expect(result).toEqual({ ok: true, reportId: 'CF-ABC234' })
    expect(requests).toHaveLength(1)
    const body = JSON.parse(requests[0]?.body ?? '') as Record<string, string>
    expect(body.note).toBe('It broke')
    expect(body.version).toBe('0.13.2')
    expect(body.installId).toBe('inst-1')
    expect(body.summary).toContain('Connection: Claude Code')
    expect(body.summary).not.toContain('## Log')
    const files = unzip(Buffer.from(body.zipBase64 ?? '', 'base64'))
    expect(files['report.txt']).toBe(preview.text)
    expect(files['citefox.log']).toContain('line two ~/x')
    expect(files['citefox.log']).toContain('[REDACTED]')
    const environment = JSON.parse(files['environment.json'] ?? '') as Record<string, unknown>
    expect(environment).toMatchObject({
      release: 'v0.13.2 · build 1424 · Nov 2, 2026 8:49 AM EST',
      system: { platform: 'darwin', arch: 'arm64', timeZone: 'America/Toronto' },
      aiProgram: { connection: 'Claude Code' },
      questionTextsIncluded: false
    })
    expect(environment.failedChecks).toEqual([
      { engine: 'Google AI Overview', reason: 'rate_limited', count: 1 }
    ])
    for (const text of [body.zipBase64 ?? '', ...Object.values(files), JSON.stringify(body)]) {
      expect(text).not.toContain(SERP_SECRET)
    }
    expect(JSON.stringify(files)).not.toMatch(/cloro|serpapi|jina|anthropic|jane\.doe/i)
  })

  it('builds the report itself when no text is given', async () => {
    const { http, requests } = fakeHttp(() => json({ ok: true }))
    const { service } = setup({ http })
    expect((await service.send(REQUEST)).ok).toBe(true)
    const body = JSON.parse(requests[0]?.body ?? '') as Record<string, string>
    expect(unzip(Buffer.from(body.zipBase64 ?? '', 'base64'))['report.txt']).toContain(
      'CiteFox problem report'
    )
  })

  it('cleans a shown text again before it goes', async () => {
    const { http, requests } = fakeHttp(() => json({ ok: true }))
    const { service } = setup({ http })
    await service.send({ ...REQUEST, text: `edited ${SERP_SECRET} me@x.io` })
    const body = JSON.parse(requests[0]?.body ?? '') as Record<string, string>
    const report = unzip(Buffer.from(body.zipBase64 ?? '', 'base64'))['report.txt'] ?? ''
    expect(report).not.toContain(SERP_SECRET)
    expect(report).not.toContain('me@x.io')
  })

  it('refuses without consent, and sends nothing', async () => {
    const { http, requests } = fakeHttp(() => json({ ok: true }))
    const { service } = setup({ http })
    await expect(service.send({ ...REQUEST, consent: false })).rejects.toThrow(/agree/)
    await expect(service.send({ ...REQUEST, consent: undefined as never })).rejects.toThrow()
    expect(requests).toHaveLength(0)
  })

  it('is a no-op in a build with no endpoint (dev, tests): offline, nothing leaves', async () => {
    const { http, requests } = fakeHttp(() => json({ ok: true }))
    const { service } = setup({ http, route: { endpoint: null, installId: () => 'i' } })
    expect(await service.send(REQUEST)).toEqual({ ok: false, error: 'offline' })
    const none = setup({ http, route: null })
    expect(await none.service.send(REQUEST)).toEqual({ ok: false, error: 'offline' })
    expect(requests).toHaveLength(0)
  })

  it('answers an old server that does not know the report kind like any other refusal', async () => {
    const { http } = fakeHttp(() => json({ ok: false, error: 'invalid' }))
    const { service } = setup({ http })
    expect(await service.send(REQUEST)).toEqual({ ok: false, error: 'invalid' })
  })

  it('turns a thrown network error into a failure result', async () => {
    const { http } = fakeHttp(() => Promise.reject(new Error('offline')))
    const { service } = setup({ http })
    expect(await service.send(REQUEST)).toEqual({ ok: false, error: 'network' })
  })
})
