import { ENGINE_IDS, ENGINE_SHORT_LABEL, TOPIC_STAGE_LABEL, type EngineId } from '@shared/domain'
import type {
  SuggestTopicTargetResult,
  TopicPageCandidate,
  TopicTargetAiPick,
  TopicTargetSuggestion,
  TopicTargetSuggestions
} from '@shared/ipc'
import { pluralWord } from '@shared/pluralize'
import { resolveTargetPage, targetPageKey, targetPagePath } from '@shared/target-page'
import { fence } from '../prompts/blocks'
import type { SqliteDatabase } from '../storage/database'
import { getPage } from '../storage/pages'
import { readProjectProfile } from '../storage/project-profile'
import { runTopicTemplate } from './claude'
import { TopicInputError } from './drafts'
import { brandVars, type OpenedProject, type TopicEnv } from './env'
import { topicMarketBlock } from './insight-context'
import { activePromptSetId, stableKeys, TopicNotFoundError, topicPromptMetas } from './results'
import { pageCandidates } from './steps-pages'

/**
 * Target page suggestions for a topic (src/shared/ipc/topicTargets.ts). The free part
 * reads the topic's saved checks: for each question or keyword and each engine, the
 * latest finished check in the market, and the own pages it cites (the Google AI
 * Overview's own references and cited page, each answer engine's own sources and
 * cited page). Pages are one page when `targetPageKey` matches, the same rule the
 * topic screen reads a target with. The AI part sends those pages, their headings and
 * counts to the topic template `topic_target_suggest` and keeps only listed pages.
 */

/** Most candidate pages CiteFox AI reads: every cited page first, then tracked and sitemap. */
export const MAX_TARGET_CANDIDATES = 120
/** Most of the topic's questions and keywords sent to CiteFox AI. */
export const MAX_TARGET_QUESTIONS = 60

const RUN = `r.page_id = ? AND r.market_id = ? AND r.status != 'cancelled' AND r.finished_at IS NOT NULL`

interface SampleRow {
  id: string
  prompt_id: string
  run_id: string
  finished_at: string
  engine: string
  cited_url: string | null
  position: number | null
}

interface RefRow {
  sample_id: string
  url: string
  position: number
  title: string | null
}

interface Cite {
  url: string
  position: number | null
  title: string | null
}

/** One question × engine: its latest check and the own pages that check cites. */
interface Latest {
  runId: string
  at: string
  pages: Map<string, Cite>
}

function addCite(pages: Map<string, Cite>, cite: Cite): void {
  const key = targetPageKey(cite.url)
  if (key === null) return
  const seen = pages.get(key)
  const position =
    seen === undefined || seen.position === null
      ? cite.position
      : cite.position === null
        ? seen.position
        : Math.min(seen.position, cite.position)
  pages.set(key, { url: seen?.url ?? cite.url, position, title: seen?.title ?? cite.title })
}

/** Stored samples of the topic's finished checks in one market, with their own-page citations. */
function readSamples(
  db: SqliteDatabase,
  topicId: string,
  marketId: string
): { samples: SampleRow[]; refs: RefRow[] } {
  const google = db
    .prepare<unknown[], SampleRow>(
      `SELECT s.id AS id, s.prompt_id AS prompt_id, s.run_id AS run_id, r.finished_at AS finished_at,
              'google_aio' AS engine, s.cited_url AS cited_url, s.position AS position
         FROM serp_results s JOIN runs r ON r.id = s.run_id
        WHERE ${RUN} AND s.status != 'error'`
    )
    .all(topicId, marketId)
  const answers = db
    .prepare<unknown[], SampleRow>(
      `SELECT e.id AS id, e.prompt_id AS prompt_id, e.run_id AS run_id, r.finished_at AS finished_at,
              e.engine AS engine, e.cited_url AS cited_url, e.position AS position
         FROM engine_answers e JOIN runs r ON r.id = e.run_id
        WHERE ${RUN} AND e.status NOT IN ('error', 'unavailable')`
    )
    .all(topicId, marketId)
  const googleRefs = db
    .prepare<unknown[], RefRow>(
      `SELECT a.serp_result_id AS sample_id, a.url AS url, a.position AS position, a.title AS title
         FROM aio_references a
         JOIN serp_results s ON s.id = a.serp_result_id
         JOIN runs r ON r.id = s.run_id
        WHERE ${RUN} AND a.classification IN ('target', 'own')`
    )
    .all(topicId, marketId)
  const answerRefs = db
    .prepare<unknown[], RefRow>(
      `SELECT es.answer_id AS sample_id, es.url AS url, es.position AS position, es.title AS title
         FROM engine_sources es
         JOIN engine_answers e ON e.id = es.answer_id
         JOIN runs r ON r.id = e.run_id
        WHERE ${RUN} AND es.classification IN ('target', 'own')`
    )
    .all(topicId, marketId)
  return { samples: [...google, ...answers], refs: [...googleRefs, ...answerRefs] }
}

