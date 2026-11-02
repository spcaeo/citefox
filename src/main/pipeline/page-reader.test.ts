import type { PageSummary } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { createLogger } from '../logging/logger'
import { REDACTED } from '../logging/redact'
import type { HttpRequest, HttpTransport } from '../providers/http'
import { MemorySecretStore, createKeychainRef } from '../secrets/secret-store'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from '../storage/database'
import { getLatestSnapshot } from '../storage/content-records'
import { addPageMarket, insertPage } from '../storage/pages'
import { ensureProjectSchema, insertMarket, writeProjectProfile } from '../storage/project-profile'
import { PipelineError } from './errors'
import { pageReadFlags } from './flags'
import { readPage, type ReadPageOptions } from './page-reader'
import {
  TEXTBOLT_H1,
  TEXTBOLT_META,
  TEXTBOLT_PUBLISHED_UTC,
  TEXTBOLT_TITLE,
  TEXTBOLT_URL,
  textboltJinaBody
} from './textbolt-fixture'

const databases: SqliteDatabase[] = []
const NOW = '2026-10-19T12:00:00.000Z'
const ORIGINAL_FETCH = globalThis.fetch

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('read page', () => {
  test('reads the keyless Jina fixture offline and extracts the live title, H1, and meta', async () => {
    const fetchCalls: string[] = []
    globalThis.fetch = (() => {
      fetchCalls.push('network')
      throw new Error('network')
    }) as typeof fetch
    const calls: HttpRequest[] = []
    const db = projectDb()
    const result = await readPage({
      ...readerOptions(db),
      reader: 'jina',
      jinaMode: 'always',
      jinaKeychainRef: null,
      transport: {
        async request(request) {
          calls.push(request)
          return { status: 200, body: textboltJinaBody() }
        }
      }
    })

    expect(fetchCalls).toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`https://r.jina.ai/${TEXTBOLT_URL}`)
    expect(calls[0]?.headers?.authorization).toBeUndefined()
    expect(calls[0]?.headers?.['x-no-cache']).toBe('true')
    expect(result.method).toBe('jina')
    expect(result.title).toBe(TEXTBOLT_TITLE)
    expect(result.title?.length).toBeLessThanOrEqual(60)
    expect(result.h1).toBe(TEXTBOLT_H1)
    expect((result.h1 ?? '').length).toBeGreaterThan(60)
    expect(result.metaDescription).toBe(TEXTBOLT_META)
    expect(result.titleMatchesH1).toBe(false)
    expect(result.publishedAt).toBe(TEXTBOLT_PUBLISHED_UTC)
    expect(result.modifiedAt).toBeNull()
    expect(result.flags.map((flag) => flag.code)).toContain('title_differs_from_h1')
    expect(result.flags.some((flag) => flag.code === 'title_long')).toBe(false)
    expect(result.outline.map((entry) => entry.text)).toContain(
      'How to Schedule a Text Alert From Gmail or Outlook'
    )
    expect(result.faqs.some((faq) => faq.typo === 'Question ends with ??.')).toBe(true)
    expect(result.summary).toBeNull()
    expect(getLatestSnapshot(db, 'page-1')?.bodyText).toContain(TEXTBOLT_H1)
  })

  test('falls back to Jina after one direct 404 and can force direct or Jina', async () => {
    const db = projectDb()
    const calls: string[] = []
    const transport: HttpTransport = {
      async request(request) {
        calls.push(request.url)
        if (request.url.startsWith('https://r.jina.ai/'))
          return { status: 200, body: textboltJinaBody() }
        return { status: 404, body: 'missing' }
      }
    }
    const fallback = await readPage({
      ...readerOptions(db, 'page-1'),
      reader: 'auto',
      jinaMode: 'fallback',
      transport
    })
    expect(fallback.method).toBe('jina')
    expect(calls.filter((url) => url === TEXTBOLT_URL)).toHaveLength(1)

    const never = projectDb()
    insertPage(never, samplePage({ id: 'page-2', url: 'https://example.com/direct-only' }))
    const directCalls: string[] = []
    await expect(
      readPage({
        ...readerOptions(never, 'page-2'),
        reader: 'auto',
        jinaMode: 'never',
        transport: {
          async request(request) {
            directCalls.push(request.url)
            return { status: 404, body: '' }
          }
        }
      })
    ).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(directCalls.every((url) => !url.includes('r.jina.ai'))).toBe(true)

    const always = projectDb()
    insertPage(always, samplePage({ id: 'page-3', url: 'https://example.com/jina-only' }))
    const jinaCalls: string[] = []
    await readPage({
      ...readerOptions(always, 'page-3'),
      reader: 'jina',
      jinaMode: 'never',
      transport: {
        async request(request) {
          jinaCalls.push(request.url)
          return { status: 200, body: textboltJinaBody() }
        }
      }
    })
    expect(jinaCalls).toEqual(['https://r.jina.ai/https://example.com/jina-only'])
  })

  test('reuses a stored snapshot, honors delay, rejects localhost, and redacts secrets', async () => {
    const db = projectDb()
    const calls: string[] = []
    const transport: HttpTransport = {
      async request(request) {
        calls.push(request.url)
        return { status: 200, body: textboltJinaBody() }
      }
    }
    let slept = 0
    await readPage({
      ...readerOptions(db),
      reader: 'jina',
      jinaMode: 'always',
      transport,
      delayMs: 15,
      sleep: async (ms) => {
        slept += ms
      }
    })
    expect(slept).toBe(15)
    await readPage({
      ...readerOptions(db),
      reader: 'jina',
      jinaMode: 'always',
      transport,
      reuseStored: true
    })
    expect(calls).toHaveLength(1)

    insertPage(db, samplePage({ id: 'page-local', url: 'http://127.0.0.1/alerts' }))
    await expect(
      readPage({
        ...readerOptions(db, 'page-local'),
        reader: 'direct',
        jinaMode: 'never',
        transport
      })
    ).rejects.toBeInstanceOf(PipelineError)
    expect(calls).toHaveLength(1)

    const secret = 'jina-secret-value'
    const lines: string[] = []
    const store = new MemorySecretStore()
    const ref = createKeychainRef('jina')
    store.set(ref, secret)
    const logged = createLogger({
      write: (_level, line) => {
        lines.push(line)
      },
      secrets: [secret]
    })
    await expect(
      readPage({
        ...readerOptions(db),
        reader: 'jina',
        jinaMode: 'always',
        secretStore: store,
        jinaKeychainRef: ref,
        secrets: [secret],
        logger: logged,
        transport: {
          async request() {
            throw new Error(`reader failed ${secret} sk-ant-api03-abcdefghij`)
          }
        }
      })
    ).rejects.toBeInstanceOf(PipelineError)
    const log = lines.join('\n')
    expect(log.includes(secret)).toBe(false)
    expect(log.includes('sk-ant-api03-abcdefghij')).toBe(false)
    expect(log.includes(REDACTED)).toBe(true)
  })

  test('reuses the stored snapshot when the content hash is unchanged', async () => {
    const db = projectDb()
    const same = `# ${TEXTBOLT_H1}\n\nA short body about scheduled alerts for the crew.\n`
    const first = await readPage({
      ...readerOptions(db),
      reader: 'file',
      suppliedText: same
    })
    expect(first.snapshotReused).toBe(false)
    expect(snapshotCount(db, 'page-1')).toBe(1)

    const again = await readPage({
      ...readerOptions(db),
      reader: 'file',
      suppliedText: same
    })
    expect(again.snapshotReused).toBe(true)
    expect(again.id).toBe(first.id)
    expect(again.contentHash).toBe(first.contentHash)
    expect(getLatestSnapshot(db, 'page-1')?.id).toBe(first.id)
    expect(snapshotCount(db, 'page-1')).toBe(1)

    const changed = await readPage({
      ...readerOptions(db),
      reader: 'file',
      suppliedText: `# ${TEXTBOLT_H1}\n\nA different body about scheduled alerts.\n`
    })
    expect(changed.snapshotReused).toBe(false)
    expect(changed.id).not.toBe(first.id)
    expect(changed.contentHash).not.toBe(first.contentHash)
    expect(getLatestSnapshot(db, 'page-1')?.id).toBe(changed.id)
    expect(snapshotCount(db, 'page-1')).toBe(2)
  })

  test('reads supplied markdown without a network call and flags a long title', async () => {
    const db = projectDb()
    const calls: string[] = []
    const result = await readPage({
      ...readerOptions(db),
      reader: 'file',
      suppliedText: `# ${TEXTBOLT_H1}\n\nA short body about scheduled alerts for the crew.\n`,
      transport: {
        async request(request) {
          calls.push(request.url)
          throw new Error('network')
        }
      }
    })
    expect(calls).toEqual([])
    expect(result.method).toBe('file')
    expect(result.httpStatus).toBeNull()
    expect(result.h1).toBe(TEXTBOLT_H1)

    const flags = pageReadFlags({
      title: TEXTBOLT_H1,
      metaDescription: TEXTBOLT_META,
      h1: TEXTBOLT_H1
    })
    const long = flags.find((flag) => flag.code === 'title_long')
    expect(long?.preview?.endsWith('...')).toBe(true)
    expect((long?.preview ?? '').length).toBeLessThanOrEqual(63)
  })
})

