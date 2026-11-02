import {
  DEFAULT_TOPIC_BANDS,
  SEARCHES_PER_PROMPT_MAX,
  SEARCHES_PER_PROMPT_MIN,
  TOPIC_PROFILE_SECTIONS
} from '@shared/domain'
import type {
  TopicDraft,
  TopicDraftPrompt,
  TopicDraftSummary,
  TopicProfilePoint,
  TopicProfileState,
  TopicWizardPath,
  TopicWizardStep
} from '@shared/domain'
import type {
  CreateTopicDraftRequest,
  TopicDraftPatch,
  TopicDraftPromptInput,
  TopicKeywordSummary,
  TopicProfilePointInput
} from '@shared/ipc'
import {
  keywordDepthPreset,
  normalizeKeywordDepth,
  normalizePerStage,
  questionDepthPreset
} from '@shared/topic-depth'
import { searchesLeft } from '../connection-status'
import { usageMonth } from '../keys/present'
import type { SqliteDatabase } from '../storage/database'
import { withCountedSearches } from '../storage/key-usage'
import { getPage } from '../storage/pages'
import { readPageProductRow } from '../storage/products'
import { readProjectProfile } from '../storage/project-profile'
import { readProjectSchedule, readProjectScheduleCap } from '../storage/project-schedule'
import { listApiKeys, type ProjectRecord } from '../storage/records'
import { projectUsedForMonth } from '../engine/checks/key-rotation'
import type { AppStorage } from '../storage/app-storage'
import { promptFlags } from './text'
import { discardDraftRow, getTopic, listDraftRows, readDraftRow, saveDraftRow } from './records'
import { activePromptSetId } from './results'
import { listTopicPrompts } from './records'

/** Thrown for a request that names a draft, topic or prompt the project does not have. */
export class TopicInputError extends Error {
  readonly nextStep: string | null
  constructor(message: string, nextStep: string | null = null) {
    super(message)
    this.name = 'TopicInputError'
    this.nextStep = nextStep
  }
}

const FIRST_STEP: Readonly<Record<TopicWizardPath, TopicWizardStep>> = {
  seed: 'seed',
  questions: 'import',
  competitor: 'competitor'
}

export interface DraftDeps {
  now: () => Date
  createId: () => string
}

/** `topics:createDraft`: a draft filled from the project (brand, competitors, default market). */
export function createDraft(
  db: SqliteDatabase,
  project: ProjectRecord,
  request: CreateTopicDraftRequest,
  deps: DraftDeps
): TopicDraft {
  const profile = readProjectProfile(db)
  const now = deps.now().toISOString()
  const seed = (request.seed ?? '').trim().slice(0, 500)
  const draft: TopicDraft = {
    id: `draft-${deps.createId()}`,
    projectId: project.id,
    path: request.path,
    step: FIRST_STEP[request.path],
    topicId: null,
    name: (request.name ?? seed).trim().slice(0, 120),
    seed,
    otherSeeds: [],
    website: project.domain,
    about: '',
    generate: 'questions',
    depth: { questions: questionDepthPreset('standard'), keywords: keywordDepthPreset('standard') },
    bands: DEFAULT_TOPIC_BANDS,
    marketIds: profile?.market === undefined || profile === null ? [] : [profile.market.id],
    brandNames: profile?.brandNames ?? [],
    competitors: profile?.competitors ?? [],
    segments: [],
    switchingFrom: profile?.switchingFrom ?? [],
    integrations: profile?.integrations ?? [],
    profile: null,
    prompts: [],
    keywordTerms: [],
    importSource: null,
    importStats: null,
    competitorUrl: null,
    competitorPage: null,
    competitorClaims: [],
    // The project's "Re-check every" (setup step 7 sets it; 7 days when never set).
    intervalDays: readProjectSchedule(db, project.id).defaultIntervalDays,
    createdAt: now,
    updatedAt: now,
    startedAt: null
  }
  if (request.topicId !== undefined) fillFromTopic(db, project, draft, request.topicId)
  saveDraftRow(db, draft)
  return draft
}

