import type { CompetitorPageRead, TopicDraft } from '@shared/domain'
import { pageLabel, progressNote, progressStep } from '../assist/progress'
import { normalizeUrl } from '../engine/checks/url'
import type { EngineHost } from '../engine/host'
import { fetchPlaygroundPage } from '../pipeline/playground'
import { sharedReadPool } from '../pipeline/read-pool'
import { EVIDENCE_PAGE_CHARS, evidenceBlock, type EvidencePage } from '../prompts/blocks'
import { createJinaReaderClient } from '../providers/jina/reader'
import type { SqliteDatabase } from '../storage/database'
import { listPagesOfKind } from '../storage/pages'
import { getLatestSnapshot } from '../storage/snapshot-records'
import {
  relevantExcerpt,
  scoreCandidates,
  type EvidenceCandidate,
  type EvidenceQuery
} from './evidence-pick'
import {
  getSiteRead,
  listSiteReads,
  saveSiteRead,
  SITE_READ_TEXT_MAX,
  type SiteRead,
  type SiteReadRole
} from './records'

/**
 * Site reading for Discover and the competitor page (Docs/TOPICS-SPEC.md section 3):
 * the homepage and up to five key pages, read through Jina Reader (a direct read
 * when Jina fails), cached per project in `topic_site_reads`. Never a SerpApi search.
 */

/** Key pages tried after the homepage, in order. */
export const KEY_PAGE_PATHS: readonly { path: string; role: SiteReadRole }[] = [
  { path: '/pricing', role: 'pricing' },
  { path: '/features', role: 'features' },
  { path: '/faq', role: 'faq' },
  { path: '/about', role: 'about' },
  { path: '/use-cases', role: 'use_cases' }
]

/** A cached read younger than this is reused. */
export const SITE_READ_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface SiteReadProgress {
  done: number
  total: number
  url: string
}