describe('direct fetch SSRF', () => {
  const blocked: readonly (readonly [string, string])[] = [
    ['0.0.0.0/8', 'http://0.1.2.3/x'],
    ['127/8', 'http://127.8.8.8/x'],
    ['10/8', 'http://10.1.2.3/x'],
    ['172.16/12', 'http://172.16.5.5/x'],
    ['192.168/16', 'http://192.168.0.20/x'],
    ['169.254/16', 'http://169.254.1.1/x'],
    ['metadata', 'http://169.254.169.254/latest/meta-data'],
    ['100.64/10', 'http://100.64.0.1/x'],
    ['unspecified IPv6', 'http://[::]/x'],
    ['loopback IPv6', 'http://[::1]/x'],
    ['fc00::/7', 'http://[fc00::1]/x'],
    ['fd00::/8', 'http://[fd12:3456::1]/x'],
    ['fe80::/10', 'http://[fe80::1]/x'],
    ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.1]/x']
  ]

  test.each(blocked)('rejects %s before any request', async (_label, url) => {
    const db = projectDb()
    insertPage(db, samplePage({ id: 'page-ssrf', url }))
    const calls: string[] = []
    await expect(
      readPage({
        ...readerOptions(db, 'page-ssrf'),
        reader: 'direct',
        jinaMode: 'never',
        dns: {
          async lookup(): Promise<readonly string[]> {
            throw new Error('dns')
          }
        },
        transport: {
          async request(request) {
            calls.push(request.url)
            return { status: 200, body: '<p>should not load</p>' }
          }
        }
      })
    ).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(calls).toEqual([])
  })

  test('rejects a hostname that resolves to a private address', async () => {
    const db = projectDb()
    insertPage(db, samplePage({ id: 'page-ssrf', url: 'https://internal.example/admin' }))
    const calls: string[] = []
    await expect(
      readPage({
        ...readerOptions(db, 'page-ssrf'),
        reader: 'direct',
        jinaMode: 'never',
        dns: {
          async lookup(): Promise<readonly string[]> {
            return ['10.9.8.7']
          }
        },
        transport: {
          async request(request) {
            calls.push(request.url)
            return { status: 200, body: '<p>no</p>' }
          }
        }
      })
    ).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(calls).toEqual([])
  })

  test('rejects a redirect onto a private host before the second request', async () => {
    const db = projectDb()
    insertPage(db, samplePage({ id: 'page-ssrf', url: 'https://public.example/start' }))
    const calls: string[] = []
    await expect(
      readPage({
        ...readerOptions(db, 'page-ssrf'),
        reader: 'direct',
        jinaMode: 'never',
        dns: {
          async lookup(hostname: string): Promise<readonly string[]> {
            if (hostname === 'hidden.example') return ['192.168.1.9']
            return ['8.8.8.8']
          }
        },
        transport: {
          async request(request) {
            calls.push(request.url)
            return {
              status: 302,
              body: '',
              headers: { location: 'https://hidden.example/secret' }
            }
          }
        }
      })
    ).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(calls).toEqual(['https://public.example/start'])
  })

  test('reads an allowed public host', async () => {
    const db = projectDb()
    insertPage(db, samplePage({ id: 'page-ssrf', url: 'https://public.example/page' }))
    const result = await readPage({
      ...readerOptions(db, 'page-ssrf'),
      reader: 'direct',
      jinaMode: 'never',
      dns: {
        async lookup(): Promise<readonly string[]> {
          return ['8.8.8.8']
        }
      },
      transport: {
        async request() {
          return {
            status: 200,
            body: '<html><head><title>Public</title></head><body><h1>Public</h1><p>A public page.</p></body></html>'
          }
        }
      }
    })
    expect(result.method).toBe('direct')
    expect(result.title).toBe('Public')
  })
})

