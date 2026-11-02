import {
  DEPTH_PRESETS,
  isDepthPreset,
  isIntervalDays,
  isFunnelStage,
  isKeywordGroupKind,
  isKeywordIntent,
  isKeywordIntentFamily,
  isPageType,
  isTopicGenerate,
  isTopicProfileSection,
  isTopicPromptKind,
  isTopicPromptSource,
  isTopicStage,
  isTopicWizardPath,
  isTopicWizardStep,
  TOPIC_STAGES
} from '@shared/domain'
import type {
  IntervalDays,
  KeywordCoreTerm,
  KeywordDepth,
  QuestionDepth,
  TopicBands
} from '@shared/domain'
import {
  TOPIC_START_PLANS,
  TOPIC_STEPS,
  type TopicDraftPatch,
  type TopicDraftPromptInput,
  type TopicProfilePointInput,
  type TopicStartPlan,
  type TopicStep,
  type TopicTarget
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { containsSecret } from '../logging/redact'

/** Request parsers for `topics:*`. Anything malformed is an `IpcRequestError`. */

type Raw = Record<string, unknown>

export function record(value: unknown, channel: string): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  return value as Raw
}

export function id(raw: Raw, key: string, channel: string): string {
  const value = raw[key]
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 200 ||
    /[\0\n]/u.test(value)
  ) {
    throw new IpcRequestError(channel)
  }
  return value
}

export function optionalId(raw: Raw, key: string, channel: string): string | null {
  const value = raw[key]
  if (value === undefined || value === null) return null
  return id(raw, key, channel)
}

export function text(
  raw: Raw,
  key: string,
  channel: string,
  max: number,
  allowEmpty = true
): string {
  const value = raw[key]
  if (typeof value !== 'string' || value.length > max) throw new IpcRequestError(channel)
  if (!allowEmpty && value.trim().length === 0) throw new IpcRequestError(channel)
  if (containsSecret(value)) throw new IpcRequestError(channel, 'Text cannot contain a secret')
  return value
}

export function optionalText(
  raw: Raw,
  key: string,
  channel: string,
  max: number
): string | null | undefined {
  const value = raw[key]
  if (value === undefined) return undefined
  if (value === null) return null
  return text(raw, key, channel, max)
}

function bool(raw: Raw, key: string, channel: string): boolean | undefined {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new IpcRequestError(channel)
  return value
}

function int(value: unknown, channel: string, lo: number, hi: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < lo || value > hi) {
    throw new IpcRequestError(channel)
  }
  return value
}

function strings(value: unknown, channel: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new IpcRequestError(channel)
  return value.map((item) => {
    if (typeof item !== 'string' || item.length > maxLength) throw new IpcRequestError(channel)
    return item
  })
}

function oneOf<T extends string>(
  value: unknown,
  guard: (value: string) => value is T,
  channel: string
): T {
  if (typeof value !== 'string' || !guard(value)) throw new IpcRequestError(channel)
  return value
}

function nullableOneOf<T extends string>(
  value: unknown,
  guard: (value: string) => value is T,
  channel: string
): T | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return oneOf(value, guard, channel)
}

export function projectRequest(value: unknown, channel: string): { projectId: string } {
  return { projectId: id(record(value, channel), 'projectId', channel) }
}

export function draftRequest(
  value: unknown,
  channel: string
): { projectId: string; draftId: string } {
  const raw = record(value, channel)
  return { projectId: id(raw, 'projectId', channel), draftId: id(raw, 'draftId', channel) }
}

export function topicRequest(
  value: unknown,
  channel: string
): { projectId: string; topicId: string } {
  const raw = record(value, channel)
  return { projectId: id(raw, 'projectId', channel), topicId: id(raw, 'topicId', channel) }
}

export function parseStep(value: unknown, channel: string): TopicStep {
  if (typeof value !== 'string' || !(TOPIC_STEPS as readonly string[]).includes(value))
    throw new IpcRequestError(channel)
  return value as TopicStep
}

export function parsePlan(value: unknown, channel: string): TopicStartPlan {
  if (typeof value !== 'string' || !(TOPIC_START_PLANS as readonly string[]).includes(value))
    throw new IpcRequestError(channel)
  return value as TopicStartPlan
}

export function parseScope(
  value: unknown,
  channel: string
): 'questions' | 'keywords' | 'both' | undefined {
  if (value === undefined) return undefined
  if (value === 'questions' || value === 'keywords' || value === 'both') return value
  throw new IpcRequestError(channel)
}

export function parseInterval(value: unknown, channel: string): IntervalDays | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && isIntervalDays(value)) return value
  throw new IpcRequestError(channel)
}

