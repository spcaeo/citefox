import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createIpcHandlers, type IpcHandlerDeps } from '../handlers'
import type { EngineHost } from '../engine/host'
import { createLogger } from '../logging/logger'
import { contentHash } from '../pipeline/hash'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult
} from '../storage/check-records'
import { insertBuyerProfile, insertPromptSet, insertSnapshot } from '../storage/content-records'
import { addPageMarket, insertPage } from '../storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import { writeProjectProfile } from '../storage/project-profile'
import { insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import {
  ALL_DATA_FORMAT,
  ALL_DATA_MANIFEST,
  allDataFilename,
  buildAllDataZip,
  exportAllData
} from './all-data'
import { configureDataFolderReveal, openDataFolder, revealAppPath } from './data-folder'
import { configureExportSaveDialog, resetExportSaveDialog } from './ipc'
import { readStoredZip } from './zip'

const NOW = new Date('2026-10-20T12:00:00.000Z')
const RAW_MARKER = 'raw-secret-marker-9f3c'
const SECRET = 'sk-ant-planted-secret-value-1234'
/** A value main knows is secret; it may sit in a setting, so it must be masked there too. */
const KNOWN = 'planted-known-value-77'
const directories: string[] = []
const closers: Array<() => void> = []

afterEach(() => {
  resetExportSaveDialog()
  configureDataFolderReveal(null)
  for (const close of closers.splice(0)) close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Export all data', () => {
  test('the zip holds a manifest, the app settings and every project as JSON export v2', async () => {
    const storage = seededStorage(['textbolt', 'northwind'])
    const { bytes, projects } = await buildAllDataZip({
      storage,
      now: () => NOW,
      secrets: [],
      appVersion: '0.9.0',
      timeZone: 'UTC'
    })
    const entries = new Map(readStoredZip(bytes).map((entry) => [entry.name, entry.data]))
    expect([...entries.keys()].sort()).toEqual([
      ALL_DATA_MANIFEST,
      'projects/northwind.citefox.json',
      'projects/textbolt.citefox.json',
      'settings.json'
    ])
    const manifest = JSON.parse(entries.get(ALL_DATA_MANIFEST)?.toString('utf8') ?? '{}')
    expect(manifest).toMatchObject({
      format: ALL_DATA_FORMAT,
      version: 1,
      appVersion: '0.9.0',
      exportedAt: NOW.toISOString()
    })
    expect(manifest.projects).toEqual(projects)
    expect(projects.map((project) => [project.slug, project.file, project.error])).toEqual([
      ['textbolt', 'projects/textbolt.citefox.json', null],
      ['northwind', 'projects/northwind.citefox.json', null]
    ])
    const project = JSON.parse(
      entries.get('projects/textbolt.citefox.json')?.toString('utf8') ?? '{}'
    )
    expect(project.format).toBe('citefox-export')
    expect(project.schemaVersion).toBe(2)
    expect(project.project.slug).toBe('textbolt')
    expect(project.selection.scope).toBe('project')
    expect(project.markets.map((market: { id: string }) => market.id)).toEqual(['mkt-us'])
    expect(project.runs.map((run: { id: string }) => run.id)).toEqual(['run-textbolt'])
    const settings = JSON.parse(entries.get('settings.json')?.toString('utf8') ?? '{}')
    expect(settings.settings.defaultIntervalDays).toBe(storage.readSettings().defaultIntervalDays)
  })

  test('no secret reaches the zip: keychain values, known secrets and raw api keys', async () => {
    const storage = seededStorage(['textbolt'])
    storage.writeSettings({ ...storage.readSettings(), userName: KNOWN })
    const { bytes } = await buildAllDataZip({
      storage,
      now: () => NOW,
      secrets: [KNOWN],
      appVersion: '0.9.0',
      timeZone: 'UTC'
    })
    const text = readStoredZip(bytes)
      .map((entry) => entry.data.toString('utf8'))
      .join('\n')
    expect(text).not.toContain(KNOWN)
    expect(text).not.toContain(RAW_MARKER)
    expect(text).toContain('[REDACTED]')
  })

  test('a project that cannot be read is listed with why, and the others are still written', async () => {
    const storage = seededStorage(['textbolt', 'northwind'])
    writeFileSync(join(storage.paths.projectsDirectory, 'northwind.sqlite'), 'not a database')
    const { bytes, projects } = await buildAllDataZip({
      storage,
      now: () => NOW,
      secrets: [],
      appVersion: '0.9.0',
      timeZone: 'UTC'
    })
    expect(readStoredZip(bytes).map((entry) => entry.name)).toContain(
      'projects/textbolt.citefox.json'
    )
    const failed = projects.find((project) => project.slug === 'northwind')
    expect(failed?.file).toBeNull()
    expect(failed?.error).toMatch(/could not be read/i)
  })

  test('writes through the save dialog, atomically, with a dated default name', async () => {
    const storage = seededStorage(['textbolt'])
    const saveDir = tempDir()
    const asked: string[] = []
    const result = await exportAllData({
      storage,
      now: () => NOW,
      secrets: [],
      appVersion: '0.9.0',
      timeZone: 'UTC',
      dialog: async (options) => {
        asked.push(options.defaultPath)
        expect(options.filters).toEqual([{ name: 'Zip archive', extensions: ['zip'] }])
        return { canceled: false, filePath: join(saveDir, 'backup.zip') }
      }
    })
    expect(asked).toEqual([allDataFilename(NOW, 'UTC')])
    expect(allDataFilename(NOW, 'UTC')).toBe('citefox-all-data-2026-10-20.zip')
    expect(result).toMatchObject({ ok: true, filename: 'backup.zip' })
    if (!result.ok) throw new Error(result.reason)
    expect(result.filePath).toBe(join(saveDir, 'backup.zip'))
    expect(result.bytes).toBe(readFileSync(result.filePath).length)
    expect(readdirSync(saveDir)).toEqual(['backup.zip'])
  })

  test('a closed dialog writes nothing and says so', async () => {
    const storage = seededStorage(['textbolt'])
    const result = await exportAllData({
      storage,
      now: () => NOW,
      secrets: [],
      appVersion: '0.9.0',
      dialog: async () => ({ canceled: true })
    })
    expect(result).toMatchObject({ ok: false, cancelled: true })
    const none = await exportAllData({
      storage,
      now: () => NOW,
      secrets: [],
      appVersion: '0.9.0',
      dialog: null
    })
    expect(none).toMatchObject({ ok: false, cancelled: false })
  })

  test('a failed write leaves no temp file and reports a next step', async () => {
    const storage = seededStorage(['textbolt'])
    const saveDir = tempDir()
    const result = await exportAllData({
      storage,
      now: () => NOW,
      secrets: [],
      appVersion: '0.9.0',
      dialog: async () => ({ canceled: false, filePath: join(saveDir, 'backup.zip') }),
      io: {
        writeFile: async (filePath) => {
          writeFileSync(filePath, 'partial')
        },
        rename: async () => {
          throw new Error('disk full')
        },
        unlink: async (filePath) => {
          rmSync(filePath)
        }
      }
    })
    expect(result).toMatchObject({ ok: false, cancelled: false })
    expect(readdirSync(saveDir)).toEqual([])
  })
})

describe('Open data folder', () => {
  test('shows the data folder through the configured reveal', () => {
    const root = tempDir()
    const shown: string[] = []
    configureDataFolderReveal((path) => shown.push(path))
    expect(openDataFolder(root)).toEqual({ ok: true })
    expect(shown).toEqual([root])
  })

  test('says why when the folder is missing or no reveal is configured', () => {
    const root = tempDir()
    expect(openDataFolder(root)).toMatchObject({ ok: false })
    configureDataFolderReveal(() => undefined)
    expect(openDataFolder(join(root, 'missing'))).toMatchObject({ ok: false })
  })
})

describe('Reveal a path in the data folder', () => {
  test('shows a file inside the data folder, and the folder itself', () => {
    const root = tempDir()
    mkdirSync(join(root, 'projects'))
    const file = join(root, 'projects', 'textbolt.sqlite')
    writeFileSync(file, '')
    const shown: string[] = []
    configureDataFolderReveal((path) => shown.push(path))
    expect(revealAppPath(root, { path: file })).toEqual({ ok: true })
    expect(revealAppPath(root, { path: root })).toEqual({ ok: true })
    expect(shown).toHaveLength(2)
    expect(shown[0]?.endsWith(join('projects', 'textbolt.sqlite'))).toBe(true)
  })

  test('refuses paths outside it, links that lead out, relative paths and junk', () => {
    const root = tempDir()
    const outside = tempDir()
    const secret = join(outside, 'secret.txt')
    writeFileSync(secret, '')
    symlinkSync(outside, join(root, 'escape'))
    const shown: string[] = []
    configureDataFolderReveal((path) => shown.push(path))
    for (const request of [
      { path: secret },
      { path: join(root, 'escape', 'secret.txt') },
      { path: join(root, '..') },
      { path: 'projects/x.sqlite' },
      { path: '' },
      { path: 42 },
      null,
      'x'
    ]) {
      expect(revealAppPath(root, request)).toMatchObject({ ok: false })
    }
    expect(revealAppPath(root, { path: join(root, 'missing.sqlite') })).toMatchObject({
      ok: false,
      reason: 'That file is no longer where CiteFox keeps it.'
    })
    expect(shown).toEqual([])
  })
})

describe('settings IPC', () => {
  test('settings:exportAllData uses the save dialog and settings:openDataFolder the reveal', async () => {
    const { handlers, storage } = seededHandlers()
    await handlers['keys:add']({
      provider: 'serpapi',
      name: 'Personal',
      secret: SECRET,
      cap: 100,
      projectIds: []
    })
    const saveDir = tempDir()
    configureExportSaveDialog(async () => ({
      canceled: false,
      filePath: join(saveDir, 'all.zip')
    }))
    const result = await handlers['settings:exportAllData']()
    expect(result).toMatchObject({ ok: true, filename: 'all.zip' })
    expect(existsSync(join(saveDir, 'all.zip'))).toBe(true)
    const names = readStoredZip(readFileSync(join(saveDir, 'all.zip'))).map((entry) => entry.name)
    expect(names).toContain('projects/textbolt.citefox.json')
    expect(readFileSync(join(saveDir, 'all.zip')).toString('utf8')).not.toContain(SECRET)

    const shown: string[] = []
    configureDataFolderReveal((path) => shown.push(path))
    await expect(handlers['settings:openDataFolder']()).resolves.toEqual({ ok: true })
    expect(shown).toEqual([storage.paths.root])
    await expect(handlers['settings:revealPath']({ path: '/etc/hosts' })).resolves.toMatchObject({
      ok: false
    })
  })
})

function seededStorage(slugs: readonly string[]): AppStorage {
  const storage = openAppStorage(tempDir())
  closers.push(() => storage.close())
  for (const slug of slugs) seedProject(storage, slug)
  return storage
}

function seededHandlers(): {
  handlers: ReturnType<typeof createIpcHandlers>
  storage: AppStorage
} {
  const storage = seededStorage(['textbolt'])
  const registry = new SecretRegistry()
  let host: EngineHost | undefined
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '0.9.0' }),
    storage,
    secrets: new MemorySecretStore(registry),
    logger: createLogger({ write: () => undefined }),
    http: {
      async request() {
        throw new Error('no network in this test')
      }
    },
    claudeCommand: {
      async run() {
        throw new Error('claude cli')
      }
    },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    knownSecrets: () => registry.list(),
    now: () => NOW,
    onHost: (opened) => {
      host = opened
    }
  } satisfies IpcHandlerDeps)
  closers.unshift(() => host?.email.close())
  return { handlers, storage }
}