/** Edit topic: the draft takes the topic's settings, prompts and targets. */
function fillFromTopic(
  db: SqliteDatabase,
  project: ProjectRecord,
  draft: TopicDraft,
  topicId: string
): void {
  const page = getPage(db, topicId, project.id)
  const topic = getTopic(db, topicId)
  if (page === null || page.kind !== 'topic' || topic === null) {
    throw new TopicInputError('That topic was not found')
  }
  draft.topicId = topicId
  draft.path = topic.source === 'seed' ? 'seed' : topic.source
  draft.step = topic.source === 'seed' ? 'questions' : 'pages'
  draft.name = page.title ?? topic.seed
  draft.seed = topic.seed
  draft.website = topic.website ?? project.domain
  draft.about = topic.about ?? ''
  draft.generate = topic.generate
  draft.bands = topic.bands
  draft.competitorUrl = topic.competitorUrl
  draft.intervalDays = page.intervalDays
  const product = readPageProductRow(db, topicId)
  if (product?.pinned === true) draft.productId = product.productId
  const depth = topic.depth as Partial<TopicDraft['depth']>
  if (depth.questions !== undefined && depth.keywords !== undefined) {
    draft.depth = {
      questions: {
        preset: depth.questions.preset,
        perStage: normalizePerStage(depth.questions.perStage)
      },
      keywords: normalizeKeywordDepth(depth.keywords)
    }
  }
  const setId = activePromptSetId(db, topicId)
  if (setId === null) return
  const texts = new Map(
    db
      .prepare<unknown[], { id: string; label: string; enabled: number; text: string | null }>(
        `SELECT prompts.id AS id, prompts.label AS label, prompts.enabled AS enabled,
                (SELECT text FROM prompt_variants v WHERE v.prompt_id = prompts.id LIMIT 1) AS text
           FROM prompts WHERE prompt_set_id = ?`
      )
      .all(setId)
      .map((row) => [row.id, row])
  )
  draft.prompts = listTopicPrompts(db, setId).map((record) => {
    const row = texts.get(record.promptId)
    const text = row?.text ?? row?.label ?? ''
    return {
      id: record.stableKey,
      kind: record.kind,
      text,
      stage: record.stage,
      source: record.source,
      sourceNote: record.sourceNote,
      included: row?.enabled === 1,
      kwGroup: record.kwGroup,
      kwGroupKind: record.kwGroupKind,
      kwFamily: null,
      intent: record.intent,
      funnel: record.funnel,
      pageType: record.pageType,
      targetPageId: record.targetPageId,
      targetUrl: record.targetUrl,
      matchConfidence: record.matchConfidence,
      matchReason: record.matchReason,
      matchStatus:
        record.targetUrl === null
          ? record.matchSetBy === null
            ? 'unmatched'
            : 'none'
          : record.matchConfirmed || record.matchSetBy === 'user'
            ? 'confirmed'
            : 'suggested',
      flags: promptFlags(text, record.kind, draft.brandNames),
      overlapWith: [],
      mergedFrom: [],
      previousText: null
    }
  })
}

export function requireDraft(db: SqliteDatabase, projectId: string, draftId: string): TopicDraft {
  const row = readDraftRow(db, draftId)
  if (row === null || row.state.projectId !== projectId) {
    throw new TopicInputError('That draft was not found', 'Start the topic again from Add.')
  }
  return row.state
}

export function saveDraft(db: SqliteDatabase, draft: TopicDraft, now: Date): TopicDraft {
  const next = { ...draft, updatedAt: now.toISOString() }
  saveDraftRow(db, next)
  return next
}

export function listDrafts(db: SqliteDatabase, projectId: string): TopicDraftSummary[] {
  return listDraftRows(db)
    .filter((row) => row.state.projectId === projectId)
    .map((row) => ({
      id: row.id,
      path: row.path,
      step: row.step,
      name: row.state.name,
      topicId: row.topicPageId,
      questions: row.state.prompts.filter((prompt) => prompt.kind === 'question').length,
      keywords: row.state.prompts.filter((prompt) => prompt.kind === 'keyword').length,
      updatedAt: row.updatedAt
    }))
}

export function discardDraft(
  db: SqliteDatabase,
  projectId: string,
  draftId: string,
  now: Date
): void {
  requireDraft(db, projectId, draftId)
  discardDraftRow(db, draftId, now.toISOString())
}

