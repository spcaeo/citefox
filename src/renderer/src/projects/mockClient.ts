import type { QueueState, QueueStatus } from '@shared/domain'
import type {
  CheckFinishedNotice,
  FillFromWebsiteProgress,
  PageReadProgress,
  StartUrlSuggestions
} from '@shared/ipc'
import {
  emptyCatalog,
  onboardedProfile,
  textboltCatalog,
  textboltProfile,
  type Catalog
} from '../mocks/m2/catalog'
import {
  browserActiveProjectStore,
  createProjectMemory,
  readStoredQueueState,
  type ActiveProjectStore
} from '../mocks/m2/memory'
import { createSetupStore } from '../mocks/m2/setup'
import { MOCK_CATALOG_STORAGE_KEY, MOCK_ONBOARDED_STORAGE_KEY } from '../onboarding/flags'
import { createMockOnboardingClient, type MockClientOptions } from '../onboarding/mockClient'
import type { ShellClient } from './client'

/**
 * In-memory shell client for unit tests, the Vite harness pages, and the
 * e2e build. Loaded only through a dynamic import behind `mocksAllowed()`.
 */
export interface MockShellOptions extends MockClientOptions {
  /** Sample catalog. Unset reads `citefox.mock.catalog`. */
  catalog?: Catalog
  /** Engine stand-in for the stored active project. Unset uses localStorage. */
  activeStore?: ActiveProjectStore
  queueState?: QueueState
}

export function readMockCatalog(): 'empty' | 'textbolt' {
  if (typeof localStorage === 'undefined') return 'empty'
  return localStorage.getItem(MOCK_CATALOG_STORAGE_KEY) === 'textbolt' ? 'textbolt' : 'empty'
}

/** True when `citefox.mock.onboarded` asks for a just-onboarded TextBolt project. */
export function readMockOnboarded(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(MOCK_ONBOARDED_STORAGE_KEY) === '1'
}

/** The SerpApi key the onboarded seed holds: the sample key with a 250-search budget. */
export const ONBOARDED_SERPAPI_KEY = 'citefox-sample-serpapi-b1f4'

