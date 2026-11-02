import type {
  DraftOwnerWhyRequest,
  OwnerVerdict,
  OwnerWhyResult,
  OwnerWhySearch,
  PageBlock
} from '@shared/ipc'
import { normalizeUrl } from '../engine/checks/url'
import { fence } from '../prompts/blocks'
import { causeProblem, overviewWithSources } from '../prompts/citations'
import type { SqliteDatabase } from '../storage/database'
import { putOwnerWhy } from '../storage/owner-whys'
import { readProjectProfile } from '../storage/project-profile'
import { runTopicTemplate } from './claude'
import { TopicInputError } from './drafts'
import { brandVars, type OpenedProject, type TopicEnv } from './env'
import { storedOverview, topicMarketBlock } from './insight-context'
import { pageForEdit } from './page-edit'
import { pathOf } from './site'

/**
 * Why Google picks (What to fix › Pick which page owns it): both pages as text (a
 * snapshot when tracked, else a site read, read live when there is none), the
 * fix's searches and the saved overviews of the top ones, then one
 * `topic_owner_why` call for a verdict, what the answer needs, what the cited page
 * has and content changes to the owner page. Code checks every section against
 * that page's headings and saves the result per fix. Never a search.
 */

/** Searches listed in the prompt, and the ones whose saved overview it reads. */
export const OWNER_WHY_LISTED = 12
export const OWNER_WHY_OVERVIEWS = 3
/** Characters of each page, and of each overview, the prompt carries. */
const PAGE_CHARS = 9000
const OVERVIEW_CHARS = 1500
/** Sections that need no heading of their own. */
const FREE_SECTIONS = ['opening', 'intro', 'introduction', 'title', 'h1']

export type OwnerWhyReply = {
  verdict: OwnerVerdict
  reason: string
  answerNeeds: string[]
  citedHas: { section: string; point: string }[]
  toChange: { section: string; change: string; why: string }[]
  risk: string | null
}

/** One page as the prompt reads it: headings marked with `#`, list items with `-`. */
export function pageForPrompt(blocks: readonly PageBlock[]): string {
  const lines = blocks.map((block) => {
    const level = /^h([1-4])$/.exec(block.kind)?.[1]
    if (level !== undefined) return `${'#'.repeat(Number(level))} ${block.text}`
    return block.kind === 'li' ? `- ${block.text}` : block.text
  })
  const text = lines.join('\n')
  return text.length <= PAGE_CHARS ? text : `${text.slice(0, PAGE_CHARS)}\n[The page goes on.]`
}

/** The page's headings (H1 to H4), in reading order. */
export function headingsOf(blocks: readonly PageBlock[]): string[] {
  return blocks.filter((block) => /^h[1-4]$/.test(block.kind)).map((block) => block.text)
}

/**
 * The reply's problem in plain words, for one retry: a section that is not a heading
 * of its page, or a change that is an address change instead of content, or a line
 * that credits a change with a citation. Null when it is fine.
 */
export function ownerWhyProblem(
  reply: OwnerWhyReply,
  pages: { target: readonly string[]; cited: readonly string[] }
): string | null {
  for (const item of reply.citedHas) {
    if (!isSectionOf(item.section, pages.cited, false)) {
      return `citedHas section "${item.section}" is not a heading of the cited page. Copy one of its headings exactly (${listOf(pages.cited)}), or write "Opening".`
    }
  }
  const owner = reply.verdict === 'cited' ? pages.cited : pages.target
  const which = reply.verdict === 'cited' ? 'cited' : 'target'
  for (const item of reply.toChange) {
    if (!isSectionOf(item.section, owner, true)) {
      return `toChange section "${item.section}" is not a heading of the ${which} page. Copy one of its headings exactly (${listOf(owner)}), write "New section after <heading>", or "Opening".`
    }
    if (/https?:\/\/|\bredirect|\bcanonical\b|\b301\b/i.test(item.change)) {
      return `toChange "${item.change.slice(0, 80)}" changes an address. Each change is content to add or rewrite; put linking advice in risk.`
    }
  }
  return causeProblem([
    reply.reason,
    reply.risk ?? '',
    ...reply.toChange.map((item) => `${item.change} ${item.why}`)
  ])
}

function isSectionOf(section: string, headings: readonly string[], allowNew: boolean): boolean {
  const wanted = squash(section)
  if (FREE_SECTIONS.includes(wanted)) return true
  if (allowNew && wanted.startsWith('new section')) return true
  return headings.some((heading) => {
    const have = squash(heading)
    if (have.length === 0) return false
    return (
      have === wanted || (wanted.length >= 4 && (have.includes(wanted) || wanted.includes(have)))
    )
  })
}

function listOf(headings: readonly string[]): string {
  if (headings.length === 0) return 'it has none'
  return headings
    .slice(0, 12)
    .map((heading) => `"${heading}"`)
    .join(', ')
}

