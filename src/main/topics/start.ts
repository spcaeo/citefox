import { createHash } from 'node:crypto'
import {
  SEARCHES_PER_PROMPT_MAX,
  QUICK_INTERVAL_DAYS,
  SEARCHES_PER_PROMPT_MIN,
  TOPIC_PROFILE_SECTION_LABEL,
  TOPIC_STAGES,
  TOPIC_STAGE_LABEL
} from '@shared/domain'
import type {
  BuyerProfileBody,
  IntervalDays,
  BuyerPrompt,
  IntentStage,
  TopicDraft,
  TopicDraftPrompt,
  TopicProfilePoint,
  TopicStage
} from '@shared/domain'
import type {
  StartTopicRequest,
  StartTopicResult,
  TopicEstimate,
  TopicPlanOption,
  TopicStartPlan
} from '@shared/ipc'
import {
  addPageMarket,
  getPage,
  insertPage,
  listPageMarkets,
  replacePageMarkets,
  setPageMarketFirstCheckNotBefore,
  updateStoredPage
} from '../storage/pages'
import { productExists, setPageProduct } from '../storage/products'
import { getMarket } from '../storage/project-profile'
import { insertPromptSet, nextPromptSetVersion } from '../storage/prompt-set-records'
import { insertBuyerProfile, insertSnapshot } from '../storage/snapshot-records'
import { currentProfilePoints, saveDraft, searchesLeftFor, TopicInputError } from './drafts'
import type { SqliteDatabase } from '../storage/database'
import type { OpenedProject, TopicEnv } from './env'
import {
  insertTopicBatches,
  insertTopicPrompts,
  nextBatchNo,
  cancelPendingTopicBatches,
  upsertTopic,
  type TopicBatch
} from './records'
import { prefillTopicTargetPage } from './target-page'
import { topicTemplateId } from './templates'

/** Days the "rest over 7 days" plans spread over. */
export const STAGGER_DAYS = 7
/** Prompts checked today in the "N now" plan when the budget allows. */
export const STAGGER_TODAY = 10

const STAGE_TO_INTENT: Readonly<Record<TopicStage, IntentStage>> = {
  problem: 'problem',
  options: 'solution',
  doubts: 'objection',
  fit: 'solution',
  compare: 'comparison',
  decide: 'trigger'
}

type Scope = 'questions' | 'keywords' | 'both'

function scopeOf(draft: TopicDraft, requested: Scope | undefined): Scope {
  if (requested !== undefined) return requested
  return draft.generate
}

export function promptsInScope(draft: TopicDraft, scope: Scope): TopicDraftPrompt[] {
  return draft.prompts.filter(
    (prompt) =>
      prompt.included &&
      prompt.text.trim().length > 0 &&
      !prompt.flags.includes('brand') &&
      (scope === 'both' ||
        (scope === 'questions' ? prompt.kind === 'question' : prompt.kind === 'keyword'))
  )
}

/** Likeliest wins first: a confident target page, then any target, then journey order. */
export function likeliestOrder(prompts: readonly TopicDraftPrompt[]): TopicDraftPrompt[] {
  const stageIndex = (prompt: TopicDraftPrompt): number =>
    prompt.stage === null ? TOPIC_STAGES.length : TOPIC_STAGES.indexOf(prompt.stage)
  return [...prompts].sort((a, b) => {
    const score = (prompt: TopicDraftPrompt): number =>
      (prompt.targetUrl === null ? 0 : 40 + (prompt.matchConfidence ?? 50) * 0.5) +
      (prompt.matchStatus === 'confirmed' ? 5 : 0) +
      (prompt.kind === 'question' ? 3 : 0)
    return score(b) - score(a) || stageIndex(a) - stageIndex(b)
  })
}

function fitOf(
  searchesHi: number,
  searchesLo: number,
  left: number | null
): TopicPlanOption['fit'] {
  if (left === null) return 'unknown'
  if (searchesHi <= left) return 'fits'
  if (searchesLo <= left) return 'may_not_fit'
  return 'over_budget'
}

