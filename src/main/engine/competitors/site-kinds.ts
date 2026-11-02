import { cleanHost } from '@shared/competitor-hosts'
import type { CitedSiteRow } from '@shared/ipc'
import {
  builtInSiteKind,
  isSortableSiteKind,
  SORTABLE_SITE_KINDS,
  type SiteKind,
  type SortableSiteKind
} from '@shared/report/site-kinds'
import { isRecord } from '../../providers/json-schema'
import type { SqliteDatabase } from '../../storage/database'
import { readSiteKinds, saveSiteKinds } from '../../storage/site-kinds'
import { completeAssist } from '../assist'
import type { AssistShape } from '../assist-shapes'
import type { EngineHost } from '../host'

/**
 * "Who else the AI answers cite": the kind of each cited site. Saved competitors and
 * the built-in list of well-known hosts never need Claude. Every other cited domain is
 * sorted by Claude once (`competitors:sortSites`) and the answer is kept in the project
 * file (`site_kinds`), so the same domain is never asked again. The first line names
 * the call so the e2e `claude` stand-in answers from
 * `src/main/assist/fixtures/competitors.siteKinds.json`.
 */

export const SITE_KINDS_ASSIST_ID = 'competitors.siteKinds'

/** Domains per Claude call. */
export const SORT_BATCH = 40

export const SITE_KINDS_SHAPE: AssistShape = {
  example: {
    sites: [
      { domain: 'examplereviews.com', kind: 'analysts_media' },
      { domain: 'exampleagency.co', kind: 'services' },
      { domain: 'unknownsite.net', kind: 'other' }
    ]
  },
  notes: `One entry per domain, the domain exactly as given. kind is one of ${SORTABLE_SITE_KINDS.map((kind) => `"${kind}"`).join(', ')}: video_social for video, social networks, forums and Q&A; analysts_media for analysts, review and comparison sites, news and trade media; big_tech for large technology and cloud companies; services for agencies, consultants and service firms; other for anything else or when you are not sure.`
}

/** Claude's reply, kinds by domain. Entries with an unknown kind are left out. */
export function parseSiteKinds(value: unknown): Map<string, SortableSiteKind> | null {
  if (!isRecord(value) || !Array.isArray(value.sites)) return null
  const found = new Map<string, SortableSiteKind>()
  for (const entry of value.sites) {
    if (!isRecord(entry) || typeof entry.domain !== 'string') return null
    const domain = cleanHost(entry.domain)
    if (domain.length === 0 || !isSortableSiteKind(entry.kind)) continue
    found.set(domain, entry.kind)
  }
  return found
}

/** The site kind of one Competitors row; null for the project's own site. */
export function rowSiteKind(
  row: Pick<CitedSiteRow, 'kind' | 'domain'>,
  stored: ReadonlyMap<string, SortableSiteKind>
): SiteKind | null {
  if (row.kind === 'you') return null
  if (row.kind === 'competitor') return 'competitors'
  const domain = row.domain === null ? '' : cleanHost(row.domain)
  if (domain.length === 0) return 'other'
  return builtInSiteKind(domain) ?? stored.get(domain) ?? 'other'
}

/** Cited domains of these rows that nothing has sorted yet, most cited first. */
export function unsortedDomains(
  rows: readonly Pick<CitedSiteRow, 'kind' | 'domain' | 'citations' | 'startCitations'>[],
  stored: ReadonlyMap<string, SortableSiteKind>
): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.kind !== 'other' || row.domain === null) continue
    if (row.citations === 0 && (row.startCitations ?? 0) === 0) continue
    const domain = cleanHost(row.domain)
    if (domain.length === 0 || seen.has(domain)) continue
    seen.add(domain)
    if (builtInSiteKind(domain) !== null || stored.has(domain)) continue
    found.push(domain)
  }
  return found
}

/** Stored kinds for the `other` rows' domains. */
export function storedKindsFor(
  db: SqliteDatabase,
  rows: readonly Pick<CitedSiteRow, 'kind' | 'domain'>[]
): Map<string, SortableSiteKind> {
  const domains = rows
    .filter((row) => row.kind === 'other' && row.domain !== null)
    .map((row) => row.domain ?? '')
  return readSiteKinds(db, domains)
}

/**
 * Asks Claude for the kind of each domain (up to {@link SORT_BATCH}) and saves every
 * one of them: a domain Claude leaves out is saved as `other`, so it is not asked again.
 */
export async function sortSiteKinds(input: {
  host: EngineHost
  channel: string
  db: SqliteDatabase
  projectId: string
  domains: readonly string[]
}): Promise<number> {
  const batch = input.domains.slice(0, SORT_BATCH)
  if (batch.length === 0) return 0
  const json = await completeAssist(
    input.host,
    input.channel,
    `Assist: ${SITE_KINDS_ASSIST_ID}\nSort each website domain below into one kind of site, from what you already know about it. Do not search. When you are not sure, use other.\n\nDomains:\n${batch.map((domain) => `- ${domain}`).join('\n')}`,
    (value) => parseSiteKinds(value) !== null,
    SITE_KINDS_SHAPE,
    { assistId: SITE_KINDS_ASSIST_ID, projectId: input.projectId }
  )
  const kinds = parseSiteKinds(json) ?? new Map<string, SortableSiteKind>()
  saveSiteKinds(
    input.db,
    batch.map((domain) => ({ domain, kind: kinds.get(domain) ?? 'other' })),
    input.host.now().toISOString()
  )
  return batch.length
}
