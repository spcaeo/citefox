import type { TopicDraft, TopicStage } from '@shared/domain'
import type { DiscoverSeedResult, FillFromWebsiteResult } from '@shared/ipc'
import { catalogFromFill } from '../engine/products'
import type { Logger } from '../logging/logger'
import type { HttpTransport } from '../providers/http'
import type { AppStorage } from '../storage'
import { closeProjectDatabase, openProjectDatabase } from '../storage'
import { readProductCatalog, replaceProductCatalog } from '../storage/products'
import { readProjectProfile } from '../storage/project-profile'
import { discoverSitemaps } from '../structure/crawl'
import { runSitemapSync } from '../structure/sync'
import { KEY_PAGE_PATHS } from '../topics/site'
import type { StageRun } from '../topics/steps-journey'
import { namesBrand } from './topic-args'

/**
 * Topic smoke helpers for the profile and journey package (Docs/PROMPT-AUDIT.md, P3):
 * a real sitemap read (so the topic's own pages can be evidence, as in a project with
 * Site structure synced), the discovered competitors applied the way a user adds them,
 * and the pass checks printed after the questions step.
 */

/** Reads the site's sitemaps into the temp project, as Site structure does. Never a search. */
export async function syncSmokeSitemap(input: {
  storage: AppStorage
  slug: string
  projectId: string
  domain: string
  http: HttpTransport
  logger: Logger
  secrets: readonly string[]
  now: () => Date
  createId: () => string
}): Promise<{ pages: number; problems: string[] }> {
  const db = openProjectDatabase(input.storage.paths.projectsDirectory, input.slug)
  try {
    const at = input.now().toISOString()
    const ctx = {
      db,
      fetch: { http: input.http, logger: input.logger, secrets: () => input.secrets },
      domain: input.domain,
      includeSubdomains: false,
      now: at,
      createId: input.createId
    }
    const found = await discoverSitemaps(ctx)
    const outcome = await runSitemapSync({
      ...ctx,
      projectId: input.projectId,
      trigger: 'manual',
      reportId: `sync-${input.createId()}`,
      startedAt: at
    })
    return {
      pages: outcome.report.pageCount,
      problems: [...(found.problem === null ? [] : [found.problem]), ...outcome.report.problems]
    }
  } finally {
    closeProjectDatabase(db)
  }
}

/** The competitors saved by {@link applyDiscoveredCompetitors}, by tier. */
export interface SavedCompetitors {
  direct: string[]
  partial: string[]
  products: string[]
}

/**
 * The discovered products and competitors saved on the project the way onboarding
 * Finish saves a Fill read (PC: `catalogFromFill`, then `replaceProductCatalog`), so
 * each competitor keeps its product and its direct or partial tier.
 */
