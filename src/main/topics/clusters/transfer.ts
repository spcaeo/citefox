import { TOPIC_STAGE_LABEL } from '@shared/domain'
import type {
  BuyerPrompt,
  IntentStage,
  IntervalDays,
  Market,
  PageSummary,
  PromptSetView,
  TopicBands,
  TopicDraftPrompt,
  TopicStage
} from '@shared/domain'
import type { QuestionRef, SkippedQuestion } from '@shared/ipc'
import { normaliseQuestion } from '@shared/question-text'
import { pageKey } from '../../engine/host'
import { pageMarkets } from '../../engine/page-access'
import { getLatestBuyerProfile, getLatestPromptSet } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { getPage, MAX_PROMPT_COUNT, updateStoredPage } from '../../storage/pages'
import { insertPromptLineage } from '../../storage/prompt-lineage'
import { insertPromptSet, nextPromptSetVersion } from '../../storage/prompt-set-records'
import { readProjectProfile } from '../../storage/project-profile'
import { createDraft, saveDraft, TopicInputError } from '../drafts'
import type { OpenedProject, TopicEnv } from '../env'
import {
  cancelPendingTopicBatches,
  insertTopicPrompts,
  listTopicBatches,
  listTopicPrompts,
  type TopicPromptRecord
} from '../records'
import { holdIntervalCheck, writeTopic } from '../start'

/**
 * The move primitive behind `topics:moveQuestions`, merge and split (Docs/TOPICS-SPEC.md
 * §8.4). A question sits in one place. Moving it saves one new prompt-set version on
 * every page or topic it leaves and on every one it joins; the new prompt links back to
 * the old one in `prompt_lineage` (page id = where it went), so its earlier checks stay
 * its history on the Questions screen. A topic question keeps its stable key, its stage
 * and its target page. Nothing is searched.
 */

/** Same mapping as topics/start.ts: a topic stage to the prompt's intent column. */
const STAGE_TO_INTENT: Readonly<Record<TopicStage, IntentStage>> = {
  problem: 'problem',
  options: 'solution',
  doubts: 'objection',
  fit: 'solution',
  compare: 'comparison',
  decide: 'trigger'
}

/** A page prompt's intent as a topic stage (questions/reads.ts reads it the same way). */
const INTENT_TO_STAGE: Readonly<Partial<Record<IntentStage, TopicStage>>> = {
  problem: 'problem',
  solution: 'options',
  comparison: 'compare',
  objection: 'doubts',
  trigger: 'decide'
}

const UNMAPPED = 'Not mapped yet'
const PAGE_LABEL_MAX = 60

/** Settings a new topic copies (split copies the topic it splits). */
export interface TopicLike {
  seed: string
  marketIds: readonly string[]
  intervalDays: IntervalDays
  bands: TopicBands
}

export type ResolvedDestination =
  | { kind: 'topic'; page: PageSummary }
  | { kind: 'new'; name: string; seed: string; like: TopicLike | null }
  | { kind: 'page' }

export interface TransferResult {
  moved: number
  topicId: string | null
  /** Where each moved question went: old prompt id → new prompt id. */
  promptIds: { from: string; to: string }[]
  skipped: SkippedQuestion[]
  /** Topics left with no question, now removed. */
  emptied: string[]
}

interface Source {
  page: PageSummary
  active: PromptSetView
  rows: Map<string, TopicPromptRecord>
  moving: BuyerPrompt[]
}

interface Incoming {
  prompt: BuyerPrompt
  from: PageSummary
  row: TopicPromptRecord | null
  text: string
}

interface Target {
  page: PageSummary | null
  name: string
  texts: Set<string>
  count: number
  incoming: Incoming[]
}

export function brandsOf(db: SqliteDatabase): string[] {
  return [...(readProjectProfile(db)?.brandNames ?? [])]
}