function isEngine(value: string): value is EngineId {
  return (ENGINE_IDS as readonly string[]).includes(value)
}

/** "Google and ChatGPT", "Google, ChatGPT and Perplexity". */
export function engineList(engines: readonly EngineId[]): string {
  const names = engines.map((engine) => ENGINE_SHORT_LABEL[engine])
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

/** What the counts count: "questions", "keywords" or "questions and keywords", singular for one. */
export function promptNoun(questions: number, keywords: number): string {
  const total = questions + keywords
  if (keywords === 0) return pluralWord(total, 'question')
  if (questions === 0) return pluralWord(total, 'keyword')
  return 'questions and keywords'
}

/**
 * The clear winner: cited for at least half the prompts that cite the own site, more
 * often than the next page, and not the home page (a home page is no topic page).
 */
export function targetPick(
  suggestions: readonly TopicTargetSuggestion[],
  totals: { checked: number; cited: number; noun: string }
): TopicTargetSuggestions['pick'] {
  const [top, next] = suggestions
  if (top === undefined || totals.cited === 0) return null
  if (top.citedPrompts * 2 < totals.cited) return null
  if (next !== undefined && next.citedPrompts >= top.citedPrompts) return null
  if (targetPagePath(top.url) === '/') return null
  const engines = engineList(top.engines.map((item) => item.engine))
  const verb = top.engines.length === 1 ? 'cites' : 'cite'
  return {
    url: top.url,
    note: `Picked because ${engines} already ${verb} it for ${top.citedPrompts} of ${totals.checked} ${totals.noun}`
  }
}

/** "Email to sms gateway" from `/blog/email-to-sms-gateway`; "Home page" for `/`. */
function titleFromPath(url: string): string {
  const last = targetPagePath(url).split('/').filter(Boolean).at(-1)
  if (last === undefined) return 'Home page'
  let words = last
  try {
    words = decodeURIComponent(last)
  } catch {
    // A broken escape keeps the raw path part.
  }
  words = words.replace(/[-_]+/gu, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The topic's default market, after checking the topic exists. */
function topicMarket(
  db: SqliteDatabase,
  projectId: string,
  topicId: string,
  marketId: string | null
): string | null {
  const page = getPage(db, topicId, projectId)
  if (page === null || page.kind !== 'topic') throw new TopicNotFoundError()
  return marketId ?? page.defaultMarketId
}

/** `topics:targetSuggestions`. Reads saved checks only; never searches or calls CiteFox AI. */
export function topicTargetSuggestions(
  db: SqliteDatabase,
  input: { projectId: string; topicId: string; marketId: string | null; domain: string }
): TopicTargetSuggestions {
  const marketId = topicMarket(db, input.projectId, input.topicId, input.marketId)
  const empty: TopicTargetSuggestions = {
    topicId: input.topicId,
    marketId,
    suggestions: [],
    checkedPrompts: 0,
    citedPrompts: 0,
    noun: 'questions',
    pick: null
  }
  if (marketId === null || activePromptSetId(db, input.topicId) === null) return empty
  const kinds = new Map(
    topicPromptMetas(db, input.topicId, marketId).map((meta) => [meta.stableKey, meta.kind])
  )
  const keyOf = stableKeys(db, input.topicId)
  const { samples, refs } = readSamples(db, input.topicId, marketId)
  const refsOf = new Map<string, RefRow[]>()
  for (const ref of refs) refsOf.set(ref.sample_id, [...(refsOf.get(ref.sample_id) ?? []), ref])

  // The latest check per question × engine; samples of that one run add up.
  const latest = new Map<string, Map<EngineId, Latest>>()
  for (const sample of samples) {
    const key = keyOf.get(sample.prompt_id)
    if (key === undefined || !kinds.has(key) || !isEngine(sample.engine)) continue
    const byEngine = latest.get(key) ?? new Map<EngineId, Latest>()
    latest.set(key, byEngine)
    let entry = byEngine.get(sample.engine)
    if (entry !== undefined && entry.runId !== sample.run_id && entry.at >= sample.finished_at)
      continue
    if (entry === undefined || entry.runId !== sample.run_id) {
      entry = { runId: sample.run_id, at: sample.finished_at, pages: new Map() }
      byEngine.set(sample.engine, entry)
    }
    const own: Cite[] = (refsOf.get(sample.id) ?? []).map((ref) => ({
      url: ref.url,
      position: ref.position,
      title: ref.title
    }))
    if (sample.cited_url !== null)
      own.push({ url: sample.cited_url, position: sample.position, title: null })
    for (const cite of own) {
      // Classified own when checked; resolved here so it saves as `topics:update` would.
      const url = resolveTargetPage(cite.url, input.domain, true)
      const position = cite.position === null ? null : Math.round(cite.position)
      if (url !== null) addCite(entry.pages, { ...cite, url, position })
    }
  }

  const known = new Map<string, TopicPageCandidate>()
  for (const candidate of pageCandidates(db, input.projectId).candidates) {
    const key = targetPageKey(candidate.url)
    if (key !== null && !known.has(key)) known.set(key, candidate)
  }
  interface Tally {
    url: string
    title: string | null
    prompts: Set<string>
    engines: Map<EngineId, Set<string>>
    best: number | null
  }
  const tallies = new Map<string, Tally>()
  const citing = new Set<string>()
  let questions = 0
  let keywords = 0
  for (const [key, byEngine] of latest) {
    if (kinds.get(key) === 'keyword') keywords += 1
    else questions += 1
    for (const [engine, entry] of byEngine) {
      for (const [pageKey, cite] of entry.pages) {
        citing.add(key)
        const tally = tallies.get(pageKey) ?? {
          url: cite.url,
          title: cite.title,
          prompts: new Set<string>(),
          engines: new Map<EngineId, Set<string>>(),
          best: null
        }
        tally.title ??= cite.title
        tally.prompts.add(key)
        tally.engines.set(engine, (tally.engines.get(engine) ?? new Set()).add(key))
        if (cite.position !== null && (tally.best === null || cite.position < tally.best))
          tally.best = cite.position
        tallies.set(pageKey, tally)
      }
    }
  }

  const suggestions: TopicTargetSuggestion[] = [...tallies.entries()].map(([pageKey, tally]) => {
    const candidate = known.get(pageKey)
    const engines = [...tally.engines.entries()]
      .map(([engine, keys]) => ({ engine, prompts: keys.size }))
      .sort(
        (a, b) =>
          Number(b.engine === 'google_aio') - Number(a.engine === 'google_aio') ||
          b.prompts - a.prompts ||
          ENGINE_IDS.indexOf(a.engine) - ENGINE_IDS.indexOf(b.engine)
      )
    return {
      url: tally.url,
      title: candidate?.title ?? tally.title ?? titleFromPath(tally.url),
      pageId: candidate?.pageId ?? null,
      source: candidate?.source ?? 'cited',
      citedPrompts: tally.prompts.size,
      engines,
      bestPosition: tally.best
    }
  })
  suggestions.sort(
    (a, b) =>
      b.citedPrompts - a.citedPrompts ||
      b.engines.length - a.engines.length ||
      (a.bestPosition ?? Infinity) - (b.bestPosition ?? Infinity) ||
      Number(b.source === 'tracked') - Number(a.source === 'tracked') ||
      a.url.localeCompare(b.url)
  )
  const totals = {
    checked: questions + keywords,
    cited: citing.size,
    noun: promptNoun(questions, keywords)
  }
  return {
    ...empty,
    suggestions,
    checkedPrompts: totals.checked,
    citedPrompts: totals.cited,
    noun: totals.noun,
    pick: targetPick(suggestions, totals)
  }
}

/** A candidate page as CiteFox AI reads it. */
export interface TargetCandidate {
  url: string
  title: string | null
  outline: readonly string[]
  /** "cited for 5 of 12 questions (Google 4, ChatGPT 3, best #1)", or "not cited yet". */
  cited: string
}

/** Cited pages first (most cited first), then the rest of the page list, at most {@link MAX_TARGET_CANDIDATES}. */
export function targetCandidates(
  ranked: TopicTargetSuggestions,
  pages: readonly TopicPageCandidate[],
  domain: string
): TargetCandidate[] {
  const out: TargetCandidate[] = []
  const seen = new Map<string, number>()
  const outlines = new Map<string, readonly string[]>()
  for (const page of pages) {
    const key = targetPageKey(page.url)
    if (key !== null && !outlines.has(key)) outlines.set(key, page.outline)
  }
  for (const item of ranked.suggestions) {
    const key = targetPageKey(item.url)
    if (key === null || seen.has(key)) continue
    seen.set(key, out.length)
    const engines = item.engines
      .map((engine) => `${ENGINE_SHORT_LABEL[engine.engine]} ${engine.prompts}`)
      .join(', ')
    const best = item.bestPosition === null ? '' : `, best #${item.bestPosition}`
    out.push({
      url: item.url,
      title: item.title,
      outline: outlines.get(key) ?? [],
      cited: `cited for ${item.citedPrompts} of ${ranked.checkedPrompts} ${ranked.noun} (${engines}${best})`
    })
  }
  for (const page of pages) {
    const url = resolveTargetPage(page.url, domain, true)
    const key = url === null ? null : targetPageKey(url)
    if (url === null || key === null || seen.has(key)) continue
    seen.set(key, out.length)
    out.push({ url, title: page.title, outline: page.outline, cited: 'not cited yet' })
  }
  return out.slice(0, MAX_TARGET_CANDIDATES)
}

/** The fenced page list: `url · title · headings · cited`, one per line. Exported for tests. */
export function targetCandidatesText(candidates: readonly TargetCandidate[]): string {
  if (candidates.length === 0) return fence('pages', 'No pages are known yet.')
  const lines = candidates.map((candidate) =>
    [
      candidate.url,
      candidate.title ?? '',
      candidate.outline.slice(0, 8).join(' | ') || 'no headings read',
      candidate.cited
    ]
      .map((part) => part.replace(/\s+/gu, ' ').trim())
      .join(' · ')
  )
  return fence('pages', lines.join('\n'))
}

export interface TargetReply {
  picks: { url: string; reason: string }[]
  newPage: { title: string; path: string; about: string } | null
}

/**
 * Asks again only when every pick is off the list (or one page is picked twice);
 * a single unlisted pick is dropped by {@link cleanTargetReply} instead.
 */
export function targetProblem(reply: TargetReply, listed: ReadonlySet<string>): string | null {
  const keys = reply.picks.map((pick) => targetPageKey(pick.url))
  if (keys.length > 0 && keys.every((key) => key === null || !listed.has(key)))
    return 'None of the picked pages is in the candidate list. Use only urls from the list, copied exactly, or leave picks empty.'
  if (new Set(keys).size < keys.length) return 'A page is picked twice. Pick each page once.'
  return null
}

/** Listed picks only, at most three; a new page only on the own site. */
export function cleanTargetReply(
  reply: TargetReply,
  candidates: readonly TargetCandidate[],
  domain: string
): Pick<SuggestTopicTargetResult, 'picks' | 'newPage' | 'dropped'> {
  const byKey = new Map(candidates.map((candidate) => [targetPageKey(candidate.url), candidate]))
  const picks: TopicTargetAiPick[] = []
  const used = new Set<string>()
  let dropped = 0
  for (const pick of reply.picks) {
    const key = targetPageKey(pick.url)
    const candidate = key === null ? undefined : byKey.get(key)
    if (candidate === undefined || key === null) {
      dropped += 1
      continue
    }
    if (used.has(key) || picks.length >= 3) continue
    used.add(key)
    picks.push({ url: candidate.url, title: candidate.title, reason: pick.reason.trim() })
  }
  const newUrl = reply.newPage === null ? null : resolveTargetPage(reply.newPage.path, domain)
  const newPage =
    reply.newPage === null || newUrl === null || targetPagePath(newUrl) === '/'
      ? null
      : {
          title: reply.newPage.title.trim(),
          path: targetPagePath(newUrl),
          about: reply.newPage.about.trim()
        }
  return { picks, newPage, dropped }
}

/** `topics:suggestTarget`: CiteFox AI picks from the project's pages. Spends no search. */
export async function suggestTopicTarget(
  env: TopicEnv,
  opened: OpenedProject,
  input: { topicId: string; marketId: string | null }
): Promise<SuggestTopicTargetResult> {
  const { db, project } = opened
  const ranked = topicTargetSuggestions(db, {
    projectId: project.id,
    topicId: input.topicId,
    marketId: input.marketId,
    domain: project.domain
  })
  const metas = topicPromptMetas(db, input.topicId, ranked.marketId)
  if (metas.length === 0)
    throw new TopicInputError(
      'This topic has no questions yet.',
      'Add questions to the topic first.'
    )
  const candidates = targetCandidates(
    ranked,
    pageCandidates(db, project.id).candidates,
    project.domain
  )
  const listed = new Set(
    candidates.map((candidate) => targetPageKey(candidate.url)).filter((key) => key !== null)
  )
  const topic = getPage(db, input.topicId, project.id)
  const reply = await runTopicTemplate<TargetReply>({
    host: env.host,
    db,
    projectId: project.id,
    pageId: input.topicId,
    kind: 'topic_target_suggest',
    channel: 'topics:suggestTarget',
    context: {
      topic: topic?.title ?? topic?.label ?? 'This topic',
      website: project.domain,
      questions: metas
        .slice(0, MAX_TARGET_QUESTIONS)
        .map(
          (meta) =>
            `${meta.stage === null ? (meta.kind === 'keyword' ? 'Keyword' : 'No stage') : TOPIC_STAGE_LABEL[meta.stage]} · ${meta.text}`
        )
        .join('\n'),
      pages: targetCandidatesText(candidates),
      market_block: topicMarketBlock(db, ranked.marketId),
      ...brandVars(readProjectProfile(db)?.brandNames ?? [])
    },
    check: (value) => targetProblem(value, listed)
  })
  return { ...cleanTargetReply(reply.value, candidates, project.domain), info: reply.info }
}
