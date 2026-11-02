import {
  DEFAULT_INCLUDE_SUBDOMAINS,
  DEFAULT_INTERVAL_DAYS,
  DEFAULT_MARKET_DEVICE,
  DEFAULT_PROMPT_COUNT,
  DEFAULT_SAMPLE_COUNT,
  type IntervalDays,
  type Market,
  type PageSetupStep,
  type PageSummary,
  type ProjectStatus,
  type SampleCount
} from '@shared/domain'
import type { OnboardingProfile, ProjectDetail } from '@shared/ipc'

/**
 * Sample projects and pages for the mock client and tests.
 * The TextBolt page is the reference in Docs/textbolt-reference.md.
 * Acme Clinics and FieldPro HVAC are the other projects on Mockups/Projects.dc.html.
 * Nothing here is loaded unless `localStorage['citefox.mock.catalog']` is `textbolt`.
 */

export const TEXTBOLT_FOUND = 2014
export const TEXTBOLT_WORKING = 186
export const ACME_FOUND = 380
export const ACME_WORKING = 42
export const FIELDPRO_FOUND = 95
export const FIELDPRO_WORKING = 12

export const ALERTS_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
export const ALERTS_TITLE =
  'How to Set Up Text Alerts for Business, Including Scheduled Alerts From Email (No Developer Required)'

export interface PageRecord {
  summary: PageSummary
  markets: Market[]
  /** Set when the page is pinned. Lower numbers are older pins. */
  pinOrder: number | null
  /** Latest successful read. Null before the first successful read. */
  snapshotId: string | null
}

export interface ProjectRecord {
  detail: ProjectDetail
  pages: PageRecord[]
  /** False until the tray exists (M4). */
  running: boolean
  /** Tracked pages whose next check is today. Zero until the scheduler exists. */
  pagesDueToday: number
}

export interface Catalog {
  activeProjectId: string | null
  projects: ProjectRecord[]
}

export function market(
  id: string,
  country: string,
  language: string,
  location: string | null,
  serpapiLocation: string | null = null
): Market {
  return {
    id,
    country,
    language,
    location,
    device: DEFAULT_MARKET_DEVICE,
    localWording: false,
    serpapiLocation
  }
}

const US = market('us', 'US', 'en', null)
const AUSTIN = market('austin', 'US', 'en', 'Austin', 'Austin,Texas,United States')
const UK = market('uk', 'UK', 'en', null)
const MX = market('mx', 'MX', 'es', null)

export function textboltProfile(): OnboardingProfile {
  return {
    userName: 'Rakesh',
    project: {
      id: 'textbolt',
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: 'projects/textbolt.sqlite',
      clientName: null,
      status: 'active'
    },
    includeSubdomains: DEFAULT_INCLUDE_SUBDOMAINS,
    brandNames: ['TextBolt'],
    competitors: ['twilio.com'],
    defaultMarket: { ...US }
  }
}

/**
 * The profile onboarding leaves for TextBolt: no competitors and no pages yet
 * (`citefox.mock.onboarded`). The ids match what the mock's saveProfile assigns.
 */
export function onboardedProfile(): OnboardingProfile {
  return {
    userName: 'Rakesh',
    project: {
      id: 'project-1',
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: 'projects/textbolt.sqlite',
      clientName: null,
      status: 'active'
    },
    includeSubdomains: DEFAULT_INCLUDE_SUBDOMAINS,
    brandNames: ['TextBolt'],
    competitors: [],
    switchingFrom: [],
    integrations: [],
    defaultMarket: { ...US, id: 'market-1' }
  }
}

export function emptyCatalog(): Catalog {
  return { activeProjectId: null, projects: [] }
}

export function textboltCatalog(): Catalog {
  return {
    activeProjectId: 'textbolt',
    projects: [textboltProject(), acmeProject(), fieldproProject()]
  }
}

function textboltProject(): ProjectRecord {
  const pages = textboltPages()
  return {
    detail: projectDetail({
      id: 'textbolt',
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      clientName: null,
      status: 'active',
      brandNames: ['TextBolt'],
      competitors: ['twilio.com'],
      defaultMarket: { ...US },
      pages
    }),
    pages,
    running: false,
    pagesDueToday: 0
  }
}

function acmeProject(): ProjectRecord {
  const houston = market('houston', 'US', 'en', 'Houston')
  const pages = generatedPages({
    projectId: 'acme',
    domain: 'acmeclinics.com',
    working: ACME_WORKING,
    found: ACME_FOUND,
    defaultMarket: houston,
    titlePrefix: 'Acme Clinics'
  })
  return {
    detail: projectDetail({
      id: 'acme',
      name: 'Acme Clinics',
      slug: 'acme-clinics',
      domain: 'acmeclinics.com',
      clientName: 'Acme Clinics',
      status: 'active',
      brandNames: ['Acme Clinics'],
      competitors: [],
      defaultMarket: houston,
      pages
    }),
    pages,
    running: false,
    pagesDueToday: 0
  }
}

function fieldproProject(): ProjectRecord {
  const canada = market('ca', 'CA', 'en', null)
  const pages = generatedPages({
    projectId: 'fieldpro',
    domain: 'fieldprohvac.com',
    working: FIELDPRO_WORKING,
    found: FIELDPRO_FOUND,
    defaultMarket: canada,
    titlePrefix: 'FieldPro HVAC'
  })
  return {
    detail: projectDetail({
      id: 'fieldpro',
      name: 'FieldPro HVAC',
      slug: 'fieldpro-hvac',
      domain: 'fieldprohvac.com',
      clientName: 'FieldPro HVAC',
      status: 'paused',
      brandNames: ['FieldPro HVAC'],
      competitors: [],
      defaultMarket: canada,
      pages
    }),
    pages,
    running: false,
    pagesDueToday: 0
  }
}

