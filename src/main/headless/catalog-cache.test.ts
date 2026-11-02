import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PageSummary } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import { addPageMarket, insertPage, setPageMarketLastCheckedAt } from '../storage/pages'
import { insertMarket } from '../storage/project-profile'
import {
  closeProjectDatabase,
  createProjectDatabase,
  openProjectDatabase
} from '../storage/project-files'
import { projectDatabasePool } from '../storage/project-db-pool'
import { writeProjectSchedule } from '../storage/project-schedule'
import { insertProject } from '../storage/records'
import { writeAppSchedule, defaultAppSchedule } from '../storage/settings'
import { projectDatabaseRelativePath } from '../storage/slug'
import { checkCatalogCache } from './catalog-cache'
import { readStoredCheckCatalog } from './storage-pass'

const dirs: string[] = []
const opened: AppStorage[] = []

afterEach(() => {
  for (const storage of opened.splice(0)) storage.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('cached check catalog', () => {
  test('repeated status reads do not reopen project files when nothing changed', () => {
    const storage = seed(['alpha', 'beta'], 3)
    const cache = checkCatalogCache(storage)
    const first = cache.read()
    for (let index = 0; index < 10; index += 1) cache.read()
    expect(cache.stats().builds).toBe(1)
    expect(projectDatabasePool(storage).stats().opens).toBe(2)
    expect(first.catalog.pages).toHaveLength(6)
    expect(first.catalog.pages[0]?.markets).toEqual([
      { marketId: 'mkt-us', lastCheckedAt: null, firstCheckNotBefore: null },
      { marketId: 'mkt-uk', lastCheckedAt: null, firstCheckNotBefore: null }
    ])
  })

  test('a write through another connection is seen on the next read', () => {
    const storage = seed(['alpha'], 1)
    const cache = checkCatalogCache(storage)
    cache.read()
    const other = openProjectDatabase(storage.paths.projectsDirectory, 'alpha')
    setPageMarketLastCheckedAt(other, 'alpha-page-0', 'mkt-us', '2026-04-20T12:00:00.000Z')
    closeProjectDatabase(other)
    const after = cache.read()
    expect(after.catalog.pages[0]?.markets[0]?.lastCheckedAt).toBe('2026-04-20T12:00:00.000Z')
    expect(cache.stats().builds).toBe(2)
  })

  test('a new project, a schedule write, and a settings change are each seen', () => {
    const storage = seed(['alpha'], 1)
    const cache = checkCatalogCache(storage)
    expect(cache.read().catalog.projects).toHaveLength(1)
    addProject(storage, 'beta', 1)
    expect(cache.read().catalog.projects.map((project) => project.projectId)).toEqual([
      'proj-alpha',
      'proj-beta'
    ])
    const db = projectDatabasePool(storage).get('beta')
    const current = cache.read().catalog.projects[1]
    if (current === undefined) throw new Error('missing project')
    writeProjectSchedule(db, { ...current, paused: true })
    expect(cache.read().catalog.projects[1]?.paused).toBe(true)
    writeAppSchedule(storage.paths.settingsFile, {
      ...defaultAppSchedule(),
      dailyCheckTime: '06:45'
    })
    expect(cache.read().catalog.app.dailyCheckTime).toBe('06:45')
  })

  test('readStoredCheckCatalog returns the same facts as a fresh read', () => {
    const storage = seed(['alpha', 'beta'], 2)
    const cached = readStoredCheckCatalog(storage)
    const fresh = openAppStorage(storage.paths.root)
    opened.push(fresh)
    expect(readStoredCheckCatalog(fresh)).toEqual(cached)
  })

  test('closing storage closes the pooled project files', () => {
    const storage = seed(['alpha'], 1)
    checkCatalogCache(storage).read()
    const db = projectDatabasePool(storage).get('alpha')
    storage.close()
    opened.splice(opened.indexOf(storage), 1)
    expect(db.open).toBe(false)
  })
})

function seed(slugs: readonly string[], pages: number): AppStorage {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-catalog-cache-'))
  dirs.push(dir)
  const storage = openAppStorage(dir)
  opened.push(storage)
  for (const slug of slugs) addProject(storage, slug, pages)
  return storage
}

function addProject(storage: AppStorage, slug: string, pages: number): void {
  insertProject(storage.db, {
    id: `proj-${slug}`,
    name: slug,
    slug,
    domain: `${slug}.example`,
    dbPath: projectDatabaseRelativePath(slug),
    clientName: null,
    status: 'active'
  })
  const db = createProjectDatabase(storage.paths.projectsDirectory, slug)
  for (const market of ['mkt-us', 'mkt-uk']) {
    insertMarket(db, {
      id: market,
      country: market === 'mkt-us' ? 'US' : 'GB',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    })
  }
  for (let index = 0; index < pages; index += 1) {
    const pageId = `${slug}-page-${index}`
    insertPage(db, page(slug, pageId))
    for (const market of ['mkt-us', 'mkt-uk']) {
      addPageMarket(db, {
        pageId,
        marketId: market,
        addedAt: `2026-04-01T08:0${market === 'mkt-us' ? 0 : 1}:00.000Z`,
        baselineRunId: null
      })
    }
  }
  closeProjectDatabase(db)
}

function page(slug: string, id: string): PageSummary {
  return {
    id,
    projectId: `proj-${slug}`,
    url: `https://${slug}.example/${id}`,
    title: id,
    label: id,
    folder: null,
    status: 'tracked',
    setupStep: 'check',
    intervalDays: 14,
    samples: 1,
    promptCount: 1,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}
