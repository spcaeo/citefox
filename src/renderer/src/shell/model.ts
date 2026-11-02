import {
  intervalLabel,
  type ApiKeyMetadata,
  type ConnectionState,
  type IntervalDays,
  type Market,
  type ProjectStatus,
  type ProjectSummary,
  type SampleCount
} from '@shared/domain'
import type { StatusCapsule } from '@shared/ipc'
import { readinessText, type Readiness } from '@shared/permissions/readiness'
import { pluralize } from '@shared/pluralize'
import { PAGE_TABS, type PageTabId } from './routes'

/** Moves within the page tablist. Arrow keys wrap. Home and End jump. */
export function nextTabIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null
  if (key === 'ArrowRight') return (current + 1) % count
  if (key === 'ArrowLeft') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

export function tabIndexFor(id: PageTabId): number {
  const index = PAGE_TABS.findIndex((tab) => tab.id === id)
  return index < 0 ? 0 : index
}

export function projectMenuLabel(project: Pick<ProjectSummary, 'name' | 'clientName'>): string {
  return project.clientName ? `${project.name} (client)` : project.name
}

/**
 * FR-10.7 second line of a switcher item: domain, the client's name for a client
 * project, and the status, such as `acme.example · Client: Acme Inc. · Active`.
 */
export function projectMenuDetail(
  project: Pick<ProjectSummary, 'domain' | 'clientName' | 'status'>
): string {
  const parts = [project.domain]
  if (project.clientName) parts.push(`Client: ${project.clientName}`)
  parts.push(projectStatusLabel(project.status))
  return parts.join(' · ')
}

export function projectStatusLabel(status: ProjectStatus): 'Active' | 'Paused' | 'Archived' {
  if (status === 'active') return 'Active'
  if (status === 'paused') return 'Paused'
  return 'Archived'
}

export function filterProjects<T extends Pick<ProjectSummary, 'name' | 'domain' | 'clientName'>>(
  projects: readonly T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...projects]
  return projects.filter((project) => {
    const fields = [
      project.name,
      project.domain,
      project.clientName ?? '',
      projectMenuLabel(project)
    ]
    return fields.some((field) => field.toLowerCase().includes(needle))
  })
}

export const EMPTY_SCORE = '—'

export function formatScore(score: number | null): string {
  return score === null ? EMPTY_SCORE : String(score)
}

export function marketCountTag(count: number): string {
  return count === 1 ? '1 market' : `${count} markets`
}

export function pageSearchPlaceholder(foundPageCount: number): string {
  return `Search ${pluralize(foundPageCount, 'page')}`
}

const STATUS_FIELDS = ['serpapi', 'claudeCode', 'jina', 'youtube'] as const

/** `warning` among the four capsule connections. `off` and `unchecked` are not issues. */
export function statusIssueCount(
  capsule: Pick<StatusCapsule, (typeof STATUS_FIELDS)[number]>
): number {
  return STATUS_FIELDS.filter((field) => capsule[field] === 'warning').length
}

/**
 * YouTube is optional. Hide that dot until a YouTube key exists.
 * No key is unconfigured, whether the rolled-up state is `off` or `unchecked`.
 * A stored key shows the dot, including while it is still `unchecked` or turned off.
 */
export function showYoutubeDot(
  _state: ConnectionState,
  keys: readonly Pick<ApiKeyMetadata, 'provider'>[]
): boolean {
  return keys.some((key) => key.provider === 'youtube')
}

export function statusCapsuleDots(
  capsule: Pick<StatusCapsule, (typeof STATUS_FIELDS)[number]>,
  keys: readonly Pick<ApiKeyMetadata, 'provider'>[]
): ConnectionState[] {
  const dots: ConnectionState[] = [capsule.serpapi, capsule.claudeCode, capsule.jina]
  if (showYoutubeDot(capsule.youtube, keys)) dots.push(capsule.youtube)
  return dots
}

/**
 * "210 searches left · 2 required steps left". The readiness part comes from the one
 * readiness model (`readiness`), so it matches "What CiteFox needs"; without it, only
 * the capsule's connection warnings count.
 */
export function statusCapsuleLabel(
  capsule: Pick<StatusCapsule, 'searchesLeft' | 'issueCount'>,
  ready?: Pick<Readiness, 'steps' | 'issues'> | null,
  options: { short?: boolean } = {}
): string {
  const issues = readinessText(ready ?? { steps: 0, issues: capsule.issueCount }, options)
  if (capsule.searchesLeft === null) return issues
  return `${capsule.searchesLeft.toLocaleString('en-US')} searches left · ${issues}`
}

/**
 * The searches-left button's tooltip and the start of its accessible name
 * (Header.dc.html): "31,898 searches left this month · Setup: 1 step left".
 * The setup part comes from the one readiness model, so it matches "What
 * CiteFox needs"; connection warnings follow as issues.
 */
export function statusButtonTip(
  capsule: Pick<StatusCapsule, 'searchesLeft' | 'issueCount'>,
  ready?: Pick<Readiness, 'steps' | 'issues'> | null
): string {
  const { steps, issues } = ready ?? { steps: 0, issues: capsule.issueCount }
  const parts: string[] = []
  if (capsule.searchesLeft !== null) {
    parts.push(`${capsule.searchesLeft.toLocaleString('en-US')} searches left this month`)
  }
  if (steps > 0) parts.push(`Setup: ${steps} ${steps === 1 ? 'step' : 'steps'} left`)
  if (issues > 0) parts.push(issues === 1 ? '1 issue' : `${issues} issues`)
  if (steps === 0 && issues === 0) parts.push('Setup done')
  return parts.join(' · ')
}

/** The "Setup: 1 step left" line of the ⚙ menu, or null when nothing is left. */
export function setupStepsLabel(ready: Pick<Readiness, 'steps'> | null): string | null {
  if (!ready || ready.steps === 0) return null
  return `Setup: ${ready.steps} ${ready.steps === 1 ? 'step' : 'steps'} left`
}

/** Older country codes whose flag is another ISO code's. */
const FLAG_ALIASES: Readonly<Record<string, string>> = { UK: 'GB' }

/** Regional-indicator flag for any two-letter country code (UK shows GB's). Empty otherwise. */
export function marketFlag(country: string): string {
  const upper = country.trim().toUpperCase()
  const code = FLAG_ALIASES[upper] ?? upper
  if (!/^[A-Z]{2}$/.test(code)) return ''
  const base = 0x1f1e6
  return String.fromCodePoint(base + code.charCodeAt(0) - 65, base + code.charCodeAt(1) - 65)
}

/** Flag, country, optional city, and the language subtag. Codes stay in the payload. */
export function marketLabel(market: Pick<Market, 'country' | 'language' | 'location'>): string {
  const flag = marketFlag(market.country)
  const language = market.language.split('-')[0]?.toUpperCase() ?? market.language
  const place = market.location ? `${market.country} · ${market.location}` : market.country
  return `${flag ? `${flag} ` : ''}${place} · ${language}`
}

export function pageDetailTags(page: {
  markets: readonly unknown[]
  intervalDays: IntervalDays
  samples: SampleCount
  promptSetVersion: number | null
  promptCount: number
}): string[] {
  const tags = [
    marketCountTag(page.markets.length),
    intervalLabel(page.intervalDays),
    page.samples === 1 ? '1 sample per question' : `${page.samples} samples per question`
  ]
  if (page.promptSetVersion !== null) {
    const prompts = page.promptCount === 1 ? '1 question' : `${page.promptCount} questions`
    tags.push(`Question set v${page.promptSetVersion} · ${prompts}`)
  }
  return tags
}