export function siteRoot(website: string): string {
  const bare = website
    .trim()
    .replace(/^https?:\/\//iu, '')
    .replace(/\/.*$/u, '')
  return `https://${bare}`
}

/**
 * Reads (or reuses) the homepage and key pages, side by side through the read pool;
 * the reads come back in page order. Failed reads are cached too, as not ok.
 */
export async function readSite(
  host: EngineHost,
  db: SqliteDatabase,
  website: string,
  options: { force?: boolean; onProgress?: (progress: SiteReadProgress) => void } = {}
): Promise<SiteRead[]> {
  const root = siteRoot(website)
  const targets = [
    { url: `${root}/`, role: 'home' as SiteReadRole },
    ...KEY_PAGE_PATHS.map((page) => ({ url: `${root}${page.path}`, role: page.role }))
  ]
  // "2 of 6 read · reading /faq": the count moves as each read ends, naming one still open.
  const open = targets.map((target) => target.url)
  const tell = (): void =>
    options.onProgress?.({
      done: targets.length - open.length,
      total: targets.length,
      url: open[0] ?? root
    })
  tell()
  return Promise.all(
    targets.map(async (target) => {
      const read = await readOne(host, db, target.url, target.role, options.force === true)
      open.splice(open.indexOf(target.url), 1)
      tell()
      return read
    })
  )
}

export async function readOne(
  host: EngineHost,
  db: SqliteDatabase,
  url: string,
  role: SiteReadRole,
  force: boolean
): Promise<SiteRead> {
  const cached = getSiteRead(db, url)
  const now = host.now()
  if (
    !force &&
    cached !== null &&
    now.getTime() - Date.parse(cached.readAt) < SITE_READ_MAX_AGE_MS
  ) {
    progressNote({
      kind: 'cache',
      label: `Reading ${pageLabel(url)}`,
      detail: `${cached.ok ? 'Saved copy' : 'Not found last time'} from ${ageText(now.getTime() - Date.parse(cached.readAt))}`,
      state: cached.ok ? 'done' : 'skipped'
    })
    return cached
  }
  const step = progressStep({ kind: 'read', label: `Reading ${pageLabel(url)}` })
  const read = await sharedReadPool().run(url, () =>
    fetchRead(host, url, role, now.toISOString(), (detail) => step.update(detail))
  )
  if (read.ok) step.done(methodText(read))
  else step.skip('Not found or not readable · skipped')
  saveSiteRead(db, read)
  return read
}

/** "Read · 820 words". The reader behind it is never named on screen. */
function methodText(read: SiteRead): string {
  return `Read · ${read.wordCount.toLocaleString('en-US')} ${read.wordCount === 1 ? 'word' : 'words'}`
}

/** "today", "1 day ago", "3 days ago". */
function ageText(ms: number): string {
  const days = Math.floor(Math.max(0, ms) / (24 * 60 * 60 * 1000))
  if (days === 0) return 'today'
  return days === 1 ? '1 day ago' : `${days} days ago`
}

async function fetchRead(
  host: EngineHost,
  url: string,
  role: SiteReadRole,
  readAt: string,
  onMethod: (detail: string) => void = () => undefined
): Promise<SiteRead> {
  const failed: SiteRead = {
    url,
    role,
    ok: false,
    title: null,
    metaDescription: null,
    h1: null,
    outline: [],
    faqCount: 0,
    wordCount: 0,
    text: '',
    method: null,
    readAt
  }
  if (host.readWebsitePage !== undefined) {
    try {
      const body = await host.readWebsitePage(url)
      if (body === null || body.text.trim().length === 0) return failed
      return fromMarkdown(url, role, readAt, body.title, body.text, 'fixture')
    } catch {
      return failed
    }
  }
  onMethod('Reading')
  try {
    const jina = createJinaReaderClient({
      transport: host.http,
      logger: host.logger,
      secrets: host.knownSecrets
    })
    const response = await jina.read(url, null)
    if (response.status >= 200 && response.status < 300) {
      const parsed = parseJina(response.body)
      if (parsed.text.trim().length > 0) {
        return fromMarkdown(
          url,
          role,
          readAt,
          parsed.title,
          parsed.text,
          'jina',
          parsed.description
        )
      }
    }
  } catch {
    // Fall through to a direct read.
  }
  onMethod('Trying a direct read')
  try {
    const page = await fetchPlaygroundPage({
      url,
      transport: host.http,
      logger: host.logger,
      ...(host.pageDns !== undefined ? { dns: host.pageDns } : {}),
      secrets: host.knownSecrets()
    })
    if (page.pageText.trim().length === 0) return failed
    return {
      url,
      role,
      ok: true,
      title: page.title || null,
      metaDescription: page.metaDescription || null,
      h1: page.h1 || null,
      outline: (page.outline ?? []).map((entry) => entry.text),
      faqCount: page.faqs?.length ?? 0,
      wordCount: wordCount(page.pageText),
      text: page.pageText.slice(0, SITE_READ_TEXT_MAX),
      method: 'direct',
      readAt
    }
  } catch {
    return failed
  }
}

function parseJina(body: string): {
  title: string | null
  text: string
  description: string | null
} {
  try {
    const parsed = JSON.parse(body) as {
      data?: { title?: unknown; content?: unknown; description?: unknown }
    }
    const data = parsed.data ?? {}
    return {
      title: typeof data.title === 'string' ? data.title : null,
      text: typeof data.content === 'string' ? data.content : '',
      description: typeof data.description === 'string' ? data.description : null
    }
  } catch {
    return { title: null, text: body, description: null }
  }
}

function wordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length
}