/** A new draft prompt with defaults for every field the input leaves out. */
export function newDraftPrompt(
  input: TopicDraftPromptInput,
  id: string,
  brands: readonly string[]
): TopicDraftPrompt {
  const text = input.text.replace(/\s+/gu, ' ').trim().slice(0, 500)
  return {
    id,
    kind: input.kind,
    text,
    stage: input.stage ?? null,
    source: input.source ?? 'user',
    sourceNote: input.sourceNote ?? null,
    included: input.included ?? true,
    kwGroup: input.kwGroup ?? null,
    kwGroupKind: input.kwGroupKind ?? null,
    kwFamily: input.kwFamily ?? null,
    intent: input.intent ?? null,
    funnel: input.funnel ?? null,
    pageType: input.pageType ?? null,
    targetPageId: null,
    targetUrl: null,
    matchConfidence: null,
    matchReason: null,
    matchStatus: 'unmatched',
    flags: promptFlags(text, input.kind, brands),
    overlapWith: [],
    mergedFrom: [],
    previousText: null
  }
}

function applyPromptInput(
  existing: TopicDraftPrompt,
  input: TopicDraftPromptInput,
  brands: readonly string[]
): TopicDraftPrompt {
  const text = input.text.replace(/\s+/gu, ' ').trim().slice(0, 500)
  const changedText = text !== existing.text
  return {
    ...existing,
    kind: input.kind,
    text,
    stage: input.stage === undefined ? existing.stage : input.stage,
    source: input.source ?? existing.source,
    sourceNote: input.sourceNote === undefined ? existing.sourceNote : input.sourceNote,
    included: input.included ?? existing.included,
    kwGroup: input.kwGroup === undefined ? existing.kwGroup : input.kwGroup,
    kwGroupKind: input.kwGroupKind === undefined ? existing.kwGroupKind : input.kwGroupKind,
    kwFamily: input.kwFamily === undefined ? existing.kwFamily : input.kwFamily,
    intent: input.intent === undefined ? existing.intent : input.intent,
    funnel: input.funnel === undefined ? existing.funnel : input.funnel,
    pageType: input.pageType === undefined ? existing.pageType : input.pageType,
    flags: promptFlags(text, input.kind, brands).concat(
      existing.flags.includes('merged') ? ['merged'] : []
    ),
    previousText: changedText ? existing.text : existing.previousText
  }
}

function profilePoint(
  input: TopicProfilePointInput,
  id: string,
  previous: readonly TopicProfilePoint[]
): TopicProfilePoint {
  const text = input.text.replace(/\s+/gu, ' ').trim().slice(0, 400)
  return {
    id,
    section: input.section,
    text,
    foundIn: input.foundIn ?? null,
    verify: input.verify ?? null,
    isNew: !previous.some((point) => point.text === text && point.section === input.section)
  }
}

/** Adds a profile version and makes it current. */
export function addProfileVersion(
  state: TopicProfileState | null,
  points: readonly TopicProfilePoint[],
  meta: {
    note: 'written' | 'rewritten' | 'edited' | 'filled_gaps'
    writtenAt: string
    templateId: string | null
    templateName: string | null
    templateHash: string | null
  }
): TopicProfileState {
  const versions = state?.versions ?? []
  const version = (versions.at(-1)?.version ?? 0) + 1
  const ordered = TOPIC_PROFILE_SECTIONS.flatMap((section) =>
    points.filter((point) => point.section === section)
  )
  return {
    versions: [...versions, { version, points: ordered, ...meta }],
    current: version
  }
}

export function currentProfilePoints(draft: TopicDraft): readonly TopicProfilePoint[] {
  const state = draft.profile
  if (state === null) return []
  return state.versions.find((version) => version.version === state.current)?.points ?? []
}

