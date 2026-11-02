import { TOPIC_STAGES } from '@shared/domain'
import type { TopicDraft, TopicDraftPrompt, TopicStage } from '@shared/domain'
import type {
  GenerateTopicQuestionsRequest,
  JourneyGapsResult,
  RewriteTopicQuestionRequest,
  TopicPromptSuggestion,
  TopicPromptSuggestions
} from '@shared/ipc'
import { questionTotal } from '@shared/topic-depth'
import type { CompetitorContext, NamedCompetitor } from '../engine/competitor-context'
import { competitorBlock, fence, modeRules, productBlock, stageRules } from '../prompts/blocks'
import {
  JOURNEY_COMPARE_NO_COMPETITORS,
  JOURNEY_STAGE_FOCUS,
  QUESTIONS_DISCOVER_MODE_RULES
} from './bodies/journey'
import { runTopicTemplate } from './claude'
import { currentProfilePoints, newDraftPrompt, saveDraft, TopicInputError } from './drafts'
import { brandVars, questionsText, type OpenedProject, type TopicEnv } from './env'
import {
  checkStageQuestions,
  COMPETITOR_STAGES,
  competitorsIn,
  shortfallProblem,
  type StageCheckResult,
  type StageQuestionReply
} from './journey-checks'
import { assignBuyers, buyersText, journeyBuyers, overusedSoftware } from './journey-buyers'
import { namesBrand, overlapPairs } from './text'
import { askOnce, topicBuyerBlock, topicCompetitors, topicMarketBlock } from './topic-context'

/**
 * Journey questions (Docs/PROMPT-AUDIT.md, P3 items 3 to 5): one call per stage, in
 * parallel within the Claude concurrency; more questions with one action per call;
 * and the context for cleaning up pasted questions.
 */

/** Most questions one stage call writes; a larger stage takes several calls in turn. */
export const JOURNEY_CALL_MAX = 25

interface QuestionReply {
  stage: TopicStage
  text: string
  replaces?: string | null
  reason?: string | null
}

// ---------------------------------------------------------------------------
// Stage context
// ---------------------------------------------------------------------------

/** Direct and partial competitors, the ones a question may name. */
export function nameable(context: CompetitorContext): NamedCompetitor[] {
  return [...context.direct, ...context.partial]
}

/**
 * `{{ competitor_block }}` for one stage. Compare and decide get the topic's
 * competitors (contract C1) with the competitor rule. The other stages name no
 * company: they get only what buyers used before and the tools they use now.
 */
export function stageCompetitorBlock(stage: TopicStage, context: CompetitorContext): string {
  const list = (items: readonly string[], none: string): string =>
    items.length > 0 ? items.join(', ') : none
  const software = `${SENDING_SOFTWARE_LABEL}: ${list(context.integrations, 'none noted')}.`
  if (COMPETITOR_STAGES.has(stage)) {
    const block = competitorBlock(context)
      .split('\n')
      .map((line) => (line.startsWith('Tools used with it') ? software : line))
      .join('\n')
    return nameable(context).length === 0 ? `${block}\n${JOURNEY_COMPARE_NO_COMPETITORS}` : block
  }
  return [
    `What buyers used before (a replaced or discontinued option they may name as what stopped working, never as something to choose): ${list(context.switchingFrom, 'none noted')}.`,
    software,
    'Name no competitor or product to buy in this stage.'
  ].join('\n')
}

/** How integrations are shown to the journey: they send the emails; they are not gateways. */
export const SENDING_SOFTWARE_LABEL =
  'Software that sends the emails or alerts (never a gateway, never a competitor)'

/** `{{ stage_rules }}` for one stage: its definition, then what its questions do. */
export function journeyStageRules(stage: TopicStage): string {
  return `${stageRules([stage])}\n${JOURNEY_STAGE_FOCUS[stage]}`
}

// ---------------------------------------------------------------------------
// Journey questions: one call per stage
// ---------------------------------------------------------------------------

/** What one stage produced, for the draft and for the smoke's per-stage lines. */
export interface StageRun {
  stage: TopicStage
  asked: number
  kept: { text: string; competitorNamed: string | null; namedTool: string | null }[]
  /** Why questions were dropped: from a reply that was asked again, then the reply kept. */
  dropped: StageCheckResult['dropped'][]
  durationMs: number
  error: string | null
}