function seedProject(storage: AppStorage, slug: string): void {
  const name = slug.charAt(0).toUpperCase() + slug.slice(1)
  insertProject(storage.db, {
    id: `proj-${slug}`,
    name,
    slug,
    domain: `${slug}.com`,
    dbPath: projectDatabaseRelativePath(slug),
    clientName: null,
    status: 'active'
  })
  const db = createProjectDatabase(storage.paths.projectsDirectory, slug)
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: [name],
    competitors: [],
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
  insertPage(db, {
    id: 'page-1',
    projectId: `proj-${slug}`,
    url: `https://${slug}.com/alerts`,
    title: 'Alerts',
    label: 'Alerts',
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
  })
  addPageMarket(db, {
    pageId: 'page-1',
    marketId: 'mkt-us',
    addedAt: '2026-10-01T12:00:00.000Z',
    baselineRunId: null
  })
  const hash = contentHash(`${name} page body`)
  insertSnapshot(db, {
    id: 'snap-1',
    pageId: 'page-1',
    fetchedAt: '2026-10-01T12:00:00.000Z',
    method: 'jina',
    httpStatus: 200,
    durationMs: 4,
    title: 'Alerts',
    metaDescription: 'Alert the crew.',
    h1: 'Alerts',
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    bodyText: `${name} page body`,
    wordCount: 3,
    contentHash: hash,
    summary: null
  })
  insertBuyerProfile(db, {
    id: 'icp-1',
    pageId: 'page-1',
    snapshotId: 'snap-1',
    who: 'Office managers.',
    environment: 'They send email.',
    segments: [],
    triggers: [],
    values: [],
    poorFit: [],
    templateId: 'tpl-buyer-profile',
    templateName: 'Buyer profile',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    promptsStale: false
  })
  insertPromptSet(
    db,
    {
      id: 'pset-1',
      pageId: 'page-1',
      version: 1,
      savedAt: '2026-10-01T12:00:00.000Z',
      icpId: 'icp-1',
      templateId: 'tpl-buyer-prompts',
      templateName: 'CiteFox default',
      templateHash: contentHash('template'),
      templateUpdatedAt: null,
      prompts: [
        {
          id: 'prompt-1',
          position: 1,
          label: 'Crew',
          source: 'title_meta_h1',
          intentStage: 'problem',
          mappedElement: 'intro',
          enabled: true,
          variants: [
            {
              marketId: 'mkt-us',
              language: 'en',
              text: 'How do I alert the crew?',
              originalText: null
            }
          ]
        }
      ]
    },
    [name]
  )
  insertStoredCheckJob(db, {
    id: 'job-1',
    startedAt: '2026-10-19T15:00:00.000Z',
    status: 'running',
    pageIds: ['page-1'],
    marketIds: ['mkt-us'],
    promptIds: ['prompt-1'],
    reason: 'manual',
    message: null,
    nextStep: null
  })
  const runId = `run-${slug}`
  insertStoredRun(db, {
    id: runId,
    jobId: 'job-1',
    pageId: 'page-1',
    promptSetId: 'pset-1',
    snapshotId: 'snap-1',
    marketId: 'mkt-us',
    startedAt: '2026-10-19T15:00:00.000Z',
    kind: 'manual',
    partial: false,
    samples: 1,
    contentHash: hash
  })
  finishStoredRun(db, runId, '2026-10-19T16:00:00.000Z', 'finished')
  insertStoredSerpResult(db, {
    id: `serp-${runId}`,
    runId,
    promptId: 'prompt-1',
    sampleNo: 1,
    keyId: null,
    hasAio: true,
    neededFollowup: false,
    searches: 1,
    status: 'page_cited',
    named: true,
    citedUrl: `https://${slug}.com/alerts`,
    position: 1,
    aioText: 'Stored overview quote.',
    errorCode: null,
    message: null,
    nextStep: null,
    rawSearchJson: `{"api_key":"${RAW_MARKER}"}`,
    rawAioJson: null,
    references: []
  })
  closeProjectDatabase(db)
}

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-all-data-'))
  directories.push(directory)
  return directory
}
