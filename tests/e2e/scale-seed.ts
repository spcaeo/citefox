import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BuyerPrompt, Market, PageStatus, PageSummary } from '@shared/domain'
import { createIpcHandlers, type IpcHandlerDeps } from '../../src/main/handlers'
import type { EngineHost } from '../../src/main/engine/host'
import { contentHash } from '../../src/main/pipeline/hash'
import type { HttpResponse } from '../../src/main/providers/http'
import { MemorySecretStore } from '../../src/main/secrets/secret-store'
import { createLogger } from '../../src/main/logging/logger'
import { openAppStorage } from '../../src/main/storage/app-storage'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot
} from '../../src/main/storage/content-records'
import { addPageMarket, insertPage } from '../../src/main/storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../../src/main/storage/project-files'
import { writeProjectProfile } from '../../src/main/storage/project-profile'
import {
  insertApiKey,
  insertProject,
  writeActiveProjectId,
  writeOnboardingFinished
} from '../../src/main/storage/records'
import { projectDatabaseRelativePath } from '../../src/main/storage/slug'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
const AT = '2026-10-19T12:00:00.000Z'
export const SCALE = {
  projectId: 'proj-scale',
  total: 2014,
  tracked: 186,
  /** Tracked pages with a saved prompt set that the seed checks for real. */
  checked: 40,
  paused: 6,
  alertsUrl: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
  alertsTitle: 'Text alerts for business'
} as const

const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

/** TextBolt's sitemap shape: /blog/ is most of it (Mockups/DataGrid.dc.html). */
const FOLDERS: readonly [string, number][] = [
  ['blog', 1420],
  ['features', 96],
  ['industries', 210],
  ['compare', 48],
  ['', 240]
]

/**
 * A TextBolt-sized project: 2,014 pages found, 186 tracked. The first 40
 * tracked pages are read, profiled and given two prompts, then checked once
 * through the real IPC handlers against the recorded SerpApi bodies. Prompt 1
 * cites the alerts page (the target for page 0, another own page for the
 * rest); prompt 2 alternates between /pricing/ and a competitor.
 */
export async function seedScaleProject(userDataDir: string): Promise<{ seedMs: number }> {
  const started = Date.now()
  const storage = openAppStorage(userDataDir)
  const projectDb = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  let host: EngineHost | undefined
  try {
    insertProject(storage.db, {
      id: SCALE.projectId,
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    })
    writeProjectProfile(projectDb, {
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: ['simpletexting.com', 'twilio.com'],
      market: US
    })
    const pages = scalePages()
    projectDb.transaction(() => {
      for (const page of pages) {
        insertPage(projectDb, page)
        if (page.status !== 'not_tracked') {
          addPageMarket(projectDb, {
            pageId: page.id,
            marketId: US.id,
            addedAt: AT,
            baselineRunId: null
          })
        }
      }
      for (const page of pages.slice(0, SCALE.checked)) seedSetup(projectDb, page)
    })()
    insertApiKey(storage.db, {
      id: 'key-1',
      provider: 'serpapi',
      name: 'My plan',
      keychainRef: 'citefox.serpapi.scale-key-1',
      hint: 'ab12',
      rotationOrder: 1,
      cap: null,
      on: true,
      projectIds: [],
      state: 'ok',
      lastReason: null,
      serpapiUsage: { used: 1240, planLimit: 5000, plan: 'Developer' }
    })
    const secret = 'fixture-serpapi-secret-scale'
    const secrets = new MemorySecretStore()
    secrets.set('citefox.serpapi.scale-key-1', secret)
    let sequence = 0
    let clock = Date.parse(AT)
    const handlers = createIpcHandlers({
      appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
      storage,
      secrets,
      logger: createLogger({ write: () => undefined, secrets: () => [secret] }),
      http: {
        async request(request) {
          const url = new URL(request.url)
          if (url.searchParams.get('engine') === 'google') {
            return tokenEnvelope(url.searchParams.get('q') ?? '')
          }
          const token = url.searchParams.get('page_token') ?? ''
          if (token.includes('alert the team')) return envelope('google-ai-overview.json')
          return envelope(
            token.length % 2 === 0 ? 'google-own-page.json' : 'google-competitor.json'
          )
        }
      },
      claudeCommand: {
        async run() {
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false, spawnError: null }
        }
      },
      claudeProbe: { exists: () => false, searchPath: () => null },
      emitCheckupProgress: () => undefined,
      emit: () => undefined,
      knownSecrets: () => [secret],
      now: () => new Date(clock),
      createId: () => {
        sequence += 1
        clock += 50
        return `scale-${sequence}`
      },
      onHost: (opened) => {
        host = opened
      }
    } satisfies IpcHandlerDeps)
    const ids = pages.slice(0, SCALE.checked).map((page) => page.id)
    const [first, ...rest] = ids
    if (first === undefined) throw new Error('No page to check')
    const job = await handlers['checks:start']({
      projectId: SCALE.projectId,
      pageIds: [first, ...rest],
      marketIds: null,
      promptIds: null
    })
    if (job.status !== 'finished') throw new Error(job.message ?? `Seed check ended ${job.status}`)
    writeOnboardingFinished(storage.db, true)
    writeActiveProjectId(storage.db, SCALE.projectId)
  } finally {
    host?.email.close()
    closeProjectDatabase(projectDb)
    storage.close()
  }
  return { seedMs: Date.now() - started }
}