/** `topics:updateDraft`: applies only the fields the patch sends. */
export function applyDraftPatch(
  draft: TopicDraft,
  patch: TopicDraftPatch,
  deps: DraftDeps
): TopicDraft {
  const next: TopicDraft = { ...draft }
  if (patch.step !== undefined) next.step = patch.step
  if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 120)
  if (patch.seed !== undefined) next.seed = patch.seed.trim().slice(0, 500)
  if (patch.otherSeeds !== undefined) next.otherSeeds = patch.otherSeeds.slice(0, 10)
  if (patch.website !== undefined) next.website = patch.website.trim().slice(0, 300)
  if (patch.about !== undefined) next.about = patch.about.trim().slice(0, 4000)
  if (patch.generate !== undefined) next.generate = patch.generate
  if (patch.questionDepth !== undefined) {
    next.depth = {
      ...next.depth,
      questions:
        patch.questionDepth.preset === 'custom'
          ? questionDepthPreset('custom', patch.questionDepth)
          : questionDepthPreset(patch.questionDepth.preset)
    }
  }
  if (patch.keywordDepth !== undefined) {
    next.depth = {
      ...next.depth,
      keywords:
        patch.keywordDepth.preset === 'custom'
          ? keywordDepthPreset('custom', patch.keywordDepth)
          : keywordDepthPreset(patch.keywordDepth.preset)
    }
  }
  if (patch.bands !== undefined) next.bands = patch.bands
  if (patch.marketIds !== undefined) next.marketIds = [...new Set(patch.marketIds)]
  if (patch.segments !== undefined) next.segments = patch.segments.slice(0, 12)
  if (patch.switchingFrom !== undefined) next.switchingFrom = patch.switchingFrom.slice(0, 12)
  if (patch.integrations !== undefined) next.integrations = patch.integrations.slice(0, 12)
  if (patch.competitorUrl !== undefined) next.competitorUrl = patch.competitorUrl
  if (patch.product !== undefined) {
    if (patch.product.mode === 'auto') delete next.productId
    else next.productId = patch.product.productId
  }
  if (patch.intervalDays !== undefined) next.intervalDays = patch.intervalDays
  if (patch.keywordTerms !== undefined) next.keywordTerms = patch.keywordTerms.slice(0, 40)
  if (patch.removePromptIds !== undefined || patch.upsertPrompts !== undefined) {
    const removed = new Set(patch.removePromptIds ?? [])
    let prompts = next.prompts.filter((prompt) => !removed.has(prompt.id))
    for (const input of patch.upsertPrompts ?? []) {
      const index =
        input.id === undefined ? -1 : prompts.findIndex((prompt) => prompt.id === input.id)
      if (index === -1) {
        prompts = [...prompts, newDraftPrompt(input, `tp-${deps.createId()}`, next.brandNames)]
      } else {
        const current = prompts[index]
        if (current !== undefined) {
          prompts = prompts.map((prompt, at) =>
            at === index ? applyPromptInput(current, input, next.brandNames) : prompt
          )
        }
      }
    }
    next.prompts = prompts
  }
  if (patch.profile !== undefined) {
    const previous = currentProfilePoints(draft)
    const points = patch.profile.points.map((input) =>
      profilePoint(input, input.id ?? `pp-${deps.createId()}`, previous)
    )
    next.profile = addProfileVersion(next.profile, points, {
      note: patch.profile.note,
      writtenAt: deps.now().toISOString(),
      templateId: null,
      templateName: null,
      templateHash: null
    })
  }
  if (patch.profileVersion !== undefined && next.profile !== null) {
    const exists = next.profile.versions.some((version) => version.version === patch.profileVersion)
    if (!exists) throw new TopicInputError('That profile version was not found')
    next.profile = { ...next.profile, current: patch.profileVersion }
  }
  return next
}

/** Searches left this month: keys, and the project cap when it is tighter. */
export function searchesLeftFor(
  storage: AppStorage,
  db: SqliteDatabase,
  projectId: string,
  now: Date
): number | null {
  const month = usageMonth(now)
  const fromKeys = searchesLeft(withCountedSearches(storage.db, listApiKeys(storage.db), month))
  const cap = readProjectScheduleCap(db).cap
  const fromCap =
    cap === null ? null : Math.max(0, cap - projectUsedForMonth(storage, projectId, month))
  if (fromKeys === null) return fromCap
  if (fromCap === null) return fromKeys
  return Math.min(fromKeys, fromCap)
}

/** "118 keywords in 22 groups · ≈118–236 searches per market · 13 left". */
export function keywordSummary(draft: TopicDraft, left: number | null): TopicKeywordSummary {
  const keywords = draft.prompts.filter((prompt) => prompt.kind === 'keyword' && prompt.included)
  const groups = new Set(keywords.map((prompt) => prompt.kwGroup ?? '')).size
  const lo = keywords.length * SEARCHES_PER_PROMPT_MIN
  const hi = keywords.length * SEARCHES_PER_PROMPT_MAX
  const line = `${keywords.length} keywords in ${groups} ${groups === 1 ? 'group' : 'groups'} · ≈${lo}–${hi} searches per market${left === null ? '' : ` · ${left} left`}`
  return {
    keywords: keywords.length,
    groups,
    searchesLo: lo,
    searchesHi: hi,
    searchesLeft: left,
    line
  }
}