/** What every stage call of one run shares. */
interface StageShared {
  context: CompetitorContext
  market: string
  product: string
  existing: readonly string[]
}

/** One stage call's own part: its buyers, one per question, and software it must not name. */
interface StageAsk {
  buyers: readonly string[]
  bannedTools: readonly string[]
}

async function writeStage(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  stage: TopicStage,
  count: number,
  shared: StageShared,
  own: StageAsk
): Promise<StageRun> {
  const started = Date.now()
  const kept: StageRun['kept'] = []
  const dropped: StageRun['dropped'] = []
  const competitors = nameable(shared.context)
  const competitorText = stageCompetitorBlock(stage, shared.context)
  // A stage over JOURNEY_CALL_MAX takes several calls in turn, each told what is taken.
  // A stage still short after its retry gets one top-up call for just the missing ones:
  // compare and decide lose the most to the checks, and they carry the competitor names.
  let topUps = 0
  while (kept.length < count) {
    const ask = Math.min(JOURNEY_CALL_MAX, count - kept.length)
    const taken = kept.map((item) => item.text)
    const buyers = own.buyers.slice(kept.length, kept.length + ask)
    const check = (replies: readonly StageQuestionReply[]): StageCheckResult =>
      checkStageQuestions(replies, {
        stage,
        brands: draft.brandNames,
        competitors,
        switchingFrom: shared.context.switchingFrom,
        existing: [...shared.existing, ...taken],
        integrations: shared.context.integrations,
        bannedTools: own.bannedTools
      })
    const notes = [
      ...(own.bannedTools.length > 0
        ? [
            `These are named in enough questions already; name none of them: ${own.bannedTools.join(', ')}.`
          ]
        : []),
      ...(taken.length > 0
        ? [
            `Already written for this stage (write different situations):\n${taken.map((text) => `- ${text}`).join('\n')}`
          ]
        : [])
    ]
    const reply = await runTopicTemplate<{ questions: StageQuestionReply[] }>({
      host: env.host,
      db: opened.db,
      projectId: opened.project.id,
      pageId: draft.topicId,
      kind: 'topic_journey_questions',
      channel: 'topics:generateQuestions',
      context: {
        seed: draft.seed,
        stage,
        count: ask,
        product_block: shared.product,
        market_block: shared.market,
        buyer_block: topicBuyerBlock(draft, TOPIC_STAGES.indexOf(stage)),
        buyers: buyersText(buyers),
        stage_rules: journeyStageRules(stage),
        competitor_block: competitorText,
        instruction: notes.join('\n'),
        // A project's own older body asks for counts per stage: this call writes one.
        counts: `${stage}: ${ask}`,
        ...brandVars(draft.brandNames)
      },
      check: askOnce((value) => {
        // The top-up is one call: it keeps what passes rather than asking yet again.
        if (topUps > 0) return null
        const first = check(value.questions)
        const problem = shortfallProblem(first, ask)
        if (problem !== null) dropped.push(first.dropped)
        return problem
      })
    })
    const result = check(reply.value.questions)
    dropped.push(result.dropped)
    const fresh = result.kept.slice(0, ask)
    kept.push(...fresh)
    if (fresh.length < ask) {
      if (topUps >= 1) break
      topUps += 1
    }
  }
  return { stage, asked: count, kept, dropped, durationMs: Date.now() - started, error: null }
}

function overlapFlags(prompts: readonly TopicDraftPrompt[]): TopicDraftPrompt[] {
  const questions = prompts.filter((prompt) => prompt.kind === 'question')
  const pairs = overlapPairs(questions.map((prompt) => ({ id: prompt.id, text: prompt.text })))
  const partners = new Map<string, string[]>()
  for (const pair of pairs) {
    partners.set(pair.a, [...(partners.get(pair.a) ?? []), pair.b])
    partners.set(pair.b, [...(partners.get(pair.b) ?? []), pair.a])
  }
  return prompts.map((prompt) => {
    if (prompt.kind !== 'question') return prompt
    const overlapWith = partners.get(prompt.id) ?? []
    const flags = prompt.flags.filter((flag) => flag !== 'overlap')
    return { ...prompt, overlapWith, flags: overlapWith.length > 0 ? [...flags, 'overlap'] : flags }
  })
}

/** Called with each stage's run, for the live smoke's per-stage lines. */
let onStageRun: ((run: StageRun) => void) | null = null