describe('direct fetch hardening', () => {
  const html =
    '<html><head><title>Caf\u00e9</title></head><body><h1>Caf\u00e9 menu</h1><p>Cr\u00e8me br\u00fbl\u00e9e and more text.</p></body></html>'

  function directOptions(db: SqliteDatabase, transport: HttpTransport): ReadPageOptions {
    insertPage(db, samplePage({ id: 'page-hard', url: 'https://public.example/menu' }))
    return {
      ...readerOptions(db, 'page-hard'),
      reader: 'direct',
      jinaMode: 'never',
      transport
    }
  }

  test('pins the connection: the transport gets a resolver that re-checks every address', async () => {
    let lookups = 0
    const db = projectDb()
    const seen: Array<readonly string[]> = []
    await expect(
      readPage({
        ...directOptions(db, {
          async request(request) {
            if (request.resolveHost === undefined) throw new Error('no pinning resolver')
            seen.push(await request.resolveHost('public.example'))
            return { status: 200, body: html }
          }
        }),
        dns: {
          async lookup(): Promise<readonly string[]> {
            lookups += 1
            return lookups === 1 ? ['8.8.8.8'] : ['10.0.0.5']
          }
        }
      })
    ).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(lookups).toBe(2)
    expect(seen).toEqual([])
    expect(snapshotCount(db, 'page-hard')).toBe(0)
  })

  test('caps the page size and asks the transport to stop early', async () => {
    const db = projectDb()
    const caps: Array<number | undefined> = []
    await expect(
      readPage(
        directOptions(db, {
          async request(request) {
            caps.push(request.maxBodyBytes)
            return { status: 200, body: `<p>${'x'.repeat(5 * 1024 * 1024 + 1)}</p>` }
          }
        })
      )
    ).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(caps[0]).toBe(5 * 1024 * 1024)
  })

  test('refuses a non-HTML content type', async () => {
    const db = projectDb()
    await expect(
      readPage(
        directOptions(db, {
          async request() {
            return {
              status: 200,
              body: '%PDF-1.7',
              headers: { 'content-type': 'application/pdf' }
            }
          }
        })
      )
    ).rejects.toMatchObject({ code: 'fetch_failed' })
  })

  test('decodes the declared charset and hashes the decoded text', async () => {
    const latin = projectDb()
    const fromLatin = await readPage(
      directOptions(latin, {
        async request() {
          return {
            status: 200,
            body: 'mojibake',
            bytes: Uint8Array.from(Buffer.from(html, 'latin1')),
            headers: { 'content-type': 'text/html; charset=windows-1252' }
          }
        }
      })
    )
    const utf8 = projectDb()
    const fromUtf8 = await readPage(
      directOptions(utf8, {
        async request() {
          return {
            status: 200,
            body: html,
            bytes: Uint8Array.from(Buffer.from(html, 'utf8')),
            headers: { 'content-type': 'text/html; charset=utf-8' }
          }
        }
      })
    )
    expect(fromLatin.title).toBe('Caf\u00e9')
    expect(fromLatin.h1).toBe('Caf\u00e9 menu')
    expect(fromLatin.contentHash).toBe(fromUtf8.contentHash)
  })
})

