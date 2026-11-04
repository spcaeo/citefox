import { randomUUID } from 'node:crypto'
import type { ProjectProduct, TopicStage } from '@shared/domain'
import type {
  QuestionRef,
  SortCandidate,
  SortProposal,
  SortQuestionsRequest,
  SortQuestionsResult,
  SuggestTopicNameRequest,
  SuggestTopicNameResult,
  SuggestTopicsRequest,
  SuggestTopicsResult,
  TopicCallInfo,
  TopicIdea,
  TopicIdeaQuestion
} from '@shared/ipc'
import { normalizeUrl } from '../../engine/checks/url'
import { competitorContext } from '../../engine/competitor-context'
import { aiLimiter, mapEach } from '../../engine/parallel'
import {
  businessBlock,
  buyerBlock,
  buyerFromPageProfile,
  competitorBlock,
  fence,
  stageRules
} from '../../prompts/blocks'
import { readActivePrompts } from '../../questions/reads'
import type { SqliteDatabase } from '../../storage/database'
import { listPagesOfKind } from '../../storage/pages'
import { listProducts } from '../../storage/products'
import { readProjectProfile } from '../../storage/project-profile'
import { getLatestBuyerProfile } from '../../storage/snapshot-records'
import { bullets, runTopicTemplate, topicStepLabel } from '../claude'
import { TopicInputError } from '../drafts'
import { brandVars, type OpenedProject, type TopicEnv } from '../env'
import { listTopics } from '../records'
import { productsAbout } from '../seed-ideas'
import { marketBlockFor } from '../step-blocks'
import { pageCandidates } from '../steps-pages'
import { namesBrand } from '../text'
import { askOnce } from '../topic-context'

/**
 * Claude steps of Topics and clusters (Docs/TOPICS-SPEC.md §8). Each reads saved data
 * only (no SerpApi search) and changes nothing: the screens apply the replies. Code
 * checks every reply: the brand never reaches a name or question, ids and URLs come
 * from the lists the prompt sent, and a tracked topic is never suggested again.
 */

/** Topic ideas one Suggest asks for. */
export const IDEA_COUNT = 4
/** Starter questions kept per idea. */
export const MAX_IDEA_QUESTIONS = 12
/** A topic name's length on screen. */
export const TOPIC_NAME_MAX = 80
/** Own pages listed for `fitsUrl`. */
const OWN_PAGES_SENT = 40
/** Products whose competitors are listed. */
const PRODUCTS_SENT = 4
/** Questions sorted per Claude call. */
export const SORT_BATCH = 60

export const NO_SAVED_DATA_MESSAGE =
  'Add your products or track a page of your site first (Fill from my website), then suggest topics.'

const NO_NEW_IDEAS_MESSAGE =
  'CiteFox AI only suggested topics you already track or have seen. Try Suggest others.'

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

interface ProjectContext {
  brandNames: readonly string[]
  marketId: string | null
  products: ProjectProduct[]
  businessBlock: string
}

function projectContext(opened: OpenedProject): ProjectContext {
  const profile = readProjectProfile(opened.db)
  const brandNames = profile?.brandNames ?? []
  const products = listProducts(opened.db)
  const domain = opened.project.domain
  return {
    brandNames,
    marketId: profile?.market.id ?? null,
    products,
    businessBlock: businessBlock({
      domain,
      summary: productsAbout(domain, products),
      brandNames
    })
  }
}

/** Every tracked topic as a sort candidate: its name and the buyer problem it holds. */
function trackedTopics(opened: OpenedProject): SortCandidate[] {
  const records = new Map(listTopics(opened.db).map((record) => [record.pageId, record]))
  return listPagesOfKind(opened.db, opened.project.id, 'topic').flatMap((page) => {
    const record = records.get(page.id)
    if (record === undefined) return []
    return [{ id: page.id, name: page.title ?? record.seed, situation: record.seed }]
  })
}

interface PickedQuestion {
  ref: QuestionRef
  text: string
}

