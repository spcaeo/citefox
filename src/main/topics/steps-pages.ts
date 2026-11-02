import {
  TOPIC_STAGE_LABEL,
  type TopicDraft,
  type TopicDraftPrompt,
  type TopicStage
} from '@shared/domain'
import {
  WRITE_WITH_URL,
  type MatchTopicPagesResult,
  type TopicPageBrief,
  type TopicPageCandidate,
  type TopicPageCandidates,
  type TopicTarget
} from '@shared/ipc'
import { normalizeUrl } from '../engine/checks/url'
import { competitorContext } from '../engine/competitor-context'
import { wordCount } from '../pipeline/hash'
import { tolerantRange, trimToWords, withinTolerance, wordsAskedOnce } from '../prompts/word-range'
import { fence, productBlock, TOPIC_STAGE_RULES } from '../prompts/blocks'
import { causeProblem } from '../prompts/citations'
import type { SqliteDatabase } from '../storage/database'
import { listPagesOfKind } from '../storage/pages'
import { listSitemapEntries, readSitemapSettings } from '../storage/sitemap-records'
import { getLatestSnapshot } from '../storage/snapshot-records'
import { runTopicTemplate } from './claude'
import { saveDraft, TopicInputError } from './drafts'
import { brandVars, progressFor, type OpenedProject, type TopicEnv } from './env'
import { overviewForPrompt, topicMarketBlock } from './insight-context'
import { candidateOpenings, pageHead } from './page-context'
import { readPageOrLive } from './page-live'
import { listSiteReads } from './records'

/** Most candidates sent to Claude in one match call. */
export const MAX_MATCH_CANDIDATES = 250
/** Prompts matched per Claude call. */
export const MATCH_BATCH = 60

const WORKING = new Set(['tracked', 'setting_up', 'paused', 'not_tracked'])

function titleFromPath(url: string): string | null {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).at(-1)
    return last === undefined ? null : decodeURIComponent(last).replace(/[-_]+/gu, ' ')
  } catch {
    return null
  }
}

/** `topics:pageCandidates`: tracked pages (with outlines where read) and sitemap entries. */
export function pageCandidates(db: SqliteDatabase, projectId: string): TopicPageCandidates {
  const out: TopicPageCandidate[] = []
  const seen = new Set<string>()
  // A page that is not tracked still has its headings when the topic read it.
  const reads = new Map(
    listSiteReads(db)
      .filter((read) => read.ok)
      .map((read) => [normalizeUrl(read.url) ?? read.url, read])
  )
  for (const page of listPagesOfKind(db, projectId, 'page')) {
    if (page.url === null || !WORKING.has(page.status)) continue
    const key = normalizeUrl(page.url) ?? page.url
    if (seen.has(key)) continue
    seen.add(key)
    const snapshot = page.status === 'not_tracked' ? null : getLatestSnapshot(db, page.id)
    const read = reads.get(key)
    out.push({
      pageId: page.status === 'not_tracked' ? null : page.id,
      url: page.url,
      title: snapshot?.title ?? page.title ?? read?.title ?? titleFromPath(page.url),
      source: page.status === 'not_tracked' ? 'sitemap' : 'tracked',
      outline:
        snapshot !== null
          ? snapshot.outline.map((entry) => entry.text).slice(0, 20)
          : (read?.outline ?? []).slice(0, 20)
    })
  }
  for (const entry of listSitemapEntries(db)) {
    if (entry.removedAt !== null) continue
    const key = normalizeUrl(entry.url) ?? entry.url
    if (seen.has(key)) continue
    seen.add(key)
    const read = reads.get(key)
    out.push({
      pageId: null,
      url: entry.url,
      title: read?.title ?? titleFromPath(entry.url),
      source: 'sitemap',
      outline: (read?.outline ?? []).slice(0, 20)
    })
  }
  out.sort((a, b) => (a.source === b.source ? 0 : a.source === 'tracked' ? -1 : 1))
  return { candidates: out, sitemapReadAt: readSitemapSettings(db).lastSyncAt }
}

/**
 * The fenced candidate list: `url · title · headings · opening text`, one per line.
 * The opening comes from the page's snapshot or its topic site read. Exported for tests.
 */