export function applyDiscoveredCompetitors(
  storage: AppStorage,
  slug: string,
  discovered: Pick<DiscoverSeedResult, 'competitors' | 'products'>,
  brands: readonly string[]
): SavedCompetitors {
  const db = openProjectDatabase(storage.paths.projectsDirectory, slug)
  try {
    const profile = readProjectProfile(db)
    if (profile === null) return { direct: [], partial: [], products: [] }
    const names = discovered.competitors
      .map((item) => item.name.trim())
      .filter((name) => name.length > 0 && !namesBrand(name, brands))
    const seen = new Set<string>()
    const kept = [...names, ...profile.competitors].filter((name) => {
      const key = name.toLowerCase().replace(/\.[a-z]{2,}$/u, '')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    // The topic's competitor search returns Fill's suggestion shape (product and tier).
    const fill = {
      products: discovered.products ?? [],
      competitors: discovered.competitors
    } as unknown as Pick<FillFromWebsiteResult, 'products' | 'competitors'>
    const catalog = replaceProductCatalog(db, catalogFromFill(fill, kept, readProductCatalog(db)))
    const tier = (wanted: 'direct' | 'partial'): string[] => [
      ...new Set(catalog.competitors.filter((row) => row.tier === wanted).map((row) => row.name))
    ]
    return {
      direct: tier('direct'),
      partial: tier('partial'),
      products: catalog.products.map((product) => product.name)
    }
  } finally {
    closeProjectDatabase(db)
  }
}

/** Paths of the key pages Discover always reads (`/`, `/pricing`, …). */
export function keyPaths(): Set<string> {
  return new Set(['/', ...KEY_PAGE_PATHS.map((page) => page.path)].map(trimPath))
}

function trimPath(path: string): string {
  return path.replace(/\/+$/u, '') || '/'
}

/** foundIn paths of the profile and how many are outside the fixed key pages. */
export function profileSources(draft: TopicDraft): { paths: string[]; outside: string[] } {
  const version = draft.profile?.versions.find((item) => item.version === draft.profile?.current)
  const paths = [
    ...new Set(
      (version?.points ?? [])
        .map((point) => point.foundIn)
        .filter((value): value is string => value !== null && value.startsWith('/'))
    )
  ]
  const fixed = keyPaths()
  return { paths, outside: paths.filter((path) => !fixed.has(trimPath(path))) }
}

/**
 * One line per stage: "questions/compare ok 9120ms asked=2 kept=2", then why any
 * question was dropped, per reply ("dropped=long:1 | -" when the retry was clean).
 */
export function stageLines(runs: readonly StageRun[]): string[] {
  const drops = (run: StageRun): string => {
    const parts = run.dropped.map(
      (counts) =>
        Object.entries(counts)
          .filter(([, count]) => count > 0)
          .map(([reason, count]) => `${reason}:${count}`)
          .join(',') || '-'
    )
    return parts.some((part) => part !== '-') ? ` dropped=${parts.join(' | ')}` : ''
  }
  return runs.map(
    (run) =>
      `questions/${run.stage} ${run.error === null ? 'ok' : 'fail'} ${run.durationMs}ms asked=${run.asked} kept=${run.kept.length}${drops(run)}${run.error === null ? '' : ` error=${run.error.slice(0, 120)}`}`
  )
}

/** Words that mark a carrier email-to-text gateway (vtext.com, "AT&T gateway" …). */
const GATEWAY =
  /\b(?:vtext|txt\.att|tmomail|messaging\.sprintpcs|carrier(?:'s)? (?:email[- ]to[- ](?:text|sms) )?gateway|email[- ]to[- ](?:text|sms) gateway)\b/iu
/** Sending software the smoke counts across the 15 questions (at most 3 each). */
const SENDING_SOFTWARE = [
  'XProtect',
  'Nagios',
  'Zabbix',
  'PRTG',
  'WIN-911',
  'Niagara',
  'Honeywell',
  'Outlook',
  'Gmail',
  'Datadog',
  'Azure Monitor',
  'PagerDuty'
]

/** Words that offer an option: "between X and Y", "X or Y", "keep using X", "versus". */
const OFFERS =
  /\b(?:between|versus|vs\.?|instead of sticking|keep(?:ing)? (?:using|the)|stick with|or (?:switch|move|pay))\b/iu

/**
 * The pass checks the P3 live smoke prints: exact counts per stage, compare and
 * decide name only listed competitors, and no question offers a carrier gateway as
 * an option. Each returns a line starting "check".
 */
export function journeyChecks(input: {
  questions: readonly { stage: TopicStage | null; text: string }[]
  perStage: Readonly<Record<TopicStage, number>>
  competitors: SavedCompetitors
}): string[] {
  const lines: string[] = []
  const counts = new Map<string, number>()
  for (const question of input.questions) {
    const key = question.stage ?? 'none'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const wrong = (Object.entries(input.perStage) as [TopicStage, number][]).filter(
    ([stage, n]) => (counts.get(stage) ?? 0) !== n
  )
  lines.push(
    wrong.length === 0
      ? 'check counts ok: every stage has exactly the depth asked'
      : `check counts MISMATCH: ${wrong.map(([stage, n]) => `${stage} ${counts.get(stage) ?? 0}/${n}`).join(', ')}`
  )
  const compare = input.questions.filter((q) => q.stage === 'compare' || q.stage === 'decide')
  const direct = compare.filter((q) => namesBrand(q.text, input.competitors.direct))
  const partial = compare.filter(
    (q) => !direct.includes(q) && namesBrand(q.text, input.competitors.partial)
  )
  lines.push(
    `check compare/decide: ${direct.length} of ${compare.length} name a direct rival, ${partial.length} only a partial one (direct: ${input.competitors.direct.slice(0, 8).join(', ') || 'none'})`
  )
  const software = new Map<string, number>()
  for (const question of input.questions) {
    for (const name of SENDING_SOFTWARE) {
      if (new RegExp(`\\b${name}\\b`, 'iu').test(question.text)) {
        software.set(name, (software.get(name) ?? 0) + 1)
      }
    }
  }
  const crowded = [...software.entries()].filter(([, n]) => n > 3)
  lines.push(
    crowded.length === 0
      ? `check software ok: none named in more than 3 questions (${[...software.entries()].map(([name, n]) => `${name}=${n}`).join(' ') || 'none seen'})`
      : `check software OVER: ${crowded.map(([name, n]) => `${name}=${n}`).join(' ')}`
  )
  const offered = input.questions.filter((q) => GATEWAY.test(q.text) && OFFERS.test(q.text))
  lines.push(
    offered.length === 0
      ? 'check gateways ok: no question offers a carrier gateway as an option'
      : `check gateways REVIEW ${offered.length}: ${offered.map((q) => q.text).join(' | ')}`
  )
  return lines
}