/** The requested questions that are still active, in request order, each once. */
export function pickedQuestions(
  db: SqliteDatabase,
  marketId: string | null,
  items: readonly QuestionRef[]
): PickedQuestion[] {
  const key = (sourceId: string, promptId: string): string => `${sourceId}\u0000${promptId}`
  const active = new Map(
    readActivePrompts(db, marketId).map((prompt) => [key(prompt.pageId, prompt.id), prompt.text])
  )
  const seen = new Set<string>()
  const out: PickedQuestion[] = []
  for (const ref of items) {
    const id = key(ref.sourceId, ref.promptId)
    const text = active.get(id)
    if (text === undefined || seen.has(id)) continue
    seen.add(id)
    out.push({ ref: { sourceId: ref.sourceId, promptId: ref.promptId }, text })
  }
  return out
}

/** One line, trailing full stop dropped, cut at a word to {@link TOPIC_NAME_MAX}. */
export function cleanTopicName(value: string | null | undefined): string {
  const line = (value ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.\s]+$/u, '')
  if (line.length <= TOPIC_NAME_MAX) return line
  const cut = line.slice(0, TOPIC_NAME_MAX + 1)
  const space = cut.lastIndexOf(' ')
  return (space > TOPIC_NAME_MAX / 2 ? cut.slice(0, space) : cut.slice(0, TOPIC_NAME_MAX))
    .replace(/[\s,;:–-]+$/u, '')
    .trim()
}

const nameKey = (name: string): string => cleanTopicName(name).toLowerCase()

/** The info of a step that needed no call (nothing to sort). */
function noCallInfo(env: TopicEnv, opened: OpenedProject): TopicCallInfo {
  return {
    label: topicStepLabel(env.host, opened.project.id, 'topic_cluster_sort'),
    durationMs: 0,
    model: null,
    searchesUsed: 0
  }
}

// ---------------------------------------------------------------------------
// topics:suggestTopics
// ---------------------------------------------------------------------------

interface SuggestReply {
  ideas: {
    name: string
    situation: string
    example: string
    questions: { text: string; stage: TopicStage }[]
    fitsUrl: string | null
  }[]
}

export interface IdeaRules {
  brandNames: readonly string[]
  /** The own-site URLs the prompt listed; `fitsUrl` must be one of them. */
  ownUrls: readonly string[]
  /** Names of tracked topics and of ideas already shown. */
  taken: readonly string[]
  createId?: () => string
}

/**
 * The ideas to show: brand-free questions (a question naming the brand is dropped),
 * no tracked or already-shown name, `fitsUrl` only when it is a listed own page, at
 * most {@link IDEA_COUNT}, each with at least one question.
 */
export function cleanIdeas(reply: SuggestReply, rules: IdeaRules): TopicIdea[] {
  const createId = rules.createId ?? randomUUID
  const urls = new Map(rules.ownUrls.map((url) => [normalizeUrl(url) ?? url, url]))
  const taken = new Set(rules.taken.map(nameKey))
  const out: TopicIdea[] = []
  for (const idea of reply.ideas) {
    const name = cleanTopicName(idea.name)
    const key = name.toLowerCase()
    if (name.length === 0 || namesBrand(name, rules.brandNames) || taken.has(key)) continue
    const questions = ideaQuestions(idea.questions, rules.brandNames)
    if (questions.length === 0) continue
    taken.add(key)
    const fits = idea.fitsUrl === null ? null : (normalizeUrl(idea.fitsUrl) ?? idea.fitsUrl)
    const example = idea.example.trim()
    out.push({
      id: `idea-${createId()}`,
      name,
      situation: idea.situation.trim(),
      example: example.length > 0 && !namesBrand(example, rules.brandNames) ? example : name,
      questions,
      fitsUrl: fits === null ? null : (urls.get(fits) ?? null)
    })
    if (out.length === IDEA_COUNT) break
  }
  return out
}