/** Sets the per-stage listener (the live smoke and tests); returns the previous one. */
export function setStageRunListener(
  listener: ((run: StageRun) => void) | null
): ((run: StageRun) => void) | null {
  const previous = onStageRun
  onStageRun = listener
  return previous
}

/**
 * Software named in more than three questions (the stages run apart, so they cannot
 * see each other): the questions over the cap are taken out, and each stage that lost
 * some writes them again once, naming none of that software, for buyers whose own
 * line does not name it. Changes `runs` in place.
 */
async function capSoftware(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  runs: StageRun[],
  shared: StageShared,
  buyers: readonly string[]
): Promise<void> {
  const all = runs.flatMap((run) =>
    run.kept.map((item) => ({ stage: run.stage, text: item.text, namedTool: item.namedTool }))
  )
  const { tools, over } = overusedSoftware(all)
  if (over.length === 0) return
  const drop = new Set(over.map((item) => `${item.stage}\u0000${item.text}`))
  const free = buyers.filter((buyer) => !namesBrand(buyer, tools))
  const retries = runs.map(async (run) => {
    const before = run.kept.length
    run.kept = run.kept.filter((item) => !drop.has(`${run.stage}\u0000${item.text}`))
    const missing = before - run.kept.length
    if (missing === 0) return
    const started = Date.now()
    try {
      const again = await writeStage(
        env,
        opened,
        draft,
        run.stage,
        missing,
        { ...shared, existing: [...shared.existing, ...all.map((item) => item.text)] },
        {
          buyers: Array.from(
            { length: missing },
            (_, index) => free[(index + before) % Math.max(1, free.length)] ?? ''
          ).filter((buyer) => buyer.length > 0),
          bannedTools: tools
        }
      )
      run.kept.push(...again.kept)
      run.dropped.push(...again.dropped)
    } catch (error) {
      env.host.logger.warn('topic journey stage rewrite failed', {
        stage: run.stage,
        message: error instanceof Error ? error.message : 'failed'
      })
    }
    run.durationMs += Date.now() - started
  })
  await Promise.all(retries)
}

/**
 * `topics:generateQuestions`: one call per stage with questions asked for, all
 * started at once (the shared Claude gate runs them within the concurrency), each
 * with only its own stage's rules. Compare and decide get the topic's competitors.
 * A stage that fails keeps the others; the step fails only when every stage does.
 */
export async function generateQuestions(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  request: GenerateTopicQuestionsRequest
): Promise<TopicDraft> {
  const total = questionTotal(draft.depth.questions)
  if (total === 0) throw new TopicInputError('Pick how many questions to write.')
  const others =
    request.replace === false
      ? draft.prompts
      : draft.prompts.filter(
          (prompt) => !(prompt.kind === 'question' && prompt.source === 'claude')
        )
  const context = topicCompetitors(opened, draft)
  const shared = {
    context,
    market: topicMarketBlock(opened, draft),
    product: productBlock(context.product),
    existing: others.filter((prompt) => prompt.kind === 'question').map((prompt) => prompt.text)
  }
  const perStage = draft.depth.questions.perStage
  const stages = TOPIC_STAGES.filter((stage) => perStage[stage] > 0)
  const buyers = journeyBuyers(currentProfilePoints(draft))
  const assigned = assignBuyers(buyers, perStage)
  const settled = await Promise.allSettled(
    stages.map((stage) =>
      writeStage(env, opened, draft, stage, perStage[stage], shared, {
        buyers: assigned[stage],
        bannedTools: []
      })
    )
  )
  const runs: StageRun[] = settled.map((result, index) => {
    const stage = stages[index] as TopicStage
    if (result.status === 'fulfilled') return result.value
    const message = result.reason instanceof Error ? result.reason.message : 'failed'
    return { stage, asked: perStage[stage], kept: [], dropped: [], durationMs: 0, error: message }
  })
  await capSoftware(env, opened, draft, runs, shared, buyers)
  for (const run of runs) onStageRun?.(run)
  const failed = settled.find((result) => result.status === 'rejected')
  if (failed !== undefined && runs.every((run) => run.kept.length === 0)) {
    throw (failed as PromiseRejectedResult).reason
  }
  for (const run of runs.filter((item) => item.error !== null)) {
    env.host.logger.warn('topic journey stage failed', { stage: run.stage, message: run.error })
  }
  const added = runs.flatMap((run) =>
    run.kept.map((item) =>
      newDraftPrompt(
        { kind: 'question', text: item.text, stage: run.stage, source: 'claude' },
        `tq-${env.host.createId()}`,
        draft.brandNames
      )
    )
  )
  const next: TopicDraft = {
    ...draft,
    step: draft.step === 'profile' || draft.step === 'seed' ? 'questions' : draft.step,
    prompts: overlapFlags([...others, ...added])
  }
  return saveDraft(opened.db, next, env.host.now())
}