export function createMockShellClient(options: MockShellOptions = {}): ShellClient {
  const catalog =
    options.catalog ?? (readMockCatalog() === 'textbolt' ? textboltCatalog() : emptyCatalog())
  const seeded =
    options.catalog !== undefined
      ? options.catalog.activeProjectId === 'textbolt'
      : readMockCatalog() === 'textbolt'
  const memory = createProjectMemory(catalog, {
    activeStore: options.activeStore ?? browserActiveProjectStore(),
    queueState: options.queueState ?? readStoredQueueState()
  })
  const setup = createSetupStore(memory)
  // Just onboarded: TextBolt with no pages, a working SerpApi key and Claude checked.
  const onboarded = !seeded && options.catalog === undefined && readMockOnboarded()
  if (onboarded) memory.upsertFromProfile(onboardedProfile())
  const onboarding = createMockOnboardingClient({
    ...options,
    initialFinished: seeded || onboarded || options.initialFinished,
    initialProfile: seeded
      ? textboltProfile()
      : onboarded
        ? onboardedProfile()
        : options.initialProfile,
    ...(onboarded ? { seedCheckup: true } : {})
  })
  if (onboarded) {
    // The mock answers both at once, long before the first screen asks for the keys.
    void onboarding
      .addKey({
        provider: 'serpapi',
        name: 'SerpApi',
        secret: ONBOARDED_SERPAPI_KEY,
        cap: 250,
        projectIds: []
      })
      .then((key) => onboarding.testKey({ id: key.id }))
  }
  const fillListeners = new Set<(payload: FillFromWebsiteProgress) => void>()
  const readListeners = new Set<(payload: PageReadProgress) => void>()
  const finishedListeners = new Set<(payload: CheckFinishedNotice) => void>()
  const queueListeners = new Set<(payload: QueueStatus) => void>()

  return {
    ...onboarding,
    async saveProfile(request) {
      const state = await onboarding.saveProfile(request)
      if (state.profile) memory.upsertFromProfile(state.profile)
      return state
    },
    listProjects: () => Promise.resolve(memory.list()),
    getProject: (request) => Promise.resolve(memory.get(request.projectId)),
    createProject: (request) => Promise.resolve(memory.create(request)),
    updateProject: (request) => Promise.resolve(memory.update(request)),
    switchProject: (request) => Promise.resolve(memory.switchTo(request.projectId)),
    fillFromWebsite(request) {
      const domain = request.domain.trim()
      emitFill(fillListeners, domain, 'fetch', 'running', `Reading ${domain}…`, null)
      emitFill(fillListeners, domain, 'fetch', 'ok', `Read ${domain}.`, null)
      emitFill(
        fillListeners,
        domain,
        'suggest',
        'running',
        'Suggesting brands and competitors…',
        null
      )
      const result = memory.fill(domain)
      emitFill(
        fillListeners,
        domain,
        'suggest',
        result.nextStep ? 'warning' : 'ok',
        result.message,
        result.nextStep
      )
      return Promise.resolve(result)
    },
    onFillProgress(listener) {
      fillListeners.add(listener)
      return () => {
        fillListeners.delete(listener)
      }
    },
    listPages: (request) => Promise.resolve(memory.listPages(request.projectId)),
    getPage: (request) => Promise.resolve(memory.getPage(request.projectId, request.pageId)),
    addPage: (request) => Promise.resolve(memory.addPage(request)),
    updatePage: (request) => Promise.resolve(memory.updatePage(request)),
    removePage: (request) => Promise.resolve(memory.removePage(request.projectId, request.pageId)),
    searchPages: (request) => Promise.resolve(memory.searchPages(request)),
    pinPage: (request) => Promise.resolve(memory.pin(request.projectId, request.pageId)),
    unpinPage: (request) => Promise.resolve(memory.unpin(request.projectId, request.pageId)),
    pinnedPages: (request) => Promise.resolve(memory.pinned(request.projectId)),
    trayLine: (request) => Promise.resolve(memory.tray(request.projectId)),
    getRead: (request) => Promise.resolve(setup.getRead(request)),
    readStart: (request) =>
      Promise.resolve(
        setup.readStart(request, (payload) => {
          for (const listener of readListeners) listener(payload)
        })
      ),
    onReadProgress(listener) {
      readListeners.add(listener)
      return () => {
        readListeners.delete(listener)
      }
    },
    getBuyerProfile: (request) => Promise.resolve(setup.getProfile(request)),
    generateBuyerProfile: (request) => Promise.resolve(setup.generateProfile(request)),
    updateBuyerProfile: (request) => Promise.resolve(setup.updateProfile(request)),
    listPrompts: (request) => Promise.resolve(setup.listPrompts(request)),
    generatePrompts: (request) => Promise.resolve(setup.generatePrompts(request)),
    addPrompt: (request) => Promise.resolve(setup.addPrompt(request)),
    editPrompt: (request) => Promise.resolve(setup.editPrompt(request)),
    removePrompt: (request) => Promise.resolve(setup.removePrompt(request)),
    setPromptEnabled: (request) => Promise.resolve(setup.setPromptEnabled(request)),
    reorderPrompts: (request) => Promise.resolve(setup.reorderPrompts(request)),
    savePrompts: (request) => Promise.resolve(setup.savePrompts(request)),
    discardPrompts: (request) => Promise.resolve(setup.discardPrompts(request)),
    getGaps: (request) => Promise.resolve(setup.getGaps(request)),
    generateGaps: (request) => Promise.resolve(setup.generateGaps(request)),
    setGapDone: (request) => Promise.resolve(setup.setGapDone(request)),
    redoGap: (request) => Promise.resolve(setup.redoGap(request)),
    getGapStates: (request) => Promise.resolve(setup.getGapStates(request)),
    updateGapDraft: (request) => Promise.resolve(setup.updateGapDraft(request)),
    setGapStatus: (request) => Promise.resolve(setup.setGapStatus(request)),
    listCoverage: (request) => Promise.resolve(setup.listCoverage(request)),
    getCoverage: (request) => Promise.resolve(setup.getCoverage(request)),
    listProjectScores: () => Promise.resolve(memory.listProjectScores()),
    listPageScores: (request) => Promise.resolve(memory.listPageScores(request.projectId)),
    getProjectSchedule: (request) => Promise.resolve(memory.getProjectSchedule(request.projectId)),
    getQueueStatus: () => Promise.resolve(memory.getQueueStatus()),
    checkDue() {
      const result = memory.checkDue()
      const status = memory.getQueueStatus()
      for (const listener of queueListeners) listener(status)
      return Promise.resolve(result)
    },
    suggestUrls: (request) => Promise.resolve(mockUrlSuggestions(request.query, request.limit)),
    onCheckFinished(listener) {
      finishedListeners.add(listener)
      return () => {
        finishedListeners.delete(listener)
      }
    },
    onQueueStatus(listener) {
      queueListeners.add(listener)
      return () => {
        queueListeners.delete(listener)
      }
    }
  }
}

const MOCK_SITE_PAGES: readonly [path: string, title: string, section: string][] = [
  ['/pricing/', 'Pricing', 'Top-level pages'],
  ['/compare/textbolt-vs-simpletexting/', 'TextBolt vs SimpleTexting', 'Compare'],
  ['/alternatives/simpletexting-alternatives/', 'SimpleTexting alternatives', 'Alternatives'],
  ['/use-cases/text-messaging-for-clinics/', 'Text messaging for clinics', 'Use cases'],
  ['/features/email-to-sms/', 'Email to SMS', 'Features'],
  ['/blog/how-to-set-up-text-alerts-for-business/', 'How to set up text alerts', 'Blog']
]

/** A few TextBolt sitemap pages for the Add page address box. */
function mockUrlSuggestions(query: string, limit = 8): StartUrlSuggestions {
  const needle = query
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/u, '')
  const rows = MOCK_SITE_PAGES.filter(
    ([path, title]) => path.includes(needle) || title.toLowerCase().includes(needle)
  ).map(([path, title, section]) => ({
    url: `https://textbolt.com${path}`,
    path,
    title,
    section,
    alreadyTracked: false
  }))
  return { suggestions: rows.slice(0, limit), total: rows.length }
}

function emitFill(
  listeners: ReadonlySet<(payload: FillFromWebsiteProgress) => void>,
  domain: string,
  phase: FillFromWebsiteProgress['phase'],
  state: FillFromWebsiteProgress['state'],
  detail: string,
  nextStep: string | null
): void {
  const payload: FillFromWebsiteProgress = {
    domain,
    phase,
    state,
    url: phase === 'fetch' ? `https://${domain}/` : null,
    detail,
    nextStep
  }
  for (const listener of listeners) listener(payload)
}