function ideaQuestions(
  questions: SuggestReply['ideas'][number]['questions'],
  brandNames: readonly string[]
): TopicIdeaQuestion[] {
  const seen = new Set<string>()
  const out: TopicIdeaQuestion[] = []
  for (const question of questions) {
    const text = question.text.replace(/\s+/gu, ' ').trim()
    const key = text.toLowerCase()
    if (text.length === 0 || seen.has(key) || namesBrand(text, brandNames)) continue
    seen.add(key)
    out.push({ text, stage: question.stage })
  }
  return out.slice(0, MAX_IDEA_QUESTIONS)
}

/**
 * What to tell Claude once when a reply breaks the rules code enforces: a name or
 * question naming the brand, or nothing left to show once tracked and already-shown
 * topics are dropped. A few repeats among new ideas are dropped without asking again.
 */
export function suggestProblem(reply: SuggestReply, rules: IdeaRules): string | null {
  const branded = reply.ideas.some(
    (idea) =>
      namesBrand(idea.name, rules.brandNames) ||
      idea.questions.some((question) => namesBrand(question.text, rules.brandNames))
  )
  if (branded) return 'Some names or questions name the brand. Write them without it.'
  if (cleanIdeas(reply, { ...rules, createId: () => '' }).length > 0) return null
  return `Every idea repeats a tracked topic or one already shown: ${reply.ideas
    .map((idea) => idea.name)
    .join('; ')}. Suggest different buyer problems.`
}

/** Competitors per saved product (else the whole business), with the market in the prompt. */
function competitorsText(db: SqliteDatabase, products: readonly ProjectProduct[]): string {
  if (products.length === 0) {
    return competitorBlock(competitorContext(db, {}), { withRule: false })
  }
  return products
    .slice(0, PRODUCTS_SENT)
    .map(
      (product) =>
        `${product.name}:\n${competitorBlock(competitorContext(db, { productId: product.id }), {
          withRule: false
        })}`
    )
    .join('\n\n')
}

/** The newest buyer profile of a tracked page, else a plain "none saved". */
function savedBuyerBlock(opened: OpenedProject): string {
  for (const page of listPagesOfKind(opened.db, opened.project.id, 'page')) {
    if (page.status !== 'tracked' && page.status !== 'paused') continue
    const profile = getLatestBuyerProfile(opened.db, page.id)
    if (profile !== null) return buyerBlock(buyerFromPageProfile(profile))
  }
  return 'No buyer profile saved yet.'
}

export async function suggestTopics(
  env: TopicEnv,
  opened: OpenedProject,
  request: SuggestTopicsRequest
): Promise<SuggestTopicsResult> {
  const ctx = projectContext(opened)
  const pages = pageCandidates(opened.db, opened.project.id).candidates.slice(0, OWN_PAGES_SENT)
  if (ctx.products.length === 0 && pages.length === 0) {
    return { ideas: [], info: null, message: NO_SAVED_DATA_MESSAGE }
  }
  const existing = trackedTopics(opened).map((topic) => topic.name)
  const avoid = (request.avoid ?? []).map((name) => name.trim()).filter(Boolean)
  const rules: IdeaRules = {
    brandNames: ctx.brandNames,
    ownUrls: pages.map((page) => page.url),
    taken: [...existing, ...avoid]
  }
  const reply = await runTopicTemplate<SuggestReply>({
    host: env.host,
    db: opened.db,
    projectId: opened.project.id,
    pageId: null,
    kind: 'topic_cluster_suggest',
    channel: 'topics:suggestTopics',
    context: {
      business_block: ctx.businessBlock,
      market_block: marketBlockFor(opened.db, ctx.marketId),
      products: bullets(
        ctx.products.map(
          (product) =>
            `${product.name}.${product.job ? ` Job: ${product.job}.` : ''}${product.buyer ? ` Buyer: ${product.buyer}.` : ''}`
        )
      ),
      competitors: competitorsText(opened.db, ctx.products),
      buyer_block: savedBuyerBlock(opened),
      own_pages: fence(
        'page_text',
        pages.map((page) => `${page.url} · ${page.title ?? 'untitled'}`).join('\n')
      ),
      existing_topics: bullets(existing),
      avoid: bullets(avoid),
      count: IDEA_COUNT,
      stage_rules: stageRules(),
      ...brandVars(ctx.brandNames)
    },
    check: askOnce((value) => suggestProblem(value, rules))
  })
  const ideas = cleanIdeas(reply.value, rules)
  return {
    ideas,
    info: reply.info,
    message: ideas.length === 0 ? NO_NEW_IDEAS_MESSAGE : null
  }
}