function textOf(prompt: BuyerPrompt): string {
  return prompt.variants[0]?.text ?? prompt.label
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

export function questionsWord(count: number): string {
  return plural(count, 'question', 'questions')
}

/** The page or topic's name for a reason line. */
export function nameOf(page: PageSummary): string {
  return page.title ?? page.label ?? page.url ?? (page.kind === 'topic' ? 'the topic' : 'the page')
}

/** The stage a moved question carries: its topic row's, else what its intent stands for. */
function stageOf(item: Incoming): TopicStage | null {
  if (item.row !== null) return item.row.stage
  return INTENT_TO_STAGE[item.prompt.intentStage] ?? null
}

function existingTarget(db: SqliteDatabase, page: PageSummary, brands: readonly string[]): Target {
  const active = getLatestPromptSet(db, page.id, brands)
  const texts = new Set<string>()
  for (const prompt of active?.prompts ?? []) {
    for (const variant of prompt.variants) texts.add(normaliseQuestion(variant.text))
  }
  return { page, name: nameOf(page), texts, count: active?.prompts.length ?? 0, incoming: [] }
}

/** Reads every source and decides, per question, whether it moves and where to. */
function plan(
  env: TopicEnv,
  opened: OpenedProject,
  items: readonly QuestionRef[],
  destination: ResolvedDestination,
  brands: readonly string[]
): { sources: Source[]; targets: Map<string, Target>; skipped: SkippedQuestion[] } {
  const { db, project } = opened
  const skipped: SkippedQuestion[] = []
  const skipAll = (refs: readonly QuestionRef[], reason: string): void => {
    for (const ref of refs) skipped.push({ promptId: ref.promptId, reason })
  }
  const bySource = new Map<string, QuestionRef[]>()
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.promptId)) continue
    seen.add(item.promptId)
    bySource.set(item.sourceId, [...(bySource.get(item.sourceId) ?? []), item])
  }

  const targets = new Map<string, Target>()
  if (destination.kind === 'topic') {
    targets.set(destination.page.id, existingTarget(db, destination.page, brands))
  } else if (destination.kind === 'new') {
    targets.set('new', {
      page: null,
      name: destination.name,
      texts: new Set(),
      count: 0,
      incoming: []
    })
  }
  const targetFor = (item: Incoming): Target | string => {
    if (destination.kind === 'topic') {
      if (item.from.id === destination.page.id) return `Already in ${nameOf(destination.page)}.`
      return targets.get(destination.page.id) as Target
    }
    if (destination.kind === 'new') return targets.get('new') as Target
    if (item.from.kind !== 'topic') return 'Already not in a topic.'
    const pageId = item.row?.targetPageId ?? null
    const page = pageId === null ? null : getPage(db, pageId, project.id)
    if (page === null || page.kind === 'topic' || page.status === 'removed') {
      return 'It has no tracked target page to go back to. Set its target page first.'
    }
    const known = targets.get(page.id)
    if (known !== undefined) return known
    const fresh = existingTarget(db, page, brands)
    targets.set(page.id, fresh)
    return fresh
  }

  const sources: Source[] = []
  for (const [sourceId, refs] of bySource) {
    const page = getPage(db, sourceId, project.id)
    if (page === null) {
      skipAll(refs, 'That page or topic was not found.')
      continue
    }
    const noun = page.kind === 'topic' ? 'topic' : 'page'
    if (page.status === 'removed') {
      skipAll(refs, `That ${noun} is no longer tracked.`)
      continue
    }
    if (env.host.memory.drafts.has(pageKey(project.id, sourceId))) {
      skipAll(refs, `This ${noun} has unsaved prompt edits. Save or discard them first.`)
      continue
    }
    const active = getLatestPromptSet(db, sourceId, brands)
    if (active === null || active.promptSetId === null) {
      skipAll(refs, `This ${noun} has no saved questions.`)
      continue
    }
    const wanted = new Set(refs.map((ref) => ref.promptId))
    const found = active.prompts.filter((prompt) => wanted.has(prompt.id))
    const foundIds = new Set(found.map((prompt) => prompt.id))
    skipAll(
      refs.filter((ref) => !foundIds.has(ref.promptId)),
      'That question is an older version. Reload and try again.'
    )
    if (found.length === 0) continue
    if (noun === 'page' && found.length >= active.prompts.length) {
      skipAll(
        refs.filter((ref) => foundIds.has(ref.promptId)),
        'A page keeps at least one question. Move the others, or stop tracking the page.'
      )
      continue
    }
    const rows = new Map(listTopicPrompts(db, active.promptSetId).map((row) => [row.promptId, row]))
    const source: Source = { page, active, rows, moving: [] }
    for (const prompt of found) {
      const item: Incoming = { prompt, from: page, row: rows.get(prompt.id) ?? null, text: '' }
      item.text = textOf(prompt)
      const target = targetFor(item)
      if (typeof target === 'string') {
        skipped.push({ promptId: prompt.id, reason: target })
        continue
      }
      const key = normaliseQuestion(item.text)
      if (target.texts.has(key)) {
        skipped.push({
          promptId: prompt.id,
          reason: `The same question is already in ${target.name}.`
        })
        continue
      }
      if (target.count + 1 > MAX_PROMPT_COUNT) {
        skipped.push({
          promptId: prompt.id,
          reason: `${target.name} already holds ${MAX_PROMPT_COUNT} questions.`
        })
        continue
      }
      target.texts.add(key)
      target.count += 1
      target.incoming.push(item)
      source.moving.push(prompt)
    }
    if (source.moving.length > 0) sources.push(source)
  }
  return { sources, targets, skipped }
}