export function parseBands(value: unknown, channel: string): TopicBands {
  const raw = record(value, channel)
  const band = (part: unknown): { lo: number; hi: number } => {
    const item = record(part, channel)
    const lo = int(item.lo, channel, 0, 100)
    const hi = int(item.hi, channel, 0, 100)
    if (lo > hi)
      throw new IpcRequestError(channel, 'The band’s low edge must be below its high edge')
    return { lo, hi }
  }
  return { questions: band(raw.questions), keywords: band(raw.keywords) }
}

function parseQuestionDepth(value: unknown, channel: string): QuestionDepth {
  const raw = record(value, channel)
  const preset = oneOf(raw.preset, isDepthPreset, channel)
  const per = record(raw.perStage ?? {}, channel)
  const perStage = Object.fromEntries(
    TOPIC_STAGES.map((stage) => [
      stage,
      per[stage] === undefined ? 0 : int(per[stage], channel, 0, 100)
    ])
  ) as Record<(typeof TOPIC_STAGES)[number], number>
  return { preset, perStage }
}

function parseKeywordDepth(value: unknown, channel: string): KeywordDepth {
  const raw = record(value, channel)
  return {
    preset: oneOf(raw.preset, isDepthPreset, channel),
    maxKeywords: int(raw.maxKeywords, channel, 1, 500),
    synonymsPerCoreTerm: int(raw.synonymsPerCoreTerm, channel, 0, 12),
    patternVariants: strings(raw.patternVariants, channel, 20, 80),
    longTailQuestions: raw.longTailQuestions === true,
    intentFamilies: strings(raw.intentFamilies, channel, 20, 40).map((family) =>
      oneOf(family, isKeywordIntentFamily, channel)
    ),
    perGroupCap: int(raw.perGroupCap, channel, 1, 100)
  }
}

function parseTerm(value: unknown, channel: string): KeywordCoreTerm {
  const raw = record(value, channel)
  return {
    id: id(raw, 'id', channel),
    term: text(raw, 'term', channel, 80, false),
    synonyms: strings(raw.synonyms, channel, 12, 80),
    kept: raw.kept !== false
  }
}

export function parsePromptInput(value: unknown, channel: string): TopicDraftPromptInput {
  const raw = record(value, channel)
  const input: TopicDraftPromptInput = {
    kind: oneOf(raw.kind, isTopicPromptKind, channel),
    text: text(raw, 'text', channel, 500, false)
  }
  if (raw.id !== undefined) input.id = id(raw, 'id', channel)
  const stage = nullableOneOf(raw.stage, isTopicStage, channel)
  if (stage !== undefined) input.stage = stage
  if (raw.source !== undefined) input.source = oneOf(raw.source, isTopicPromptSource, channel)
  const note = optionalText(raw, 'sourceNote', channel, 500)
  if (note !== undefined) input.sourceNote = note
  const included = bool(raw, 'included', channel)
  if (included !== undefined) input.included = included
  const group = optionalText(raw, 'kwGroup', channel, 120)
  if (group !== undefined) input.kwGroup = group
  const groupKind = nullableOneOf(raw.kwGroupKind, isKeywordGroupKind, channel)
  if (groupKind !== undefined) input.kwGroupKind = groupKind
  const family = nullableOneOf(raw.kwFamily, isKeywordIntentFamily, channel)
  if (family !== undefined) input.kwFamily = family
  const intent = nullableOneOf(raw.intent, isKeywordIntent, channel)
  if (intent !== undefined) input.intent = intent
  const funnel = nullableOneOf(raw.funnel, isFunnelStage, channel)
  if (funnel !== undefined) input.funnel = funnel
  const pageType = nullableOneOf(raw.pageType, isPageType, channel)
  if (pageType !== undefined) input.pageType = pageType
  return input
}

function parsePoint(value: unknown, channel: string): TopicProfilePointInput {
  const raw = record(value, channel)
  const point: TopicProfilePointInput = {
    section: oneOf(raw.section, isTopicProfileSection, channel),
    text: text(raw, 'text', channel, 400, false)
  }
  if (raw.id !== undefined) point.id = id(raw, 'id', channel)
  const foundIn = optionalText(raw, 'foundIn', channel, 200)
  if (foundIn !== undefined) point.foundIn = foundIn
  const verify = optionalText(raw, 'verify', channel, 300)
  if (verify !== undefined) point.verify = verify
  return point
}

/** The Seed step's product picker (Docs/PROMPT-AUDIT.md PC). */
function parseProductChoice(
  value: unknown,
  channel: string
): NonNullable<TopicDraftPatch['product']> {
  const raw = record(value, channel)
  if (raw.mode === 'auto') return { mode: 'auto' }
  if (raw.mode !== 'pick') throw new IpcRequestError(channel)
  if (raw.productId === null) return { mode: 'pick', productId: null }
  if (
    typeof raw.productId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(raw.productId)
  )
    throw new IpcRequestError(channel)
  return { mode: 'pick', productId: raw.productId }
}