function scalePages(): PageSummary[] {
  const pages: PageSummary[] = []
  let index = 0
  for (const [folder, count] of FOLDERS) {
    for (let n = 0; n < count; n += 1) {
      const slug =
        index === 0 ? 'how-to-set-up-text-alerts-for-business' : `${folder || 'page'}-${n}`
      const url =
        index === 0
          ? SCALE.alertsUrl
          : folder === ''
            ? `https://textbolt.com/${slug}/`
            : `https://textbolt.com/${folder}/${slug}/`
      const status: PageStatus =
        index < SCALE.checked
          ? 'tracked'
          : index < SCALE.tracked - SCALE.paused
            ? 'setting_up'
            : index < SCALE.tracked
              ? 'paused'
              : 'not_tracked'
      pages.push({
        id: `page-${index}`,
        projectId: SCALE.projectId,
        url,
        title: index === 0 ? SCALE.alertsTitle : titleFor(folder, n),
        label: null,
        folder: folder === '' ? null : folder,
        status,
        setupStep: null,
        intervalDays: index % 3 === 0 ? 30 : 14,
        samples: 1,
        promptCount: 2,
        defaultMarketId: status === 'not_tracked' ? null : US.id,
        pinned: index === 0,
        score: null,
        promptSetVersion: null
      })
      index += 1
    }
  }
  return pages
}

function titleFor(folder: string, n: number): string {
  const topics = ['SMS pricing', 'Text alerts', 'Two-way texting', '10DLC', 'Reminders', 'Opt-in']
  const topic = topics[n % topics.length] ?? 'SMS'
  return `${topic} ${folder || 'page'} ${n}`
}

function seedSetup(db: ReturnType<typeof createProjectDatabase>, page: PageSummary): void {
  const body = `${page.title ?? page.url} body text for the TextBolt scale seed.`
  insertSnapshot(db, {
    id: `snap-${page.id}`,
    pageId: page.id,
    fetchedAt: AT,
    method: 'jina',
    httpStatus: 200,
    durationMs: 4,
    title: page.title,
    metaDescription: null,
    h1: page.title,
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    bodyText: body,
    wordCount: 10,
    contentHash: contentHash(body),
    summary: null
  })
  insertBuyerProfile(db, {
    id: `icp-${page.id}`,
    pageId: page.id,
    snapshotId: `snap-${page.id}`,
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
    createdAt: AT,
    promptsStale: false
  })
  insertPromptSet(
    db,
    {
      id: `pset-${page.id}`,
      pageId: page.id,
      version: 1,
      savedAt: AT,
      icpId: `icp-${page.id}`,
      templateId: 'tpl-buyer-prompts',
      templateName: 'CiteFox default',
      templateHash: contentHash('template'),
      templateUpdatedAt: null,
      prompts: [
        prompt(`${page.id}-p1`, 1, 'Team alerts', `How do I alert the team about ${page.id}?`),
        prompt(`${page.id}-p2`, 2, 'Plan', `Which plan fits ${page.title ?? page.id}?`)
      ]
    },
    ['TextBolt']
  )
}

function prompt(id: string, position: number, label: string, text: string): BuyerPrompt {
  return {
    id,
    position,
    label,
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants: [{ marketId: US.id, language: 'en', text, originalText: null }]
  }
}

function envelope(name: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

function tokenEnvelope(token: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, 'google-page-token.json'), 'utf8')) as {
    status: number
    body: { ai_overview: { page_token: string } }
  }
  parsed.body.ai_overview.page_token = token
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}