interface PlanChoice {
  today: TopicDraftPrompt[]
  rest: TopicDraftPrompt[]
}

/** Which prompts run today for a plan; the rest is spread over {@link STAGGER_DAYS} days. */
export function planChoice(
  plan: TopicStartPlan,
  prompts: readonly TopicDraftPrompt[],
  markets: number,
  left: number | null,
  first: { stage: TopicStage | null; group: string | null }
): PlanChoice {
  const perPromptHi = Math.max(1, markets) * SEARCHES_PER_PROMPT_MAX
  switch (plan) {
    case 'all_now':
      return { today: [...prompts], rest: [] }
    case 'stagger': {
      const count = Math.min(prompts.length, STAGGER_TODAY)
      return { today: prompts.slice(0, count), rest: prompts.slice(count) }
    }
    case 'stage_first': {
      const today = prompts.filter((prompt) =>
        first.group !== null
          ? prompt.kwGroup === first.group
          : prompt.stage === (first.stage ?? 'problem')
      )
      const ids = new Set(today.map((prompt) => prompt.id))
      return { today, rest: prompts.filter((prompt) => !ids.has(prompt.id)) }
    }
    case 'likeliest': {
      const ordered = likeliestOrder(prompts)
      const affordable = left === null ? STAGGER_TODAY : Math.floor(left / perPromptHi)
      const count = Math.max(1, Math.min(ordered.length, affordable))
      return { today: ordered.slice(0, count), rest: ordered.slice(count) }
    }
  }
}

function firstStage(prompts: readonly TopicDraftPrompt[]): TopicStage | null {
  for (const stage of TOPIC_STAGES)
    if (prompts.some((prompt) => prompt.stage === stage)) return stage
  return null
}

function firstGroup(prompts: readonly TopicDraftPrompt[]): string | null {
  return prompts.find((prompt) => prompt.kwGroup !== null)?.kwGroup ?? null
}

function renewsOn(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return next.toISOString().slice(0, 10)
}

function shortDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00.000Z`)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** `topics:estimate`: searches per plan against what is left this month. Spends nothing. */
export function estimateTopic(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  requested?: Scope
): TopicEstimate {
  const scope = scopeOf(draft, requested)
  const prompts = promptsInScope(draft, scope)
  const markets = Math.max(1, draft.marketIds.length)
  const left = searchesLeftFor(env.host.storage, opened.db, opened.project.id, env.host.now())
  const lo = prompts.length * markets * SEARCHES_PER_PROMPT_MIN
  const hi = prompts.length * markets * SEARCHES_PER_PROMPT_MAX
  const stage = firstStage(prompts)
  const group = scope === 'keywords' ? firstGroup(prompts) : null
  const renew = renewsOn(env.host.now())
  const option = (
    plan: TopicStartPlan,
    label: string,
    detail: (today: number, todayLo: number, todayHi: number, rest: number) => string
  ): TopicPlanOption => {
    const choice = planChoice(plan, prompts, markets, left, { stage, group })
    const todayLo = choice.today.length * markets * SEARCHES_PER_PROMPT_MIN
    const todayHi = choice.today.length * markets * SEARCHES_PER_PROMPT_MAX
    return {
      plan,
      label,
      detail: detail(choice.today.length, todayLo, todayHi, choice.rest.length),
      todayPrompts: choice.today.length,
      todaySearchesLo: todayLo,
      todaySearchesHi: todayHi,
      restDays: choice.rest.length === 0 ? 0 : STAGGER_DAYS,
      fit: fitOf(todayHi, todayLo, left),
      suggested: false,
      firstStage: plan === 'stage_first' && group === null ? stage : null,
      firstGroup: plan === 'stage_first' ? group : null
    }
  }
  const plans: TopicPlanOption[] = [
    option('likeliest', "CiteFox AI's plan: likeliest wins first", (n, a, b, rest) =>
      rest === 0
        ? `All ${n} today (about ${a}–${b} searches)`
        : `${n} today (about ${a}–${b} searches), the rest over 7 days`
    ),
    option(
      'stage_first',
      'Check one stage first',
      (n, a, b) =>
        `${group ?? (stage === null ? 'First stage' : TOPIC_STAGE_LABEL[stage])} · ${n} ${scope === 'keywords' ? 'keywords' : 'questions'} · ${a}–${b} searches`
    ),
    option(
      'stagger',
      `${Math.min(STAGGER_TODAY, prompts.length)} now, the rest over 7 days`,
      (n, a, b) => `${n} today (${a}–${b} searches), then a batch each day`
    ),
    option('all_now', 'Check all now', (n, a, b) => `All ${n} today · ${a}–${b} searches`)
  ]
  const suggestedPlan =
    plans.find((item) => item.plan === 'all_now' && item.fit === 'fits')?.plan ?? 'likeliest'
  const withSuggestion = plans.map((item) => ({ ...item, suggested: item.plan === suggestedPlan }))
  const targets = prompts.filter((prompt) => prompt.targetUrl !== null).length
  return {
    draftId: draft.id,
    scope,
    questions: prompts.filter((prompt) => prompt.kind === 'question').length,
    keywords: prompts.filter((prompt) => prompt.kind === 'keyword').length,
    stages: new Set(prompts.map((prompt) => prompt.stage).filter((value) => value !== null)).size,
    groups: new Set(prompts.map((prompt) => prompt.kwGroup).filter((value) => value !== null)).size,
    markets,
    prompts: prompts.length,
    searchesLo: lo,
    searchesHi: hi,
    searchesLeft: left,
    renewsOn: renew,
    plans: withSuggestion,
    recheck: QUICK_INTERVAL_DAYS.map((days) => ({
      intervalDays: days,
      monthlyLo: Math.round((lo * 30) / days),
      monthlyHi: Math.round((hi * 30) / days)
    })),
    targets: { set: targets, noPage: prompts.length - targets },
    note:
      left !== null && hi > left
        ? `Anything that doesn't fit waits for ${shortDate(renew)}. Nothing is lost.`
        : null
  }
}

/**
 * The topic's profile points as a page buyer profile. A topic profile may have no
 * "who" or "environment" points; those parts fall back to the segments, the topic's
 * about line or its name so the saved profile never holds an empty part.
 */
export function profileBodyFrom(
  points: readonly TopicProfilePoint[],
  topic: { name: string; about: string }
): BuyerProfileBody {
  const of = (section: TopicProfilePoint['section']): TopicProfilePoint[] =>
    points.filter((point) => point.section === section && point.text.trim().length > 0)
  const segments = of('segments')
  const who =
    of('who')
      .map((point) => point.text)
      .join(' ') ||
    segments.map((point) => point.text).join(', ') ||
    `Buyers looking into ${topic.name}`
  const environment =
    of('environment')
      .map((point) => point.text)
      .join('\n') ||
    topic.about.trim() ||
    `Not described yet for ${topic.name}.`
  return {
    who,
    environment,
    segments: segments.map((point) => ({ name: point.text, reason: point.foundIn ?? '' })),
    triggers: of('triggers').map((point) => point.text),
    values: of('values').map((point) => point.text),
    poorFit: of('poor_fit').map((point) => ({ name: point.text, reason: point.foundIn ?? '' }))
  }
}