// ---------------------------------------------------------------------------
// topics:sortQuestions
// ---------------------------------------------------------------------------

interface SortReply {
  proposals: { id: string; topicId: string | null; newTopic: string | null; reason: string }[]
}

export interface SortBatch {
  /** `q<n>` → the question it stands for. */
  questions: ReadonlyMap<string, PickedQuestion>
  /** `t<n>` → the candidate topic id it stands for. */
  topics: ReadonlyMap<string, string>
  allowNew: boolean
  brandNames: readonly string[]
}

/**
 * One proposal per question of the batch, in its order. A topic id the prompt did not
 * list becomes null; a new topic name only when new topics are allowed and no listed
 * topic was picked, and never one naming the brand. A question Claude skipped gets null.
 */
export function cleanProposals(reply: SortReply, batch: SortBatch): SortProposal[] {
  const byId = new Map(reply.proposals.map((proposal) => [proposal.id.trim(), proposal]))
  return [...batch.questions].map(([id, question]) => {
    const proposal = byId.get(id)
    const topicId =
      proposal?.topicId === null || proposal?.topicId === undefined
        ? null
        : (batch.topics.get(proposal.topicId.trim()) ?? null)
    const name = cleanTopicName(proposal?.newTopic)
    const newTopic =
      batch.allowNew && topicId === null && name.length > 0 && !namesBrand(name, batch.brandNames)
        ? name
        : null
    return {
      sourceId: question.ref.sourceId,
      promptId: question.ref.promptId,
      text: question.text,
      topicId,
      newTopic,
      reason: proposal?.reason.trim() || 'No topic was proposed for this question.'
    }
  })
}

/** What to tell Claude once when a reply skips a question or invents a topic id. */
export function sortProblem(reply: SortReply, batch: SortBatch): string | null {
  const answered = new Set(reply.proposals.map((proposal) => proposal.id.trim()))
  const missing = [...batch.questions.keys()].filter((id) => !answered.has(id))
  if (missing.length > 0)
    return `Write a proposal for every question; missing: ${missing.join(', ')}.`
  const unknown = reply.proposals.filter(
    (proposal) => proposal.topicId !== null && !batch.topics.has(proposal.topicId.trim())
  )
  if (unknown.length > 0) {
    return `Use only the listed topic ids, else null; not listed: ${unknown
      .map((proposal) => proposal.topicId)
      .join(', ')}.`
  }
  return null
}

const NEW_TOPIC_ALLOWED =
  'when no listed topic fits, a short name for a new topic (at most 80 characters, the buyer problem in their words); null when a listed topic fits.'
const NEW_TOPIC_NOT_ALLOWED = 'always null; a question no listed topic fits gets topicId null.'

