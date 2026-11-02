import type {
  TopicDraft,
  TopicDraftPrompt,
  TopicProfilePoint,
  TopicPromptFlag
} from '@shared/domain'
import type { TopicDraftPatch, TopicDraftPromptInput } from '@shared/ipc'
import { namesAny } from './text'

/**
 * A `TopicDraftPatch` applied to a draft, the way `topics:updateDraft` applies
 * it: scalars replace, prompts are removed then upserted (a missing or unknown
 * id adds one), a `profile` saves a new version, `profileVersion` switches.
 * The wizard uses it for the optimistic copy on screen; the mock uses it as
 * its store.
 */
export function applyPatch(
  draft: TopicDraft,
  patch: TopicDraftPatch,
  options: { now: string; makeId: (prefix: string) => string }
): TopicDraft {
  let next: TopicDraft = { ...draft }
  if (patch.step !== undefined) next.step = patch.step
  if (patch.name !== undefined) next.name = patch.name
  if (patch.seed !== undefined) next.seed = patch.seed
  if (patch.otherSeeds !== undefined) next.otherSeeds = patch.otherSeeds
  if (patch.website !== undefined) next.website = patch.website
  if (patch.about !== undefined) next.about = patch.about
  if (patch.generate !== undefined) next.generate = patch.generate
  if (patch.bands !== undefined) next.bands = patch.bands
  if (patch.marketIds !== undefined) next.marketIds = patch.marketIds
  if (patch.segments !== undefined) next.segments = patch.segments
  if (patch.switchingFrom !== undefined) next.switchingFrom = patch.switchingFrom
  if (patch.integrations !== undefined) next.integrations = patch.integrations
  if (patch.competitorUrl !== undefined) next.competitorUrl = patch.competitorUrl
  if (patch.product !== undefined) {
    if (patch.product.mode === 'auto') delete next.productId
    else next.productId = patch.product.productId
  }
  if (patch.intervalDays !== undefined) next.intervalDays = patch.intervalDays
  if (patch.keywordTerms !== undefined) next.keywordTerms = patch.keywordTerms
  if (patch.questionDepth !== undefined || patch.keywordDepth !== undefined) {
    next.depth = {
      questions: patch.questionDepth ?? draft.depth.questions,
      keywords: patch.keywordDepth ?? draft.depth.keywords
    }
  }
  if (patch.removePromptIds?.length || patch.upsertPrompts?.length) {
    next = { ...next, prompts: applyPrompts(next, patch, options.makeId) }
  }
  if (patch.profile) {
    const previous = draft.profile
    const current = previous?.versions.find((version) => version.version === previous.current)
    const oldTexts = new Set(current?.points.map((point) => point.text) ?? [])
    const number = Math.max(0, ...(previous?.versions.map((version) => version.version) ?? [])) + 1
    const points: TopicProfilePoint[] = patch.profile.points.map((point) => ({
      id: point.id ?? options.makeId('pp'),
      section: point.section,
      text: point.text,
      foundIn: point.foundIn ?? null,
      verify: point.verify ?? null,
      isNew: !oldTexts.has(point.text)
    }))
    next.profile = {
      current: number,
      versions: [
        ...(previous?.versions ?? []),
        {
          version: number,
          points,
          writtenAt: options.now,
          note: patch.profile.note,
          templateId: null,
          templateName: null,
          templateHash: null
        }
      ]
    }
  }
  if (patch.profileVersion !== undefined && next.profile) {
    const wanted = patch.profileVersion
    if (next.profile.versions.some((version) => version.version === wanted)) {
      next.profile = { ...next.profile, current: wanted }
    }
  }
  next.updatedAt = options.now
  return next
}

function brandFlags(
  flags: readonly TopicPromptFlag[],
  text: string,
  brandNames: readonly string[]
): readonly TopicPromptFlag[] {
  const names = namesAny(text, brandNames)
  if (names && !flags.includes('brand')) return [...flags, 'brand']
  if (!names && flags.includes('brand')) return flags.filter((flag) => flag !== 'brand')
  return flags
}

