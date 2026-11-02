import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createLogger } from '../logging/logger'
import { resetSharedReadPoolForTests } from '../pipeline/read-pool'
import type { HttpRequest, HttpResponse, HttpTransport } from '../providers/http'
import type { SqliteDatabase } from '../storage/database'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import { insertSitemap, listSitemaps } from '../storage/sitemap-records'
import { crawlSitemaps } from './crawl'
import { fixtureDns } from './fixture-transport'

/**
 * Owner, 2026-10-29: a sitemap index's child files were fetched one after another.
 * They are now fetched a few at a time (two per site) and handled in queue order.
 */

const NOW = '2026-10-29T12:00:00.000Z'
const INDEX = 'https://textbolt.com/sitemap_index.xml'
const CHILDREN = [1, 2, 3, 4, 5].map((n) => `https://textbolt.com/sitemap-${n}.xml`)

const directories: string[] = []
const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeProjectDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  resetSharedReadPoolForTests()
})

function indexXml(): string {
  const items = CHILDREN.map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join('')
  return `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</sitemapindex>`
}

function urlsetXml(n: number): string {
  const urls = [1, 2]
    .map((page) => `<url><loc>https://textbolt.com/page-${n}-${page}/</loc></url>`)
    .join('')
  return `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`
}

/** Answers after a short wait and counts the requests in flight. */
function slowTransport(failing: ReadonlySet<string> = new Set()): HttpTransport & {
  most: () => number
  requests: string[]
} {
  let inFlight = 0
  let most = 0
  const requests: string[] = []
  return {
    requests,
    most: () => most,
    async request(request: HttpRequest): Promise<HttpResponse> {
      requests.push(request.url)
      inFlight += 1
      most = Math.max(most, inFlight)
      try {
        await new Promise((resolve) => setTimeout(resolve, 5))
        if (failing.has(request.url)) return { status: 404, body: 'Not found' }
        if (request.url === INDEX) return xml(indexXml())
        const n = CHILDREN.indexOf(request.url) + 1
        return n > 0 ? xml(urlsetXml(n)) : { status: 404, body: 'Not found' }
      } finally {
        inFlight -= 1
      }
    }
  }
}

function xml(body: string): HttpResponse {
  return { status: 200, body, headers: { 'content-type': 'application/xml' } }
}

function setup(): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-crawl-'))
  directories.push(directory)
  const db = createProjectDatabase(directory, 'textbolt')
  databases.push(db)
  insertSitemap(db, {
    id: 'sitemap-index',
    url: INDEX,
    parentId: null,
    source: 'robots',
    included: true,
    createdAt: NOW
  })
  return db
}

function crawl(db: SqliteDatabase, http: HttpTransport): ReturnType<typeof crawlSitemaps> {
  let sequence = 0
  return crawlSitemaps({
    db,
    fetch: {
      http,
      dns: fixtureDns,
      logger: createLogger({ write: () => undefined }),
      secrets: () => [],
      sleep: async () => undefined
    },
    domain: 'textbolt.com',
    includeSubdomains: false,
    now: NOW,
    createId: () => {
      sequence += 1
      return `child-${sequence}`
    }
  })
}

describe('crawlSitemaps', () => {
  test('fetches child sitemaps two at a time on the site and keeps every page', async () => {
    const db = setup()
    const http = slowTransport()
    const result = await crawl(db, http)
    expect(http.most()).toBe(2)
    expect(http.requests[0]).toBe(INDEX)
    expect([...http.requests.slice(1)].sort()).toEqual([...CHILDREN].sort())
    expect(result.readCount).toBe(6)
    expect(result.problems).toEqual([])
    expect([...result.seen.keys()]).toEqual(
      [1, 2, 3, 4, 5].flatMap((n) => [1, 2].map((p) => `https://textbolt.com/page-${n}-${p}/`))
    )
  })

  test('a child that fails is reported alone; the others are read', async () => {
    const db = setup()
    const failing = CHILDREN[2] ?? ''
    const result = await crawl(db, slowTransport(new Set([failing])))
    expect(result.readCount).toBe(5)
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toContain('sitemap-3.xml')
    const failedChild = listSitemaps(db).find((sitemap) => sitemap.url === failing)
    expect(failedChild !== undefined && result.failedIds.has(failedChild.id)).toBe(true)
    expect(result.seen.size).toBe(8)
  })
})