/** Moves the questions. One transaction: either every side is saved or none is. */
export function transfer(
  env: TopicEnv,
  opened: OpenedProject,
  items: readonly QuestionRef[],
  destination: ResolvedDestination
): TransferResult {
  const { db } = opened
  const brands = brandsOf(db)
  const planned = plan(env, opened, items, destination, brands)
  const result: TransferResult = {
    moved: 0,
    topicId: destination.kind === 'topic' ? destination.page.id : null,
    promptIds: [],
    skipped: planned.skipped,
    emptied: []
  }
  if (planned.sources.length === 0) return result
  db.transaction(() => {
    for (const [key, target] of planned.targets) {
      if (target.incoming.length === 0) continue
      if (key === 'new' && destination.kind === 'new') {
        result.topicId = writeNewTopic(env, opened, destination, target.incoming, brands, result)
      } else if (target.page !== null) {
        joinExisting(env, opened, target.page, target.incoming, brands, result)
      }
    }
    for (const source of planned.sources) leaveSource(env, opened, source, brands, result)
  })()
  return result
}

/** The variant per destination market: the same market's wording, else the first one's. */
function variantsFor(prompt: BuyerPrompt, markets: readonly Market[]): BuyerPrompt['variants'] {
  const first = prompt.variants[0]
  return markets.map((market) => {
    const same = prompt.variants.find((variant) => variant.marketId === market.id)
    return same === undefined
      ? {
          marketId: market.id,
          language: market.language,
          text: first?.text ?? prompt.label,
          originalText: null
        }
      : { ...same }
  })
}

function joinExisting(
  env: TopicEnv,
  opened: OpenedProject,
  page: PageSummary,
  incoming: readonly Incoming[],
  brands: readonly string[],
  result: TransferResult
): void {
  const { db, project } = opened
  const topic = page.kind === 'topic'
  const active = getLatestPromptSet(db, page.id, brands)
  const icpId = active?.icpId ?? getLatestBuyerProfile(db, page.id)?.id ?? null
  if (icpId === null) {
    throw new TopicInputError(`${nameOf(page)} has no buyer profile to save questions with.`)
  }
  const markets = pageMarkets(db, page.id)
  if (markets.length === 0) throw new TopicInputError(`${nameOf(page)} has no market.`)
  const now = env.host.now().toISOString()
  const carried = active?.prompts ?? []
  const ids = new Map(carried.map((prompt) => [prompt.id, `prompt-${env.host.createId()}`]))
  const added: BuyerPrompt[] = incoming.map((item, index) => {
    const stage = stageOf(item)
    return {
      id: `prompt-${env.host.createId()}`,
      position: carried.length + index + 1,
      label: topic
        ? item.text.slice(0, 160).trimEnd()
        : item.text.length <= PAGE_LABEL_MAX
          ? item.text
          : `${item.text.slice(0, PAGE_LABEL_MAX - 1).trimEnd()}…`,
      source: item.prompt.source,
      intentStage: stage === null ? item.prompt.intentStage : STAGE_TO_INTENT[stage],
      mappedElement: topic
        ? (stage === null ? 'Topic' : TOPIC_STAGE_LABEL[stage]).slice(0, 300)
        : UNMAPPED,
      enabled: item.prompt.enabled,
      variants: variantsFor(item.prompt, markets)
    }
  })
  const prompts: BuyerPrompt[] = [
    ...carried.map((prompt) => ({
      ...prompt,
      id: ids.get(prompt.id) ?? prompt.id,
      variants: prompt.variants.map((variant) => ({ ...variant }))
    })),
    ...added
  ]
  insertPromptSet(
    db,
    {
      id: `pset-${env.host.createId()}`,
      pageId: page.id,
      version: nextPromptSetVersion(db, page.id),
      savedAt: now,
      icpId,
      templateId: active?.templateId ?? null,
      templateName: active?.templateName ?? null,
      templateHash: active?.templateHash ?? null,
      templateUpdatedAt: active?.templateUpdatedAt ?? null,
      prompts
    },
    brands
  )
  insertPromptLineage(db, [
    ...carried.map((prompt) => ({
      promptId: ids.get(prompt.id) ?? prompt.id,
      previousPromptId: prompt.id,
      pageId: page.id,
      createdAt: now
    })),
    ...added.map((prompt, index) => ({
      promptId: prompt.id,
      previousPromptId: incoming[index]?.prompt.id ?? prompt.id,
      pageId: page.id,
      createdAt: now
    }))
  ])
  if (topic) {
    const previous = active?.promptSetId ? listTopicPrompts(db, active.promptSetId) : []
    // Only the active rows must differ: a key the topic had before (a question moved
    // out and back) is kept, so its earlier results join up again.
    const keys = new Set(previous.map((row) => row.stableKey))
    insertTopicPrompts(db, [
      ...previous.map((row) => ({ ...row, promptId: ids.get(row.promptId) ?? row.promptId })),
      ...added.map((prompt, index) => {
        const item = incoming[index] as Incoming
        const row = topicRowFor(env, item, page.id, prompt.id, stageOf(item))
        if (keys.has(row.stableKey)) row.stableKey = `tp-${env.host.createId()}`
        keys.add(row.stableKey)
        return row
      })
    ])
    updateStoredPage(db, page.id, project.id, {
      promptCount: Math.min(MAX_PROMPT_COUNT, prompts.length)
    })
  }
  incoming.forEach((item, index) => {
    const to = added[index]?.id
    if (to !== undefined) result.promptIds.push({ from: item.prompt.id, to })
  })
  result.moved += incoming.length
}