export function candidatesText(
  candidates: readonly TopicPageCandidate[],
  openings: ReadonlyMap<string, string> = new Map()
): string {
  if (candidates.length === 0) return fence('pages', 'No pages are known yet.')
  const lines = candidates.slice(0, MAX_MATCH_CANDIDATES).map((candidate) => {
    const opening = openings.get(normalizeUrl(candidate.url) ?? candidate.url) ?? ''
    const headings = candidate.outline.slice(0, 8).join(' | ')
    return [
      candidate.url,
      candidate.title ?? '',
      headings || 'no headings read',
      opening || 'text not read'
    ]
      .map((part) => part.replace(/\s+/gu, ' ').trim())
      .join(' · ')
  })
  return fence('pages', lines.join('\n'))
}

/** Below this confidence a suggested page is not a match (the template says the same). */
export const MATCH_MIN_CONFIDENCE = 20

type MatchReply = {
  matches: { id: string; url: string | null; confidence: number; reason: string }[]
}

/** Every prompt answered once, every url from the list. A sentence names what is wrong. */
export function matchProblem(
  reply: MatchReply,
  ids: readonly string[],
  urls: ReadonlySet<string>
): string | null {
  const wanted = new Set(ids)
  const seen = new Set<string>()
  for (const match of reply.matches) {
    if (!wanted.has(match.id))
      return `"${match.id}" is not one of the prompt ids. Use the ids from the list.`
    if (seen.has(match.id))
      return `Prompt id "${match.id}" is answered twice. Give each one answer.`
    seen.add(match.id)
    if (match.url !== null && !urls.has(normalizeUrl(match.url) ?? match.url)) {
      return `${match.url} is not in the candidate list. Use only urls from the list, or null.`
    }
  }
  const missing = ids.filter((id) => !seen.has(id))
  return missing.length === 0
    ? null
    : `Answer every prompt id; missing: ${missing.slice(0, 5).join(', ')}.`
}

/** `topics:matchPages`: Claude assigns a target page per prompt; user-confirmed targets stay. */
export async function matchPages(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  promptIds: readonly string[] | null
): Promise<MatchTopicPagesResult> {
  const { candidates } = pageCandidates(opened.db, opened.project.id)
  const byUrl = new Map(
    candidates.map((candidate) => [normalizeUrl(candidate.url) ?? candidate.url, candidate])
  )
  const wanted = promptIds === null ? null : new Set(promptIds)
  const targets = draft.prompts.filter(
    (prompt) =>
      prompt.included &&
      (wanted === null ? prompt.matchStatus !== 'confirmed' : wanted.has(prompt.id))
  )
  if (targets.length === 0)
    throw new TopicInputError('Nothing to match: every prompt already has a confirmed page.')
  const progress = progressFor(env, {
    projectId: opened.project.id,
    draftId: draft.id,
    topicId: draft.topicId,
    step: 'page_match'
  })
  const batches: TopicDraftPrompt[][] = []
  for (let index = 0; index < targets.length; index += MATCH_BATCH)
    batches.push(targets.slice(index, index + MATCH_BATCH))
  const results = new Map<string, { url: string | null; confidence: number; reason: string }>()
  const pages = candidatesText(candidates, candidateOpenings(opened.db, candidates))
  const listed = new Set(
    candidates.slice(0, MAX_MATCH_CANDIDATES).map((item) => normalizeUrl(item.url) ?? item.url)
  )
  // Batches run side by side; the shared Claude gate keeps at most its limit in flight.
  let done = 0
  progress('running', 0, batches.length, `Matching ${targets.length} prompts`)
  const replies = await Promise.all(
    batches.map(async (batch) => {
      // Claude sees short ids (P1, P2 …); long generated ids get mangled. Code maps them back.
      const ids = batch.map((_, index) => `P${index + 1}`)
      const reply = await runTopicTemplate<MatchReply>({
        host: env.host,
        db: opened.db,
        projectId: opened.project.id,
        pageId: draft.topicId,
        kind: 'topic_page_match',
        channel: 'topics:matchPages',
        context: {
          website: draft.website,
          pages,
          questions: batch.map((prompt, index) => `${ids[index]} · ${prompt.text}`).join('\n'),
          ...brandVars(draft.brandNames)
        },
        check: (value) => matchProblem(value, ids, listed)
      })
      done += 1
      if (done < batches.length) {
        progress('running', done, batches.length, `Matching ${targets.length} prompts`)
      }
      for (const match of reply.value.matches) {
        const prompt = batch[ids.indexOf(match.id)]
        if (prompt !== undefined) results.set(prompt.id, match)
      }
      return reply
    })
  )
  const info: MatchTopicPagesResult['info'] | null = replies.at(-1)?.info ?? null
  progress('ok', batches.length, batches.length, 'Pages matched')
  let matched = 0
  let noPage = 0
  const prompts = draft.prompts.map((prompt) => {
    const match = results.get(prompt.id)
    if (match === undefined) return prompt
    const candidate =
      match.url === null || match.confidence < MATCH_MIN_CONFIDENCE
        ? undefined
        : byUrl.get(normalizeUrl(match.url) ?? match.url)
    if (candidate === undefined) {
      noPage += 1
      return {
        ...prompt,
        targetPageId: null,
        targetUrl: null,
        matchConfidence: null,
        matchReason: match.reason,
        matchStatus: 'none' as const
      }
    }
    matched += 1
    return {
      ...prompt,
      targetPageId: candidate.pageId,
      targetUrl: candidate.url,
      matchConfidence: Math.max(0, Math.min(100, Math.round(match.confidence))),
      matchReason: match.reason,
      matchStatus: 'suggested' as const
    }
  })
  const next = saveDraft(opened.db, { ...draft, step: 'pages', prompts }, env.host.now())
  if (info === null) throw new TopicInputError('Nothing was matched.')
  return { draft: next, matched, noPage, info }
}