export async function sortQuestions(
  env: TopicEnv,
  opened: OpenedProject,
  request: SortQuestionsRequest
): Promise<SortQuestionsResult> {
  const ctx = projectContext(opened)
  const picked = pickedQuestions(opened.db, ctx.marketId, request.items)
  const candidates = request.candidates ?? trackedTopics(opened)
  const allowNew = request.allowNew ?? true
  const topics = new Map(candidates.map((candidate, index) => [`t${index + 1}`, candidate.id]))
  const batches: SortBatch[] = []
  for (let start = 0; start < picked.length; start += SORT_BATCH) {
    const slice = picked.slice(start, start + SORT_BATCH)
    batches.push({
      questions: new Map(slice.map((question, index) => [`q${start + index + 1}`, question])),
      topics,
      allowNew,
      brandNames: ctx.brandNames
    })
  }
  if (batches.length === 0 || (candidates.length === 0 && !allowNew)) {
    const none = batches.flatMap((batch) => cleanProposals({ proposals: [] }, batch))
    return { proposals: none, info: noCallInfo(env, opened) }
  }
  const candidateLines = candidates.map(
    (candidate, index) =>
      `t${index + 1} · ${line(candidate.name)}: ${line(candidate.situation) || 'no situation saved'}`
  )
  // Batches of questions are sorted side by side ("Calls at once"), kept in batch order.
  const limiter = aiLimiter(env.host.settings().claudeConcurrency)
  const replies = await mapEach(batches, limiter, (batch) =>
    runTopicTemplate<SortReply>({
      host: env.host,
      db: opened.db,
      projectId: opened.project.id,
      pageId: null,
      kind: 'topic_cluster_sort',
      channel: 'topics:sortQuestions',
      context: {
        business_block: ctx.businessBlock,
        candidates: fence(
          'pasted',
          candidateLines.length === 0 ? 'No topics listed.' : candidateLines.join('\n')
        ),
        questions: fence(
          'pasted',
          [...batch.questions].map(([id, question]) => `${id} · ${line(question.text)}`).join('\n')
        ),
        new_topic_rule: allowNew ? NEW_TOPIC_ALLOWED : NEW_TOPIC_NOT_ALLOWED,
        ...brandVars(ctx.brandNames)
      },
      check: askOnce((value) => sortProblem(value, batch))
    })
  )
  const proposals = replies.flatMap((reply, index) => {
    const batch = batches[index]
    return batch === undefined ? [] : cleanProposals(reply.value, batch)
  })
  const infos = replies.map((reply) => reply.info)
  return { proposals, info: combinedInfo(infos) ?? noCallInfo(env, opened) }
}

/** One info for several calls of a step: the first label, the summed time, any notice. */
function combinedInfo(infos: readonly TopicCallInfo[]): TopicCallInfo | null {
  const first = infos[0]
  if (first === undefined) return null
  const notice = infos.find((info) => info.notice !== undefined)?.notice
  return {
    ...first,
    durationMs: infos.reduce((sum, info) => sum + info.durationMs, 0),
    ...(notice === undefined ? {} : { notice })
  }
}

/** Text on one prompt line. */
function line(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

// ---------------------------------------------------------------------------
// topics:suggestName
// ---------------------------------------------------------------------------

interface NameReply {
  name: string
  situation: string
}

export async function suggestTopicName(
  env: TopicEnv,
  opened: OpenedProject,
  request: SuggestTopicNameRequest
): Promise<SuggestTopicNameResult> {
  const ctx = projectContext(opened)
  const picked = pickedQuestions(opened.db, ctx.marketId, request.items)
  if (picked.length === 0) {
    throw new TopicInputError('None of the picked questions are tracked any more.')
  }
  const reply = await runTopicTemplate<NameReply>({
    host: env.host,
    db: opened.db,
    projectId: opened.project.id,
    pageId: null,
    kind: 'topic_cluster_name',
    channel: 'topics:suggestName',
    context: {
      business_block: ctx.businessBlock,
      market_block: marketBlockFor(opened.db, ctx.marketId),
      questions: fence('pasted', bullets(picked.map((question) => line(question.text)))),
      ...brandVars(ctx.brandNames)
    },
    check: askOnce((value) =>
      namesBrand(value.name, ctx.brandNames)
        ? 'The name names the brand. Name the buyer problem without it.'
        : null
    )
  })
  return {
    name: cleanTopicName(reply.value.name),
    situation: line(reply.value.situation),
    info: reply.info
  }
}