/** A moved question's topic row: its old row carried over, or one for a page's question. */
function topicRowFor(
  env: TopicEnv,
  item: Incoming,
  pageId: string,
  promptId: string,
  stage: TopicStage | null
): TopicPromptRecord {
  if (item.row !== null) return { ...item.row, promptId, pageId }
  const url = item.from.kind === 'topic' ? null : item.from.url
  return {
    promptId,
    pageId,
    stableKey: `tp-${env.host.createId()}`,
    kind: 'question',
    stage,
    source: 'user',
    sourceNote: null,
    kwGroup: null,
    kwGroupKind: null,
    intent: null,
    funnel: null,
    pageType: null,
    // A page's question keeps that page as the page that should be cited.
    targetPageId: url === null ? null : item.from.id,
    targetUrl: url,
    matchConfidence: null,
    matchReason: url === null ? null : 'The question was tracked for this page.',
    matchSetBy: url === null ? null : 'user',
    matchConfirmed: url !== null
  }
}

/** A new topic holding the moved questions, written the way Start writes one, unchecked. */
function writeNewTopic(
  env: TopicEnv,
  opened: OpenedProject,
  destination: Extract<ResolvedDestination, { kind: 'new' }>,
  incoming: readonly Incoming[],
  brands: readonly string[],
  result: TransferResult
): string {
  const { db, project } = opened
  const draft = createDraft(
    db,
    project,
    { projectId: project.id, path: 'questions', name: destination.name, seed: destination.seed },
    { now: () => env.host.now(), createId: () => env.host.createId() }
  )
  const marketIds = destination.like?.marketIds ?? [
    ...new Set(incoming.flatMap((item) => item.prompt.variants.map((variant) => variant.marketId)))
  ]
  const keys = new Set<string>()
  const prompts: TopicDraftPrompt[] = incoming.map((item) => {
    const row = topicRowFor(env, item, 'new', 'new', stageOf(item))
    if (keys.has(row.stableKey)) row.stableKey = `tp-${env.host.createId()}`
    keys.add(row.stableKey)
    return {
      id: row.stableKey,
      kind: row.kind,
      text: item.text,
      stage: row.stage,
      source: row.source,
      sourceNote: row.sourceNote,
      included: true,
      kwGroup: row.kwGroup,
      kwGroupKind: row.kwGroupKind,
      kwFamily: null,
      intent: row.intent,
      funnel: row.funnel,
      pageType: row.pageType,
      targetPageId: row.targetPageId,
      targetUrl: row.targetUrl,
      matchConfidence: row.matchConfidence,
      matchReason: row.matchReason,
      matchStatus:
        row.targetUrl === null
          ? 'unmatched'
          : row.matchConfirmed || row.matchSetBy === 'user'
            ? 'confirmed'
            : 'suggested',
      flags: [],
      overlapWith: [],
      mergedFrom: [],
      previousText: null
    }
  })
  const like = destination.like
  const filled = {
    ...draft,
    brandNames: brands,
    marketIds: marketIds.length > 0 ? marketIds : draft.marketIds,
    intervalDays: like?.intervalDays ?? draft.intervalDays,
    bands: like?.bands ?? draft.bands,
    prompts
  }
  const written = writeTopic(env, opened, filled, prompts, filled.intervalDays)
  const now = env.host.now()
  holdIntervalCheck(db, written.topicId, now, filled.intervalDays)
  saveDraft(
    db,
    { ...filled, topicId: written.topicId, startedAt: now.toISOString(), step: 'estimate' },
    now
  )
  const lineage = incoming.flatMap((item, index) => {
    const to = written.promptIds.get(prompts[index]?.id ?? '')
    return to === undefined ? [] : [{ from: item.prompt.id, to }]
  })
  insertPromptLineage(
    db,
    lineage.map((link) => ({
      promptId: link.to,
      previousPromptId: link.from,
      pageId: written.topicId,
      createdAt: now.toISOString()
    }))
  )
  result.promptIds.push(...lineage)
  result.moved += lineage.length
  return written.topicId
}