/** A read from Markdown (Jina or a fixture): headings become the outline. */
export function fromMarkdown(
  url: string,
  role: SiteReadRole,
  readAt: string,
  title: string | null,
  text: string,
  method: 'jina' | 'fixture',
  description: string | null = null
): SiteRead {
  const lines = text.split(/\r?\n/u)
  const h1 =
    lines
      .find((line) => /^#\s+/u.test(line))
      ?.replace(/^#\s+/u, '')
      .trim() ?? null
  const outline = lines
    .filter((line) => /^#{2,3}\s+/u.test(line))
    .map((line) => line.replace(/^#{2,3}\s+/u, '').trim())
    .filter(Boolean)
  return {
    url,
    role,
    ok: true,
    title,
    metaDescription: description,
    h1,
    outline,
    faqCount: outline.filter((heading) => heading.endsWith('?')).length,
    wordCount: wordCount(text),
    text: text.slice(0, SITE_READ_TEXT_MAX),
    method,
    readAt
  }
}

/** The site text for templates: each read page's title, headings and first words. */
export function siteText(reads: readonly SiteRead[], perPage = 1800): string {
  const ok = reads.filter((read) => read.ok)
  if (ok.length === 0) return 'The site could not be read.'
  return ok
    .map((read) => {
      const path = pathOf(read.url)
      const head = [read.title, read.h1].filter((part): part is string => part !== null).join(' · ')
      const outline = read.outline.slice(0, 15).join(' | ')
      return `${path} (${read.role})${head ? `: ${head}` : ''}${outline ? `\nHeadings: ${outline}` : ''}\n${read.text.slice(0, perPage)}`
    })
    .join('\n\n')
}

/** The roles {@link readSite} reads: the homepage and the key pages. */
const KEY_ROLES: ReadonlySet<SiteReadRole> = new Set<SiteReadRole>([
  'home',
  ...KEY_PAGE_PATHS.map((page) => page.role)
])

/**
 * Cached reads of the project's own homepage and key pages. Topic pages read for
 * {@link topicEvidence} (role `other`) and competitor pages are left out, so the
 * site text other steps send stays the same size as topics are added.
 */
export function cachedSiteReads(db: SqliteDatabase): SiteRead[] {
  return listSiteReads(db).filter((read) => KEY_ROLES.has(read.role))
}

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

/** A competitor page as the wizard shows it. */
export function competitorRead(read: SiteRead): CompetitorPageRead {
  let domain: string
  try {
    domain = new URL(read.url).hostname.replace(/^www\./u, '')
  } catch {
    domain = read.url
  }
  return {
    url: read.url,
    domain,
    ok: read.ok,
    title: read.title,
    metaDescription: read.metaDescription,
    h1: read.h1,
    outline: read.outline,
    faqCount: read.faqCount,
    wordCount: read.wordCount,
    readAt: read.readAt,
    message: read.ok ? null : 'Could not read that page. Check the address and try again.'
  }
}

// ---------------------------------------------------------------------------
// Topic evidence (Docs/PROMPT-AUDIT.md, P3 item 0)
// ---------------------------------------------------------------------------

/** Pages of the site sent as one topic's evidence. */
export const TOPIC_EVIDENCE_PAGES = 6
/** Of those, at most this many are the topic's own pages; the rest are key pages. */
export const TOPIC_EVIDENCE_TOPIC_PAGES = 4
/** Key pages kept next to the topic's own pages, in this order. */
const ANCHOR_ROLES: readonly SiteReadRole[] = ['home', 'pricing', 'faq', 'features', 'use_cases']

export interface TopicEvidence {
  /** The pages, topic pages first. */
  pages: EvidencePage[]
  /** `{{ evidence }}`: the pages fenced as data. */
  block: string
  /** Paths of the topic's own pages (outside the fixed key pages). */
  topicPaths: string[]
  /** True when no page matched the topic and the key pages were sent instead. */
  fallback: boolean
}

/**
 * The site's own pages most about this topic (Docs/PROMPT-AUDIT.md, P3 item 0): up
 * to {@link TOPIC_EVIDENCE_TOPIC_PAGES} pages whose URL words, title or headings
 * match the seed and core terms (tracked pages, sitemap entries and the key pages
 * already read), then the homepage and key pages up to {@link TOPIC_EVIDENCE_PAGES}.
 * When nothing matches it sends the fixed key pages. Page reads are cached like
 * {@link readSite} (role `other`), tracked pages use their stored snapshot, and it
 * never spends a search.
 */
export async function topicEvidence(
  host: EngineHost,
  db: SqliteDatabase,
  projectId: string,
  draft: Pick<TopicDraft, 'seed' | 'website' | 'keywordTerms'>,
  candidates: readonly EvidenceCandidate[],
  fallbackWebsite: string
): Promise<TopicEvidence> {
  const keyReads = (await readSite(host, db, draft.website || fallbackWebsite)).filter(
    (read) => read.ok
  )
  const home = keyReads.find((read) => read.role === 'home')
  const query: EvidenceQuery = {
    seed: draft.seed,
    terms: draft.keywordTerms
      .filter((term) => term.kept)
      .flatMap((term) => [term.term, ...term.synonyms]),
    generic: home === undefined ? [] : [home.title ?? '', home.h1 ?? '']
  }
  const seen = new Set<string>()
  const pool: EvidenceCandidate[] = []
  const add = (candidate: EvidenceCandidate): void => {
    const key = urlKey(candidate.url)
    if (seen.has(key)) return
    seen.add(key)
    pool.push(candidate)
  }
  for (const read of keyReads) {
    add({ url: read.url, title: read.title ?? read.h1, outline: read.outline, tracked: false })
  }
  candidates.forEach(add)
  const ranked = scoreCandidates(pool, query)
  const keyByUrl = new Map(keyReads.map((read) => [urlKey(read.url), read]))
  const pageIds = trackedPageIds(db, projectId)
  // Read a few more than needed, in parallel, so a page that fails leaves no gap.
  const tries = ranked.slice(0, TOPIC_EVIDENCE_TOPIC_PAGES + 2)
  const read = await Promise.all(
    tries.map(async (item): Promise<EvidencePage | null> => {
      const key = urlKey(item.candidate.url)
      const known = keyByUrl.get(key)
      if (known !== undefined) return evidenceFromRead(known, query)
      const pageId = pageIds.get(key)
      const snapshot = pageId === undefined ? null : getLatestSnapshot(db, pageId)
      if (snapshot !== null && snapshot.bodyText.trim().length > 0) {
        return {
          path: pathOf(item.candidate.url),
          title: snapshot.title ?? item.candidate.title,
          text: relevantExcerpt(snapshot.bodyText, query, EVIDENCE_PAGE_CHARS)
        }
      }
      const fresh = await readOne(host, db, item.candidate.url, 'other', false)
      return fresh.ok ? evidenceFromRead(fresh, query) : null
    })
  )
  const topic = read
    .filter((page): page is EvidencePage => page !== null && page.text.length > 0)
    .slice(0, TOPIC_EVIDENCE_TOPIC_PAGES)
  const used = new Set(topic.map((page) => page.path))
  const fallback = topic.length === 0
  const others = fallback
    ? keyReads
    : ANCHOR_ROLES.flatMap((role) => keyReads.filter((item) => item.role === role))
  const rest = others
    .map((item) => evidenceFromRead(item, query))
    .filter((page) => !used.has(page.path))
  const pages = [...topic, ...rest].slice(0, TOPIC_EVIDENCE_PAGES)
  const keyPaths = new Set(keyReads.map((item) => pathOf(item.url)))
  return {
    pages,
    block: evidenceBlock(pages),
    topicPaths: topic.map((page) => page.path).filter((path) => !keyPaths.has(path)),
    fallback
  }
}

function evidenceFromRead(read: SiteRead, query: EvidenceQuery): EvidencePage {
  const headings = read.outline.slice(0, 12).join(' | ')
  const room = Math.max(600, EVIDENCE_PAGE_CHARS - headings.length - 11)
  const excerpt = relevantExcerpt(read.text, query, room)
  return {
    path: pathOf(read.url),
    title: read.title ?? read.h1,
    text: headings.length > 0 ? `Headings: ${headings}\n${excerpt}` : excerpt
  }
}

function urlKey(url: string): string {
  return (normalizeUrl(url) ?? url).replace(/\/$/u, '').toLowerCase()
}

/** Tracked pages by URL, for their stored snapshots. */
function trackedPageIds(db: SqliteDatabase, projectId: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const page of listPagesOfKind(db, projectId, 'page')) {
    if (page.url === null || page.status === 'not_tracked') continue
    out.set(urlKey(page.url), page.id)
  }
  return out
}