function definitionText(draft: TopicDraft): string {
  const points = currentProfilePoints(draft)
  const profile = points.map(
    (point) => `${TOPIC_PROFILE_SECTION_LABEL[point.section]}: ${point.text}`
  )
  return [
    `Topic: ${draft.name || draft.seed}`,
    `Seed: ${draft.seed}`,
    draft.about ? `About: ${draft.about}` : '',
    ...profile
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The product picked on the Seed step (Docs/PROMPT-AUDIT.md PC): pinned on the topic's
 * page row. Not picked, or a product deleted since: automatic (inferred from the seed).
 */
function pinTopicProduct(
  db: SqliteDatabase,
  topicId: string,
  productId: string | null | undefined
): void {
  const known = productId === null || (productId !== undefined && productExists(db, productId))
  setPageProduct(db, topicId, known ? (productId ?? null) : null, known)
}

/**
 * Writes the topic: the topic page (`kind = 'topic'`, no URL), its markets, the
 * `topics` row, a snapshot holding the topic's definition (checks need one), the
 * buyer profile, a new prompt set with every included prompt, and `topic_prompts`.
 * Returns the topic id and the prompt id for each draft prompt id.
 */
export function writeTopic(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  prompts: readonly TopicDraftPrompt[],
  intervalDays: IntervalDays,
  options: { allowEmpty?: boolean } = {}
): { topicId: string; promptSetId: string; promptIds: Map<string, string> } {
  const { db, project } = opened
  const now = env.host.now().toISOString()
  if (prompts.length === 0 && options.allowEmpty !== true)
    throw new TopicInputError('Include at least one question or keyword.')
  const marketIds = draft.marketIds.filter((id) => getMarket(db, id) !== null)
  if (marketIds.length === 0)
    throw new TopicInputError('Pick a market first.', 'Open Project settings and add a market.')
  const name = (draft.name || draft.seed).trim().slice(0, 300)
  if (name.length === 0) throw new TopicInputError('Give the topic a name.')
  const topicId = draft.topicId ?? `topic-${env.host.createId()}`
  const promptIds = new Map<string, string>()
  let promptSetId = ''
  const write = db.transaction(() => {
    const existing = getPage(db, topicId, project.id)
    if (existing === null) {
      insertPage(db, {
        id: topicId,
        projectId: project.id,
        url: null,
        kind: 'topic',
        title: name,
        label: name.slice(0, 80).trimEnd(),
        folder: null,
        status: 'tracked',
        setupStep: null,
        intervalDays,
        samples: 1,
        // At least 1 (a schema rule); an empty topic is told apart by having no prompt set.
        promptCount: Math.max(1, Math.min(1000, prompts.length)),
        defaultMarketId: marketIds[0] ?? null,
        pinned: false,
        score: null,
        promptSetVersion: null
      })
      for (const marketId of marketIds)
        addPageMarket(db, { pageId: topicId, marketId, addedAt: now, baselineRunId: null })
    } else {
      updateStoredPage(db, topicId, project.id, {
        title: name,
        label: name.slice(0, 80).trimEnd(),
        intervalDays,
        promptCount: Math.max(1, Math.min(1000, prompts.length)),
        defaultMarketId: marketIds[0] ?? null,
        status: existing.status === 'removed' ? 'tracked' : existing.status
      })
      replacePageMarkets(db, topicId, marketIds, now)
    }
    upsertTopic(db, {
      pageId: topicId,
      seed: draft.seed || name,
      source: draft.path,
      competitorUrl: draft.competitorUrl,
      website: draft.website || null,
      about: draft.about || null,
      generate: draft.generate,
      depth: draft.depth as unknown as Record<string, unknown>,
      bands: draft.bands,
      draftId: draft.id,
      createdAt: now,
      updatedAt: now
    })
    pinTopicProduct(db, topicId, draft.productId)
    prefillTopicTargetPage(db, {
      topicId,
      productId: draft.productId,
      domain: project.domain,
      now
    })
    const body = definitionText(draft)
    const snapshotId = `snap-${env.host.createId()}`
    insertSnapshot(db, {
      id: snapshotId,
      pageId: topicId,
      fetchedAt: now,
      method: 'file',
      httpStatus: null,
      durationMs: 0,
      title: name.slice(0, 300),
      metaDescription: null,
      h1: null,
      canonical: null,
      publishedAt: null,
      modifiedAt: null,
      outline: [],
      faqs: [],
      h2Count: 0,
      h3Count: 0,
      tableCount: 0,
      bodyText: body,
      wordCount: body.split(/\s+/u).filter(Boolean).length,
      contentHash: createHash('sha256').update(body).digest('hex'),
      summary: null
    })
    const version =
      draft.profile?.versions.find((item) => item.version === draft.profile?.current) ?? null
    const profileId = `icp-${env.host.createId()}`
    const templateId = version?.templateId ?? topicTemplateId('topic_buyer_profile')
    insertBuyerProfile(db, {
      id: profileId,
      pageId: topicId,
      snapshotId,
      ...profileBodyFrom(version?.points ?? [], { name, about: draft.about }),
      templateId,
      templateName: (version?.templateName ?? 'CiteFox default').slice(0, 80).trimEnd(),
      templateHash:
        version?.templateHash ?? createHash('sha256').update('topic profile').digest('hex'),
      templateUpdatedAt: null,
      createdAt: now,
      promptsStale: false
    })
    // An empty topic ("+ New empty topic") has its profile but no prompt set
    // yet: + Add → Questions writes its first version.
    if (prompts.length === 0) return
    const buyerPrompts: BuyerPrompt[] = prompts.map((prompt, index) => {
      const id = `prompt-${env.host.createId()}`
      promptIds.set(prompt.id, id)
      return {
        id,
        position: index + 1,
        label: prompt.text.slice(0, 160).trimEnd(),
        source: 'written_by_user',
        intentStage: prompt.stage === null ? 'unset' : STAGE_TO_INTENT[prompt.stage],
        mappedElement: (
          prompt.kwGroup ?? (prompt.stage === null ? 'Topic' : TOPIC_STAGE_LABEL[prompt.stage])
        ).slice(0, 300),
        enabled: true,
        variants: marketIds.map((marketId) => ({
          marketId,
          language: getMarket(db, marketId)?.language ?? 'en',
          text: prompt.text,
          originalText: null
        }))
      }
    })
    promptSetId = `pset-${env.host.createId()}`
    insertPromptSet(
      db,
      {
        id: promptSetId,
        pageId: topicId,
        version: nextPromptSetVersion(db, topicId),
        savedAt: now,
        icpId: profileId,
        templateId: null,
        templateName: null,
        templateHash: null,
        templateUpdatedAt: null,
        prompts: buyerPrompts
      },
      draft.brandNames
    )
    insertTopicPrompts(
      db,
      prompts.map((prompt) => ({
        promptId: promptIds.get(prompt.id) ?? '',
        pageId: topicId,
        stableKey: prompt.id,
        kind: prompt.kind,
        stage: prompt.stage,
        source: prompt.source,
        sourceNote: prompt.sourceNote,
        kwGroup: prompt.kwGroup,
        kwGroupKind: prompt.kwGroupKind,
        intent: prompt.intent,
        funnel: prompt.funnel,
        pageType: prompt.pageType,
        targetPageId: prompt.targetPageId,
        targetUrl: prompt.targetUrl,
        matchConfidence: prompt.matchConfidence,
        matchReason: prompt.matchReason,
        matchSetBy:
          prompt.matchStatus === 'unmatched'
            ? null
            : prompt.matchStatus === 'confirmed'
              ? 'user'
              : 'claude',
        matchConfirmed: prompt.matchStatus === 'confirmed'
      }))
    )
  })
  write()
  return { topicId, promptSetId, promptIds }
}

/** Batches for the prompts that wait: one per day for {@link STAGGER_DAYS} days. */
export function planBatches(
  env: TopicEnv,
  topicId: string,
  keys: readonly string[],
  marketIds: readonly string[],
  firstBatchNo: number
): TopicBatch[] {
  if (keys.length === 0) return []
  const perDay = Math.ceil(keys.length / STAGGER_DAYS)
  const out: TopicBatch[] = []
  const now = env.host.now().getTime()
  for (let day = 1, index = 0; index < keys.length; day += 1, index += perDay) {
    out.push({
      id: `batch-${env.host.createId()}`,
      pageId: topicId,
      batchNo: firstBatchNo + out.length,
      marketIds,
      promptKeys: keys.slice(index, index + perDay),
      dueAt: new Date(now + day * 24 * 60 * 60 * 1000).toISOString(),
      jobId: null,
      startedAt: null,
      cancelledAt: null
    })
  }
  return out
}

/** `topics:start`: writes the topic, starts today's check job and plans the rest. */
export async function startTopic(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  request: StartTopicRequest
): Promise<StartTopicResult> {
  const scope = scopeOf(draft, request.scope)
  const prompts = promptsInScope(draft, scope)
  const intervalDays = request.intervalDays ?? draft.intervalDays
  const written = writeTopic(env, opened, draft, prompts, intervalDays)
  const left = searchesLeftFor(env.host.storage, opened.db, opened.project.id, env.host.now())
  const choice = planChoice(request.plan, prompts, draft.marketIds.length, left, {
    stage: request.stage ?? firstStage(prompts),
    group: request.group ?? null
  })
  holdIntervalCheck(opened.db, written.topicId, env.host.now(), intervalDays)
  cancelPendingTopicBatches(opened.db, written.topicId, env.host.now().toISOString())
  const batches = planBatches(
    env,
    written.topicId,
    choice.rest.map((prompt) => prompt.id),
    draft.marketIds,
    nextBatchNo(opened.db, written.topicId)
  )
  insertTopicBatches(opened.db, batches)
  saveDraft(
    opened.db,
    {
      ...draft,
      topicId: written.topicId,
      startedAt: env.host.now().toISOString(),
      step: 'estimate',
      intervalDays
    },
    env.host.now()
  )
  let jobId: string | null = null
  let message = 'The topic is saved.'
  let nextStep: string | null = null
  if (env.checks === null) {
    nextStep = 'Run Check now when the check engine is ready.'
  } else if (choice.today.length > 0) {
    const everything = choice.rest.length === 0 && choice.today.length === prompts.length
    // The job id is chosen here and the check runs on: Start returns at once and
    // the screen follows `checks:progress` (a refused job is stored with its reason).
    const id = `job-${env.host.createId()}`
    jobId = id
    void env.checks
      .start({
        projectId: opened.project.id,
        pageIds: [written.topicId],
        marketIds: draft.marketIds,
        promptIds: everything
          ? null
          : choice.today.map((prompt) => written.promptIds.get(prompt.id) ?? '').filter(Boolean),
        reason: 'manual',
        jobId: id
      })
      .catch((error: unknown) => {
        env.host.logger.error('topic check could not start', error)
      })
    message =
      batches.length === 0
        ? `Checking ${choice.today.length} ${choice.today.length === 1 ? 'prompt' : 'prompts'} now.`
        : `Checking ${choice.today.length} now; ${choice.rest.length} more over the next ${batches.length} days.`
  }
  return {
    topicId: written.topicId,
    promptSetId: written.promptSetId,
    jobId,
    batches: batches.map((batch) => ({
      batchNo: batch.batchNo,
      dueAt: batch.dueAt,
      prompts: batch.promptKeys.length
    })),
    message,
    nextStep
  }
}

/**
 * Start runs only what it was asked for: the first job now and the planned
 * batches. The topic's own interval check is held until one interval after
 * Start (SCH-12 hold) for every market not checked yet, so a launch, a due pass
 * or a failed first job never adds a full check of every prompt. Once a check
 * finishes, `last_checked_at` drives the interval as for any page.
 */
export function holdIntervalCheck(
  db: SqliteDatabase,
  topicId: string,
  now: Date,
  intervalDays: number
): void {
  const notBefore = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString()
  for (const market of listPageMarkets(db, topicId)) {
    const checked = db
      .prepare<unknown[], { last_checked_at: string | null }>(
        'SELECT last_checked_at FROM page_markets WHERE page_id = ? AND market_id = ?'
      )
      .get(topicId, market.marketId)
    if (checked?.last_checked_at === null || checked === undefined) {
      setPageMarketFirstCheckNotBefore(db, topicId, market.marketId, notBefore)
    }
  }
}