/** The page or topic the questions left: a new version without them, or removed when empty. */
function leaveSource(
  env: TopicEnv,
  opened: OpenedProject,
  source: Source,
  brands: readonly string[],
  result: TransferResult
): void {
  const { db, project } = opened
  const { page, active } = source
  const now = env.host.now().toISOString()
  const leaving = new Set(source.moving.map((prompt) => prompt.id))
  const keys = source.moving.flatMap((prompt) => {
    const key = source.rows.get(prompt.id)?.stableKey
    return key === undefined ? [] : [key]
  })
  if (page.kind === 'topic') dropPendingKeys(db, page.id, keys, now)
  const kept = active.prompts.filter((prompt) => !leaving.has(prompt.id))
  if (kept.length === 0) {
    updateStoredPage(db, page.id, project.id, { status: 'removed' })
    cancelPendingTopicBatches(db, page.id, now)
    result.emptied.push(page.id)
    return
  }
  const icpId = active.icpId ?? getLatestBuyerProfile(db, page.id)?.id ?? null
  if (icpId === null) {
    throw new TopicInputError(`${nameOf(page)} has no buyer profile to save questions with.`)
  }
  const ids = new Map(kept.map((prompt) => [prompt.id, `prompt-${env.host.createId()}`]))
  insertPromptSet(
    db,
    {
      id: `pset-${env.host.createId()}`,
      pageId: page.id,
      version: nextPromptSetVersion(db, page.id),
      savedAt: now,
      icpId,
      templateId: active.templateId,
      templateName: active.templateName,
      templateHash: active.templateHash,
      templateUpdatedAt: active.templateUpdatedAt,
      prompts: kept.map((prompt, index) => ({
        ...prompt,
        id: ids.get(prompt.id) ?? prompt.id,
        position: index + 1,
        variants: prompt.variants.map((variant) => ({ ...variant }))
      }))
    },
    brands
  )
  insertPromptLineage(
    db,
    kept.map((prompt) => ({
      promptId: ids.get(prompt.id) ?? prompt.id,
      previousPromptId: prompt.id,
      pageId: page.id,
      createdAt: now
    }))
  )
  const rows = [...source.rows.values()].flatMap((row) => {
    const next = ids.get(row.promptId)
    return next === undefined ? [] : [{ ...row, promptId: next }]
  })
  if (rows.length > 0) insertTopicPrompts(db, rows)
  if (page.kind === 'topic') {
    updateStoredPage(db, page.id, project.id, {
      promptCount: Math.min(MAX_PROMPT_COUNT, kept.length)
    })
  }
}

/** Waiting batches stop checking moved questions here; a batch left empty is cancelled. */
function dropPendingKeys(
  db: SqliteDatabase,
  pageId: string,
  keys: readonly string[],
  now: string
): void {
  if (keys.length === 0) return
  const gone = new Set(keys)
  const update = db.prepare('UPDATE topic_check_batches SET prompt_keys = ? WHERE id = ?')
  const cancel = db.prepare('UPDATE topic_check_batches SET cancelled_at = ? WHERE id = ?')
  for (const batch of listTopicBatches(db, pageId)) {
    if (batch.startedAt !== null || batch.cancelledAt !== null) continue
    if (!batch.promptKeys.some((key) => gone.has(key))) continue
    const left = batch.promptKeys.filter((key) => !gone.has(key))
    if (left.length === 0) cancel.run(now, batch.id)
    else update.run(JSON.stringify(left), batch.id)
  }
}