function applyPrompts(
  draft: TopicDraft,
  patch: TopicDraftPatch,
  makeId: (prefix: string) => string
): TopicDraftPrompt[] {
  const removed = new Set(patch.removePromptIds ?? [])
  const prompts = draft.prompts.filter((prompt) => !removed.has(prompt.id))
  for (const input of patch.upsertPrompts ?? []) {
    const index = input.id ? prompts.findIndex((prompt) => prompt.id === input.id) : -1
    const existing = index >= 0 ? prompts[index] : undefined
    if (existing) {
      prompts[index] = mergePrompt(existing, input, draft.brandNames)
    } else {
      prompts.push(
        newPrompt(
          input,
          input.id ?? makeId(input.kind === 'keyword' ? 'kw' : 'q'),
          draft.brandNames
        )
      )
    }
  }
  return prompts
}

function mergePrompt(
  prompt: TopicDraftPrompt,
  input: TopicDraftPromptInput,
  brandNames: readonly string[]
): TopicDraftPrompt {
  const textChanged = input.text !== prompt.text
  return {
    ...prompt,
    kind: input.kind,
    text: input.text,
    ...(input.stage !== undefined ? { stage: input.stage } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.sourceNote !== undefined ? { sourceNote: input.sourceNote } : {}),
    ...(input.included !== undefined ? { included: input.included } : {}),
    ...(input.kwGroup !== undefined ? { kwGroup: input.kwGroup } : {}),
    ...(input.kwGroupKind !== undefined ? { kwGroupKind: input.kwGroupKind } : {}),
    ...(input.kwFamily !== undefined ? { kwFamily: input.kwFamily } : {}),
    ...(input.intent !== undefined ? { intent: input.intent } : {}),
    ...(input.funnel !== undefined ? { funnel: input.funnel } : {}),
    ...(input.pageType !== undefined ? { pageType: input.pageType } : {}),
    previousText: textChanged ? prompt.text : prompt.previousText,
    flags: textChanged ? brandFlags(prompt.flags, input.text, brandNames) : prompt.flags
  }
}

function newPrompt(
  input: TopicDraftPromptInput,
  id: string,
  brandNames: readonly string[]
): TopicDraftPrompt {
  return {
    id,
    kind: input.kind,
    text: input.text,
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
    flags: brandFlags([], input.text, brandNames),
    overlapWith: [],
    mergedFrom: [],
    previousText: null
  }
}

/**
 * Two patches as one, `b` after `a`: later scalars win, prompt upserts for the
 * same id merge, removals add up (and drop earlier upserts of those ids).
 */
export function mergePatch(a: TopicDraftPatch, b: TopicDraftPatch): TopicDraftPatch {
  const merged: TopicDraftPatch = { ...a, ...b }
  const removed = [...new Set([...(a.removePromptIds ?? []), ...(b.removePromptIds ?? [])])]
  const gone = new Set(b.removePromptIds ?? [])
  const upserts: TopicDraftPromptInput[] = (a.upsertPrompts ?? []).filter(
    (input) => !input.id || !gone.has(input.id)
  )
  for (const input of b.upsertPrompts ?? []) {
    const index = input.id ? upserts.findIndex((item) => item.id === input.id) : -1
    if (index >= 0) upserts[index] = { ...upserts[index], ...input }
    else upserts.push(input)
  }
  if (removed.length > 0) merged.removePromptIds = removed
  else delete merged.removePromptIds
  if (upserts.length > 0) merged.upsertPrompts = upserts
  else delete merged.upsertPrompts
  return merged
}

/** A prompt as an upsert input that keeps every field the input can carry. */
export function promptInput(
  prompt: TopicDraftPrompt,
  change: Partial<TopicDraftPromptInput> = {}
): TopicDraftPromptInput {
  return {
    id: prompt.id,
    kind: prompt.kind,
    text: prompt.text,
    stage: prompt.stage,
    source: prompt.source,
    sourceNote: prompt.sourceNote,
    included: prompt.included,
    kwGroup: prompt.kwGroup,
    kwGroupKind: prompt.kwGroupKind,
    kwFamily: prompt.kwFamily,
    intent: prompt.intent,
    funnel: prompt.funnel,
    pageType: prompt.pageType,
    ...change
  }
}