// ---------------------------------------------------------------------------
// More questions: discover, gaps and rewrite, one action per call
// ---------------------------------------------------------------------------

function suggestion(
  env: TopicEnv,
  item: QuestionReply,
  replacesIds: ReadonlySet<string>
): TopicPromptSuggestion {
  return {
    id: `qs-${env.host.createId()}`,
    kind: 'question',
    text: item.text.trim(),
    stage: item.stage,
    kwGroup: null,
    kwGroupKind: null,
    kwFamily: null,
    intent: null,
    funnel: null,
    pageType: null,
    reason: item.reason ?? null,
    replacesId:
      item.replaces !== null && item.replaces !== undefined && replacesIds.has(item.replaces)
        ? item.replaces
        : null
  }
}

/** Drops replies that name the brand or, outside compare and decide, a competitor. */
function keepable(
  items: readonly QuestionReply[],
  brands: readonly string[],
  competitors: readonly NamedCompetitor[]
): { kept: QuestionReply[]; dropped: number } {
  const kept = items.filter(
    (item) =>
      !namesBrand(item.text, brands) &&
      (COMPETITOR_STAGES.has(item.stage) || competitorsIn(item.text, competitors).length === 0)
  )
  return { kept, dropped: items.length - kept.length }
}

async function questionsAssist(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  input: {
    mode: 'discover' | 'gaps' | 'rewrite'
    stage: TopicStage | null
    count: number
    ids?: readonly string[]
    instruction?: string | null
    channel: string
  }
): Promise<{
  suggestions: TopicPromptSuggestion[]
  dropped: number
  gaps: { stage: TopicStage; note: string }[]
  info: TopicPromptSuggestions['info']
}> {
  const context = topicCompetitors(opened, draft)
  const withCompetitors =
    input.mode === 'rewrite' || (input.stage !== null && COMPETITOR_STAGES.has(input.stage))
  const segments =
    input.mode === 'gaps' && draft.segments.length > 0
      ? `\nSegments the user picked: ${draft.segments.join(', ')}.`
      : ''
  const reply = await runTopicTemplate<{
    questions: QuestionReply[]
    gaps: { stage: TopicStage; note: string }[]
  }>({
    host: env.host,
    db: opened.db,
    projectId: opened.project.id,
    pageId: draft.topicId,
    kind: 'topic_questions_discover',
    channel: input.channel,
    context: {
      seed: draft.seed,
      mode: input.mode,
      stage: input.stage ?? 'all',
      count: input.count,
      market_block: topicMarketBlock(opened, draft),
      buyer_block: topicBuyerBlock(draft),
      competitor_block: withCompetitors
        ? stageCompetitorBlock(input.stage ?? 'compare', context)
        : '',
      questions: questionsText(draft, input.ids),
      mode_rules:
        modeRules(QUESTIONS_DISCOVER_MODE_RULES, input.mode) +
        (input.mode === 'discover' && input.stage !== null
          ? `\n${journeyStageRules(input.stage)}`
          : '') +
        segments,
      instruction: input.instruction ? `The user asks: ${input.instruction}` : '',
      ...brandVars(draft.brandNames)
    }
  })
  const ids = new Set(draft.prompts.map((prompt) => prompt.id))
  const stageOf = new Map(draft.prompts.map((prompt) => [prompt.id, prompt.stage]))
  // The call's stage is known: discover writes for it; rewrite keeps each question's own.
  const replies =
    input.mode === 'gaps'
      ? []
      : reply.value.questions.map((item) => ({
          ...item,
          stage:
            input.mode === 'discover' && input.stage !== null
              ? input.stage
              : ((item.replaces ? stageOf.get(item.replaces) : null) ?? item.stage)
        }))
  const { kept, dropped } = keepable(replies, draft.brandNames, nameable(context))
  return {
    suggestions: kept.slice(0, Math.max(input.count, 1)).map((item) => suggestion(env, item, ids)),
    dropped,
    gaps: reply.value.gaps,
    info: reply.info
  }
}

