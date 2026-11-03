import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { EngineHost } from '../engine/host'
import { createLogger } from '../logging/logger'
import { resetSharedReadPoolForTests } from '../pipeline/read-pool'
import type { HttpTransport } from '../providers/http'
import { openAppDatabase } from '../storage/app-database'
import type { SqliteDatabase } from '../storage/database'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import { insertProject } from '../storage/records'
import { insertSitemap } from '../storage/sitemap-records'
import { crawlSitemaps } from './crawl'
import { dueSyncProjects } from './due-sync'
import { fetchSitemapText } from './fetch'
import { fixtureDns } from './fixture-transport'

const NOW = '2026-11-03T12:00:00.000Z'
const directories: string[] = []
const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeProjectDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  resetSharedReadPoolForTests()
})

function capture(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = []
  return { lines, logger: createLogger({ write: (_level, line) => lines.push(line) }) }
}

function transport(status: number, body: string): HttpTransport {
  return { request: async () => ({ status, body, headers: {} }) }
}

describe('sitemap failures leave one line with a short reason', () => {
  test('a server that answers with an error is logged with the status only', async () => {
    const { logger, lines } = capture()
    const result = await fetchSitemapText(
      { http: transport(503, 'secret-body-text'), dns: fixtureDns, logger, secrets: () => [] },
      'https://textbolt.com/sitemap.xml',
      'sitemap'
    )
    expect(result.ok).toBe(false)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('sitemap read did not finish')
    expect(lines[0]).toContain('"status":503')
    expect(lines[0]).not.toContain('secret-body-text')
  })

  test('a private address is logged as refused', async () => {
    const { logger, lines } = capture()
    const result = await fetchSitemapText(
      {
        http: transport(200, ''),
        dns: { lookup: async () => ['10.0.0.5'] },
        logger,
        secrets: () => []
      },
      'https://internal.example/sitemap.xml',
      'sitemap'
    )
    expect(result.ok).toBe(false)
    expect(lines[0]).toContain('sitemap fetch refused a private address')
  })

  test('a file that is not a sitemap is logged', async () => {
    const { logger, lines } = capture()
    const directory = mkdtempSync(join(tmpdir(), 'citefox-crawl-log-'))
    directories.push(directory)
    const db = createProjectDatabase(directory, 'textbolt')
    databases.push(db)
    insertSitemap(db, {
      id: 'sitemap-1',
      url: 'https://textbolt.com/sitemap.xml',
      parentId: null,
      source: 'robots',
      included: true,
      createdAt: NOW
    })
    const result = await crawlSitemaps({
      db,
      fetch: {
        http: transport(200, '<html>private page text</html>'),
        dns: fixtureDns,
        logger,
        secrets: () => [],
        sleep: async () => undefined
      },
      domain: 'textbolt.com',
      includeSubdomains: false,
      now: NOW,
      createId: () => 'child'
    })
    expect(result.problems).toHaveLength(1)
    const line = lines.find((entry) => entry.includes('not a readable sitemap'))
    expect(line).toContain('"reason":"parse"')
    expect(lines.join('\n')).not.toContain('private page text')
  })
})

describe('the scheduled sitemap sync', () => {
  test('logs a project whose file cannot be opened, with its id and no path', () => {
    const { logger, lines } = capture()
    const appDb = openAppDatabase(':memory:')
    databases.push(appDb)
    const directory = mkdtempSync(join(tmpdir(), 'citefox-due-log-'))
    directories.push(directory)
    insertProject(appDb, {
      id: 'project-gone',
      name: 'Gone',
      slug: 'gone',
      domain: 'gone.example',
      dbPath: 'projects/gone.sqlite',
      clientName: null,
      status: 'active'
    })
    const host = {
      logger,
      storage: { db: appDb, paths: { projectsDirectory: directory } }
    } as unknown as EngineHost
    expect(dueSyncProjects(host, new Date(NOW))).toEqual([])
    expect(lines[0]).toContain('could not be opened for the sitemap schedule')
    expect(lines[0]).toContain('"projectId":"project-gone"')
    expect(lines[0]).not.toContain(directory)
  })
})