function projectDetail(input: {
  id: string
  name: string
  slug: string
  domain: string
  clientName: string | null
  status: ProjectStatus
  brandNames: readonly string[]
  competitors: readonly string[]
  defaultMarket: Market
  pages: readonly PageRecord[]
}): ProjectDetail {
  const working = input.pages.filter((page) => isWorking(page.summary.status)).length
  return {
    id: input.id,
    name: input.name,
    slug: input.slug,
    domain: input.domain,
    dbPath: `projects/${input.slug}.sqlite`,
    clientName: input.clientName,
    status: input.status,
    includeSubdomains: DEFAULT_INCLUDE_SUBDOMAINS,
    brandNames: [...input.brandNames],
    competitors: [...input.competitors],
    defaultMarket: { ...input.defaultMarket },
    foundPageCount: input.pages.length,
    trackedPageCount: working
  }
}

const WORKING = new Set(['setting_up', 'tracked', 'paused'])

function isWorking(status: PageSummary['status']): boolean {
  return WORKING.has(status)
}

function textboltPages(): PageRecord[] {
  const named: PageRecord[] = [
    pageRecord({
      id: 'alerts',
      projectId: 'textbolt',
      url: ALERTS_URL,
      title: ALERTS_TITLE,
      label: 'Text alerts for business',
      folder: 'blog',
      status: 'tracked',
      setupStep: null,
      score: 50,
      promptSetVersion: 2,
      markets: [US, AUSTIN, UK, MX],
      pinOrder: 1,
      snapshotId: 'snap-alerts'
    }),
    pageRecord({
      id: 'bulk',
      projectId: 'textbolt',
      url: 'https://textbolt.com/bulk-sms-pricing/',
      title: 'Bulk SMS pricing',
      label: 'Bulk SMS pricing',
      folder: null,
      status: 'tracked',
      setupStep: null,
      score: 31,
      promptSetVersion: null,
      markets: [US],
      pinOrder: 2
    }),
    pageRecord({
      id: 'optin',
      projectId: 'textbolt',
      url: 'https://textbolt.com/blog/sms-opt-in-rules/',
      title: 'SMS opt-in rules',
      label: 'SMS opt-in rules',
      folder: 'blog',
      status: 'tracked',
      setupStep: null,
      score: null,
      promptSetVersion: null,
      markets: [US],
      pinOrder: 3
    })
  ]
  const extraWorking = TEXTBOLT_WORKING - named.length
  const notTracked = TEXTBOLT_FOUND - TEXTBOLT_WORKING
  return [
    ...named,
    ...generatedPages({
      projectId: 'textbolt',
      domain: 'textbolt.com',
      working: extraWorking,
      found: extraWorking + notTracked,
      defaultMarket: US,
      titlePrefix: 'TextBolt',
      idOffset: named.length
    })
  ]
}

const FOLDERS = ['blog', 'pricing', 'compare', 'docs', 'legal'] as const

function generatedPages(input: {
  projectId: string
  domain: string
  working: number
  found: number
  defaultMarket: Market
  titlePrefix: string
  idOffset?: number
}): PageRecord[] {
  const pages: PageRecord[] = []
  const offset = input.idOffset ?? 0
  for (let index = 0; index < input.found; index += 1) {
    const sequence = offset + index + 1
    const working = index < input.working
    const folder = FOLDERS[index % FOLDERS.length] ?? 'blog'
    const status = working ? workingStatus(index) : 'not_tracked'
    const setupStep: PageSetupStep | null =
      status === 'setting_up'
        ? 'prompts'
        : status === 'tracked' || status === 'paused'
          ? null
          : null
    pages.push(
      pageRecord({
        id: `${input.projectId}-page-${sequence}`,
        projectId: input.projectId,
        url: `https://${input.domain}/${folder}/page-${sequence}/`,
        title: `${input.titlePrefix} ${folder} page ${sequence}`,
        label: null,
        folder,
        status,
        setupStep,
        score: working && index % 7 !== 0 ? (sequence * 13) % 100 : null,
        promptSetVersion: status === 'tracked' ? 1 : null,
        markets: working ? [{ ...input.defaultMarket }] : [],
        pinOrder: null
      })
    )
  }
  return pages
}

function workingStatus(index: number): PageSummary['status'] {
  if (index % 11 === 0) return 'setting_up'
  if (index % 13 === 0) return 'paused'
  return 'tracked'
}

function pageRecord(input: {
  id: string
  projectId: string
  url: string
  title: string
  label: string | null
  folder: string | null
  status: PageSummary['status']
  setupStep: PageSetupStep | null
  score: number | null
  promptSetVersion: number | null
  markets: readonly Market[]
  pinOrder: number | null
  intervalDays?: IntervalDays
  samples?: SampleCount
  snapshotId?: string | null
}): PageRecord {
  const markets = input.markets.map((item) => ({ ...item }))
  return {
    pinOrder: input.pinOrder,
    snapshotId: input.snapshotId ?? null,
    markets,
    summary: {
      id: input.id,
      projectId: input.projectId,
      url: input.url,
      title: input.title,
      label: input.label,
      folder: input.folder,
      status: input.status,
      setupStep: input.setupStep,
      intervalDays: input.intervalDays ?? DEFAULT_INTERVAL_DAYS,
      samples: input.samples ?? DEFAULT_SAMPLE_COUNT,
      promptCount: DEFAULT_PROMPT_COUNT,
      defaultMarketId: markets[0]?.id ?? null,
      pinned: input.pinOrder !== null,
      score: input.score,
      promptSetVersion: input.promptSetVersion
    }
  }
}