export async function discoverStageQuestions(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  stage: TopicStage,
  count: number
): Promise<TopicPromptSuggestions> {
  const result = await questionsAssist(env, opened, draft, {
    mode: 'discover',
    stage,
    count,
    channel: 'topics:discoverStageQuestions'
  })
  return {
    draftId: draft.id,
    suggestions: result.suggestions,
    droppedForBrand: result.dropped,
    info: result.info
  }
}

/** Gaps written per stage when the journey gaps are filled. */
const QUESTIONS_PER_GAP_STAGE = 2

/**
 * `topics:findJourneyGaps`: one call finds the gaps (gaps only), then one discover
 * call per stage with a gap writes the questions that fill it, in parallel. Overlaps
 * are computed in code.
 */
export async function findJourneyGaps(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft
): Promise<JourneyGapsResult> {
  const found = await questionsAssist(env, opened, draft, {
    mode: 'gaps',
    stage: null,
    count: 6,
    channel: 'topics:findJourneyGaps'
  })
  const notesByStage = new Map<TopicStage, string[]>()
  for (const gap of found.gaps) {
    notesByStage.set(gap.stage, [...(notesByStage.get(gap.stage) ?? []), gap.note])
  }
  const fills = await Promise.allSettled(
    [...notesByStage.entries()].map(([stage, notes]) =>
      questionsAssist(env, opened, draft, {
        mode: 'discover',
        stage,
        count: Math.min(QUESTIONS_PER_GAP_STAGE, notes.length),
        instruction: `Fill ${notes.length === 1 ? 'this gap' : 'these gaps'}: ${notes.join('; ')}.`,
        channel: 'topics:findJourneyGaps'
      })
    )
  )
  const suggestions = fills.flatMap((fill) =>
    fill.status === 'fulfilled' ? fill.value.suggestions : []
  )
  const questions = draft.prompts.filter((prompt) => prompt.kind === 'question')
  const overlaps = overlapPairs(
    questions.map((prompt) => ({ id: prompt.id, text: prompt.text }))
  ).map((pair) => ({
    a: pair.a,
    b: pair.b,
    reason: `${Math.round(pair.score * 100)}% of the words are the same`
  }))
  const gapNotes = found.gaps.map((gap) => gap.note).join('; ')
  const headline = `${found.gaps.length} ${found.gaps.length === 1 ? 'gap' : 'gaps'}, ${overlaps.length} overlapping ${overlaps.length === 1 ? 'pair' : 'pairs'}.${gapNotes ? ` ${gapNotes}.` : ''}`
  return {
    draftId: draft.id,
    gaps: found.gaps,
    overlaps,
    suggestions,
    headline,
    info: found.info
  }
}

export async function rewriteQuestion(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  request: RewriteTopicQuestionRequest
): Promise<TopicPromptSuggestions> {
  const known = new Set(draft.prompts.map((prompt) => prompt.id))
  const ids = request.promptIds.filter((id) => known.has(id))
  if (ids.length === 0) throw new TopicInputError('Pick the questions to rewrite.')
  const result = await questionsAssist(env, opened, draft, {
    mode: 'rewrite',
    stage: null,
    count: ids.length,
    ids,
    instruction: request.instruction,
    channel: 'topics:rewriteQuestion'
  })
  return {
    draftId: draft.id,
    suggestions: result.suggestions,
    droppedForBrand: result.dropped,
    info: result.info
  }
}

// ---------------------------------------------------------------------------
// Clean-up of pasted questions (the step lives in `./steps-keywords.ts`)
// ---------------------------------------------------------------------------

/** The variables `topic_questions_cleanup` needs: every stage defined, the market, the lines fenced. */
export function cleanupContext(
  opened: OpenedProject,
  draft: TopicDraft,
  questions: readonly Pick<TopicDraftPrompt, 'id' | 'text'>[]
): Record<string, string> {
  return {
    topic: draft.name || draft.seed,
    market_block: topicMarketBlock(opened, draft),
    stage_rules: stageRules(),
    questions: fence(
      'pasted',
      questions.map((prompt) => `${prompt.id} · ${prompt.text.replace(/\s+/gu, ' ')}`).join('\n')
    ),
    ...brandVars(draft.brandNames)
  }
}