/** A target from the picker, checked against the project's pages and sitemap. */
export function resolveTarget(
  db: SqliteDatabase,
  projectId: string,
  target: TopicTarget
): { pageId: string | null; url: string | null } {
  if (target.pageId === null && target.url === null) return { pageId: null, url: null }
  const { candidates } = pageCandidates(db, projectId)
  const found =
    target.pageId !== null
      ? candidates.find((candidate) => candidate.pageId === target.pageId)
      : candidates.find(
          (candidate) =>
            (normalizeUrl(candidate.url) ?? candidate.url) ===
            (normalizeUrl(target.url ?? '') ?? target.url)
        )
  if (found !== undefined) return { pageId: found.pageId, url: found.url }
  if (target.url !== null && normalizeUrl(target.url) !== null)
    return { pageId: null, url: target.url }
  throw new TopicInputError('That page is not in this project.')
}

/** Draft side of `topics:setTarget`: user targets are confirmed and kept on re-match. */
export function setDraftTarget(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  promptIds: readonly string[],
  target: TopicTarget | undefined
): TopicDraft {
  const ids = new Set(promptIds)
  const resolved = target === undefined ? null : resolveTarget(opened.db, opened.project.id, target)
  const prompts = draft.prompts.map((prompt) => {
    if (!ids.has(prompt.id)) return prompt
    if (resolved === null)
      return {
        ...prompt,
        matchStatus: prompt.targetUrl === null ? ('none' as const) : ('confirmed' as const)
      }
    return {
      ...prompt,
      targetPageId: resolved.pageId,
      targetUrl: resolved.url,
      matchConfidence: resolved.url === null ? null : 100,
      matchReason: resolved.url === null ? 'You set no page yet.' : 'You picked this page.',
      matchStatus: resolved.url === null ? ('none' as const) : ('confirmed' as const)
    }
  })
  return saveDraft(opened.db, { ...draft, prompts }, env.host.now())
}

/** Headings a page brief's outline holds. */
export const BRIEF_OUTLINE = { min: 4, max: 7 } as const
/**
 * Words in a page brief's text, as the prompt asks. Code accepts about 10% either
 * side (108–275, `prompts/word-range.ts`): the range guides, it never fails a brief.
 */
export const BRIEF_WORDS = { min: 120, max: 250 } as const

type BriefReply = { summary: string; outline: string[]; text: string }

/** Outline 4–7 headings ending with an FAQ, and no cause claims. Always checked. */
export function briefShapeProblem(reply: BriefReply): string | null {
  const headings = reply.outline.length
  if (headings < BRIEF_OUTLINE.min || headings > BRIEF_OUTLINE.max) {
    return `Write ${BRIEF_OUTLINE.min} to ${BRIEF_OUTLINE.max} outline headings; you wrote ${headings}.`
  }
  if (!reply.outline.some((heading) => /\bfaqs?\b|questions/iu.test(heading))) {
    return 'End the outline with an FAQ heading.'
  }
  return causeProblem([reply.summary, reply.text, ...reply.outline])
}