describe('AI Overview eligibility on a page read', () => {
  const PAGE =
    '<html><head><title>Text alerts</title><meta name="robots" content="max-snippet:20"></head>' +
    '<body><h1>Text alerts</h1><p>Send text alerts to staff from the email tools they use.</p></body></html>'

  function serving(
    body: string,
    headers: Record<string, string>
  ): HttpTransport & { calls: () => number } {
    let calls = 0
    return {
      calls: () => calls,
      async request() {
        calls += 1
        return { status: 200, body, headers: { 'content-type': 'text/html', ...headers } }
      }
    }
  }

  test('a direct read stores the robots rules on the snapshot and reports them', async () => {
    const db = projectDb()
    const result = await readPage({
      ...readerOptions(db),
      reader: 'direct',
      jinaMode: 'never',
      transport: serving(PAGE, { 'x-robots-tag': 'googlebot: nosnippet' })
    })
    expect(result.method).toBe('direct')
    expect(result.eligibility?.issues.map((issue) => [issue.code, issue.where])).toEqual([
      ['nosnippet', 'header'],
      ['max_snippet', 'meta']
    ])
    expect(getLatestSnapshot(db, 'page-1')?.eligibility).toEqual(result.eligibility)
  })

  test('an unchanged page read again keeps its snapshot but takes the new robots rules', async () => {
    const db = projectDb()
    const first = await readPage({
      ...readerOptions(db),
      reader: 'direct',
      jinaMode: 'never',
      transport: serving(PAGE, { 'x-robots-tag': 'noindex' })
    })
    const again = await readPage({
      ...readerOptions(db),
      reader: 'direct',
      jinaMode: 'never',
      transport: serving(PAGE, {})
    })
    expect(again.snapshotReused).toBe(true)
    expect(again.id).toBe(first.id)
    expect(first.eligibility?.issues.map((issue) => issue.code)).toContain('noindex')
    expect(again.eligibility?.issues.map((issue) => issue.code)).toEqual(['max_snippet'])
    expect(getLatestSnapshot(db, 'page-1')?.eligibility).toEqual(again.eligibility)
  })

  test('a Jina read has no eligibility and leaves a stored one alone', async () => {
    const db = projectDb()
    const jina = await readPage({
      ...readerOptions(db),
      reader: 'jina',
      jinaMode: 'always',
      transport: {
        async request() {
          return { status: 200, body: textboltJinaBody() }
        }
      }
    })
    expect(jina.eligibility).toBeNull()
    expect(getLatestSnapshot(db, 'page-1')?.eligibility).toBeNull()
  })
})