/**
 * The saved overviews of the first searches that have one, each with the sources it
 * cites; the two pages are marked so the prompt sees where each stands.
 */
export function overviewsForPrompt(
  db: SqliteDatabase,
  searches: readonly OwnerWhySearch[],
  pages: { targetUrl: string; citedUrl: string }
): { text: string; count: number } {
  const target = urlKey(pages.targetUrl)
  const cited = urlKey(pages.citedUrl)
  const parts: string[] = []
  for (const search of searches) {
    if (parts.length >= OWNER_WHY_OVERVIEWS) break
    const stored = storedOverview(db, search.promptId, search.runId)
    const read = overviewWithSources(stored.rawAioJson, stored.aioText, stored.references)
    if (read.text.trim().length === 0) continue
    const sources = stored.references.map((reference) => {
      const key = urlKey(reference.url)
      const mark = key === cited ? ' (the cited page)' : key === target ? ' (the target page)' : ''
      const title = reference.title?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? ''
      return `${reference.position}. ${reference.url}${title.length > 0 ? ` · ${title}` : ''}${mark}`
    })
    parts.push(
      [
        `Search: ${search.text}`,
        fence('overview', read.text.slice(0, OVERVIEW_CHARS)),
        'Sources it cites:',
        sources.length === 0 ? 'None stored.' : sources.join('\n')
      ].join('\n')
    )
  }
  return {
    text:
      parts.length === 0
        ? 'No AI Overview text was stored for these searches.'
        : parts.join('\n\n'),
    count: parts.length
  }
}

/** `fixes:draftOwnerWhy`: reads both pages, asks why Google picks the cited one, saves the answer. */
export async function draftOwnerWhy(
  env: TopicEnv,
  opened: OpenedProject,
  request: DraftOwnerWhyRequest
): Promise<OwnerWhyResult> {
  const { db } = opened
  const started = Date.now()
  const target = await readFor(env, db, { ...request.target, projectId: opened.project.id })
  const cited = await readFor(env, db, { pageId: null, url: request.citedUrl })
  const overviews = overviewsForPrompt(db, request.searches, {
    targetUrl: request.target.url,
    citedUrl: request.citedUrl
  })
  const brands = readProjectProfile(db)?.brandNames ?? []
  const headings = { target: headingsOf(target.blocks), cited: headingsOf(cited.blocks) }
  const listed = request.searches.slice(0, OWNER_WHY_LISTED)
  const reply = await runTopicTemplate<OwnerWhyReply>({
    host: env.host,
    db,
    projectId: opened.project.id,
    pageId: request.target.pageId,
    kind: 'topic_owner_why',
    channel: 'fixes:draftOwnerWhy',
    context: {
      target_url: request.target.url,
      cited_url: request.citedUrl,
      searches:
        listed.length === 0
          ? 'None saved yet.'
          : listed.map((search, index) => `${index + 1}. ${search.text}`).join('\n'),
      overviews: overviews.text,
      target_page: fence('page_text', pageForPrompt(target.blocks)),
      cited_page: fence('page_text', pageForPrompt(cited.blocks)),
      market_block: topicMarketBlock(db, null),
      ...brandVars(brands)
    },
    check: (value) => ownerWhyProblem(value, headings)
  })
  const value = reply.value
  const seconds = Math.max(1, Math.round((Date.now() - started) / 1000))
  return putOwnerWhy(db, {
    fixId: request.fixId,
    targetUrl: request.target.url,
    citedUrl: request.citedUrl,
    verdict: value.verdict,
    reason: value.reason.trim(),
    answerNeeds: value.answerNeeds.map((need) => need.trim()).filter(Boolean),
    citedHas: value.citedHas.map((item) => ({
      section: item.section.trim(),
      point: item.point.trim()
    })),
    ownerUrl: value.verdict === 'cited' ? request.citedUrl : request.target.url,
    toChange: value.toChange.map((item) => ({
      section: item.section.trim(),
      change: item.change.trim(),
      why: item.why.trim()
    })),
    risk: value.risk === null || value.risk.trim().length === 0 ? null : value.risk.trim(),
    overviews: overviews.count,
    note: `CiteFox AI · about ${seconds} s · no searches`,
    savedAt: env.host.now().toISOString()
  })
}

/** One page as blocks; a page that cannot be read is named in the message. */
async function readFor(
  env: TopicEnv,
  db: SqliteDatabase,
  page: { pageId: string | null; url: string; projectId?: string }
): Promise<{ blocks: PageBlock[] }> {
  try {
    return await pageForEdit(env, db, page)
  } catch (error) {
    if (error instanceof TopicInputError) {
      throw new TopicInputError(
        `Couldn't read ${pathOf(page.url)}. Check it opens in your browser, then try again.`
      )
    }
    throw error
  }
}

function urlKey(url: string): string {
  return (normalizeUrl(url) ?? url).replace(/\/+$/u, '')
}

function squash(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