/** The text's word count, when it is more than about 10% outside 120–250, as a retry line. */
export function briefWordsProblem(reply: BriefReply): string | null {
  const words = wordCount(reply.text)
  return withinTolerance(words, BRIEF_WORDS)
    ? null
    : `The brief text has ${words} words; write ${BRIEF_WORDS.min} to ${BRIEF_WORDS.max}.`
}

/** Both checks: the shape first, then the word count (with its tolerance). */
export function briefProblem(reply: BriefReply): string | null {
  return briefShapeProblem(reply) ?? briefWordsProblem(reply)
}

/** `{{ stage }}`: the stage name and what the buyer does at it. */
export function stageLine(stage: TopicStage | null): string {
  return stage === null ? 'No stage' : `${TOPIC_STAGE_LABEL[stage]}: ${TOPIC_STAGE_RULES[stage]}`
}

/** `topics:draftPageBrief`. Reads saved data, and the target page live when it was never read. */
export async function draftPageBrief(
  env: TopicEnv,
  opened: OpenedProject,
  input: {
    prompt: string
    stage: TopicDraftPrompt['stage']
    targetUrl: string | null
    targetPageId?: string | null
    brands: readonly string[]
    website: string
    citedNow: readonly string[]
    aioText: string | null
    promptId: string
    pageId: string | null
    /** The topic's market and the run the row reads; null in the wizard. */
    marketId?: string | null
    runId?: string | null
  }
): Promise<TopicPageBrief> {
  const page = await readPageOrLive(env.host, opened.db, {
    pageId: input.targetPageId ?? null,
    url: input.targetUrl
  })
  const overview =
    input.pageId === null || (input.runId ?? null) === null
      ? null
      : overviewForPrompt(opened.db, {
          promptId: input.promptId,
          runId: input.runId ?? null,
          topicId: input.pageId,
          ownDomain: opened.project.domain
        })
  const scope = input.pageId === null ? {} : { topicId: input.pageId }
  const reply = await runTopicTemplate<BriefReply>({
    host: env.host,
    db: opened.db,
    projectId: opened.project.id,
    pageId: input.pageId,
    kind: 'topic_page_brief',
    channel: 'topics:draftPageBrief',
    context: {
      prompt: input.prompt,
      stage: stageLine(input.stage),
      market_block: topicMarketBlock(opened.db, input.marketId ?? null),
      product_block: productBlock(competitorContext(opened.db, scope).product),
      page: input.targetUrl ?? 'No page yet',
      page_head: fence('page_text', pageHead(page, input.targetUrl)),
      website: input.website,
      cited_now:
        overview?.sources ??
        (input.citedNow.length > 0 ? input.citedNow.join(', ') : 'Not checked yet.'),
      aio_text: overview?.overview ?? fence('overview', input.aioText ?? 'Not checked yet.'),
      ...brandVars(input.brands)
    },
    // The word count is named once; a brief still too long after that is trimmed.
    check: wordsAskedOnce(briefShapeProblem, briefWordsProblem)
  })
  return {
    promptId: input.promptId,
    summary: reply.value.summary,
    outline: reply.value.outline,
    citedNow: input.citedNow,
    text: trimToWords(reply.value.text, tolerantRange(BRIEF_WORDS).max),
    writeWithUrl: WRITE_WITH_URL,
    info: reply.info
  }
}

const STOP = new Set(
  'a an and are as at be by can do for from has have how i in is it its my of on or our so that the their them they this to us was we what when where which who why will with you your'.split(
    ' '
  )
)

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 2 && !STOP.has(word))
}

/**
 * Candidates in the order the page list should keep them when it is cut to
 * {@link MAX_MATCH_CANDIDATES}: the ones whose path and title share the most words with
 * the questions first (a big sitemap no longer drops the one page that fits). Ties keep
 * their order.
 */
export function rankCandidates(
  candidates: readonly TopicPageCandidate[],
  texts: readonly string[],
  first: ReadonlySet<string> = new Set()
): TopicPageCandidate[] {
  const wanted = new Set(texts.flatMap(words))
  const score = (item: TopicPageCandidate): number => {
    if (first.has(item.url)) return Number.MAX_SAFE_INTEGER
    const own = new Set(words(`${item.url} ${item.title ?? ''} ${item.outline.join(' ')}`))
    let hits = 0
    for (const word of own) if (wanted.has(word)) hits += 1
    return hits
  }
  return candidates
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item)
}