export function parsePatch(value: unknown, channel: string): TopicDraftPatch {
  const raw = record(value, channel)
  const patch: TopicDraftPatch = {}
  if (raw.step !== undefined) patch.step = oneOf(raw.step, isTopicWizardStep, channel)
  if (raw.name !== undefined) patch.name = text(raw, 'name', channel, 300)
  if (raw.seed !== undefined) patch.seed = text(raw, 'seed', channel, 500)
  if (raw.otherSeeds !== undefined) patch.otherSeeds = strings(raw.otherSeeds, channel, 10, 200)
  if (raw.website !== undefined) patch.website = text(raw, 'website', channel, 300)
  if (raw.about !== undefined) patch.about = text(raw, 'about', channel, 4000)
  if (raw.generate !== undefined) patch.generate = oneOf(raw.generate, isTopicGenerate, channel)
  if (raw.questionDepth !== undefined)
    patch.questionDepth = parseQuestionDepth(raw.questionDepth, channel)
  if (raw.keywordDepth !== undefined)
    patch.keywordDepth = parseKeywordDepth(raw.keywordDepth, channel)
  if (raw.bands !== undefined) patch.bands = parseBands(raw.bands, channel)
  if (raw.marketIds !== undefined) patch.marketIds = strings(raw.marketIds, channel, 20, 200)
  if (raw.segments !== undefined) patch.segments = strings(raw.segments, channel, 12, 120)
  if (raw.switchingFrom !== undefined) {
    patch.switchingFrom = strings(raw.switchingFrom, channel, 12, 120)
  }
  if (raw.integrations !== undefined) {
    patch.integrations = strings(raw.integrations, channel, 12, 120)
  }
  if (raw.competitorUrl !== undefined)
    patch.competitorUrl = optionalText(raw, 'competitorUrl', channel, 2000) ?? null
  if (raw.product !== undefined) patch.product = parseProductChoice(raw.product, channel)
  const interval = parseInterval(raw.intervalDays, channel)
  if (interval !== undefined) patch.intervalDays = interval
  if (raw.keywordTerms !== undefined) {
    if (!Array.isArray(raw.keywordTerms) || raw.keywordTerms.length > 40)
      throw new IpcRequestError(channel)
    patch.keywordTerms = raw.keywordTerms.map((item) => parseTerm(item, channel))
  }
  if (raw.upsertPrompts !== undefined) {
    if (!Array.isArray(raw.upsertPrompts) || raw.upsertPrompts.length > 1000)
      throw new IpcRequestError(channel)
    patch.upsertPrompts = raw.upsertPrompts.map((item) => parsePromptInput(item, channel))
  }
  if (raw.removePromptIds !== undefined)
    patch.removePromptIds = strings(raw.removePromptIds, channel, 1000, 200)
  if (raw.profile !== undefined) {
    const profile = record(raw.profile, channel)
    if (!Array.isArray(profile.points) || profile.points.length > 80)
      throw new IpcRequestError(channel)
    const note =
      profile.note === 'filled_gaps' ? 'filled_gaps' : profile.note === 'edited' ? 'edited' : null
    if (note === null) throw new IpcRequestError(channel)
    patch.profile = { points: profile.points.map((item) => parsePoint(item, channel)), note }
  }
  if (raw.profileVersion !== undefined)
    patch.profileVersion = int(raw.profileVersion, channel, 1, 1000)
  return patch
}

export function parseCreateDraft(
  value: unknown,
  channel: string
): {
  projectId: string
  path: 'seed' | 'questions' | 'competitor'
  seed?: string
  name?: string
  topicId?: string
} {
  const raw = record(value, channel)
  const out: {
    projectId: string
    path: 'seed' | 'questions' | 'competitor'
    seed?: string
    name?: string
    topicId?: string
  } = {
    projectId: id(raw, 'projectId', channel),
    path: oneOf(raw.path, isTopicWizardPath, channel)
  }
  if (raw.seed !== undefined) out.seed = text(raw, 'seed', channel, 500)
  if (raw.name !== undefined) out.name = text(raw, 'name', channel, 300)
  if (raw.topicId !== undefined) out.topicId = id(raw, 'topicId', channel)
  return out
}

export function parseTarget(value: unknown, channel: string): TopicTarget | undefined {
  if (value === undefined) return undefined
  const raw = record(value, channel)
  const url = optionalText(raw, 'url', channel, 2000) ?? null
  return { pageId: optionalId(raw, 'pageId', channel), url }
}

export function parseIds(value: unknown, channel: string, max = 1000): string[] {
  const list = strings(value, channel, max, 200)
  if (list.some((item) => item.length === 0)) throw new IpcRequestError(channel)
  return list
}

export { DEPTH_PRESETS }