function readerOptions(db: SqliteDatabase, pageId = 'page-1'): ReadPageOptions {
  return {
    db,
    transport: {
      async request(): Promise<{ status: number; body: string }> {
        return { status: 200, body: '' }
      }
    },
    logger: createLogger({ write: () => undefined }),
    secretStore: new MemorySecretStore(),
    jinaKeychainRef: null,
    reader: 'auto' as const,
    jinaMode: 'fallback' as const,
    pageId,
    projectId: 'proj-1',
    dns: {
      async lookup(): Promise<readonly string[]> {
        return ['8.8.8.8']
      }
    },
    now: () => NOW,
    clock: () => 1_000,
    secrets: [] as string[]
  }
}

function projectDb(): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  ensureProjectSchema(db)
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt', 'Text Bolt'],
    competitors: ['Twilio'],
    market: {
      id: 'mkt-us',
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    }
  })
  insertMarket(db, {
    id: 'mkt-mx',
    country: 'MX',
    language: 'es',
    location: 'Mexico City',
    device: 'desktop',
    localWording: true,
    serpapiLocation: null
  })
  insertPage(db, samplePage())
  addPageMarket(db, {
    pageId: 'page-1',
    marketId: 'mkt-us',
    addedAt: NOW,
    baselineRunId: null
  })
  return db
}

function samplePage(overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    id: 'page-1',
    projectId: 'proj-1',
    url: TEXTBOLT_URL,
    title: null,
    label: null,
    folder: null,
    status: 'not_tracked',
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null,
    ...overrides
  }
}

function snapshotCount(db: SqliteDatabase, pageId: string): number {
  const row = db
    .prepare<unknown[], { count: number }>(
      'SELECT COUNT(*) AS count FROM snapshots WHERE page_id = ?'
    )
    .get(pageId)
  return row?.count ?? 0
}

function track(db: SqliteDatabase): SqliteDatabase {
  databases.push(db)
  return db
}
