import {
  DEFAULT_INTERVAL_DAYS,
  DEFAULT_TOPIC_BANDS,
  MAX_TOPIC_QUESTIONS,
  QUESTION_DEPTH_TOTAL,
  TOPIC_STAGES,
  type QuestionDepth,
  type TopicDraft,
  type TopicDraftPrompt,
  type TopicProfilePoint,
  type TopicStage,
  type TopicWizardPath,
  type TopicWizardStep
} from '@shared/domain'
import { FIRST_STEP, KEYWORD_PRESETS } from '../constants'

export const DEFAULT_PER_STAGE: Readonly<Record<TopicStage, number>> = {
  problem: 5,
  options: 5,
  doubts: 5,
  fit: 5,
  compare: 5,
  decide: 5
}

/** A fresh draft (the mock's `topics:createDraft`; main builds its own the same way). */
export function newDraft(input: {
  id: string
  projectId: string
  path: TopicWizardPath
  now: string
  website: string
  brandNames: readonly string[]
  competitors: readonly string[]
  marketIds: readonly string[]
  about?: string
  seed?: string
  name?: string
}): TopicDraft {
  const seed = input.seed ?? ''
  return {
    id: input.id,
    projectId: input.projectId,
    path: input.path,
    step: FIRST_STEP[input.path],
    topicId: null,
    name: input.name ?? (input.path === 'questions' ? 'Questions from sales and support' : seed),
    seed,
    otherSeeds: [],
    website: input.website,
    about: input.about ?? '',
    generate: 'both',
    depth: {
      questions: { preset: 'standard', perStage: DEFAULT_PER_STAGE },
      keywords: { preset: 'standard', ...KEYWORD_PRESETS.standard }
    },
    bands: DEFAULT_TOPIC_BANDS,
    marketIds: input.marketIds,
    brandNames: input.brandNames,
    competitors: input.competitors,
    segments: [],
    profile: null,
    prompts: [],
    keywordTerms: [],
    importSource: null,
    importStats: null,
    competitorUrl: null,
    competitorPage: null,
    competitorClaims: [],
    intervalDays: DEFAULT_INTERVAL_DAYS,
    createdAt: input.now,
    updatedAt: input.now,
    startedAt: null
  }
}

export function questionsOf(draft: Pick<TopicDraft, 'prompts'>): TopicDraftPrompt[] {
  return draft.prompts.filter((prompt) => prompt.kind === 'question')
}

export function keywordsOf(draft: Pick<TopicDraft, 'prompts'>): TopicDraftPrompt[] {
  return draft.prompts.filter((prompt) => prompt.kind === 'keyword')
}

/** The prompts with `ids`, in list order. */
export function pick(
  prompts: readonly TopicDraftPrompt[],
  ids: readonly string[]
): TopicDraftPrompt[] {
  const wanted = new Set(ids)
  return prompts.filter((prompt) => wanted.has(prompt.id))
}

export function included<T extends TopicDraftPrompt>(prompts: readonly T[]): T[] {
  return prompts.filter((prompt) => prompt.included)
}

/** Points of the profile version in use. */
export function profilePoints(draft: Pick<TopicDraft, 'profile'>): readonly TopicProfilePoint[] {
  const profile = draft.profile
  if (!profile) return []
  return profile.versions.find((version) => version.version === profile.current)?.points ?? []
}

/** Questions the depth asks for: the preset total, or the Custom sum (max 100). */
export function questionTarget(depth: QuestionDepth): number {
  if (depth.preset !== 'custom') return QUESTION_DEPTH_TOTAL[depth.preset]
  return Math.min(
    MAX_TOPIC_QUESTIONS,
    TOPIC_STAGES.reduce((sum, stage) => sum + (depth.perStage[stage] || 0), 0)
  )
}

/** Per-stage counts for a total, spread as evenly as it allows. */
export function perStageFor(total: number): Record<TopicStage, number> {
  const base = Math.floor(total / TOPIC_STAGES.length)
  const extra = total - base * TOPIC_STAGES.length
  return Object.fromEntries(
    TOPIC_STAGES.map((stage, index) => [stage, base + (index < extra ? 1 : 0)])
  ) as Record<TopicStage, number>
}

export function stageCounts(
  prompts: readonly TopicDraftPrompt[]
): Record<TopicStage, { included: number; total: number }> {
  const counts = Object.fromEntries(
    TOPIC_STAGES.map((stage) => [stage, { included: 0, total: 0 }])
  ) as Record<TopicStage, { included: number; total: number }>
  for (const prompt of prompts) {
    if (!prompt.stage) continue
    const entry = counts[prompt.stage]
    entry.total += 1
    if (prompt.included) entry.included += 1
  }
  return counts
}

const URL_PATTERN = /^https?:\/\/[^\s/]+\.[^\s]+$/i

export function isPageUrl(value: string): boolean {
  return URL_PATTERN.test(value.trim())
}

/**
 * Why the primary action of `step` is not ready, or null when it is. Short,
 * plain sentences for the footer note.
 */
export function stepProblem(draft: TopicDraft, step: TopicWizardStep): string | null {
  switch (step) {
    case 'seed':
      if (draft.seed.trim().length < 3) return 'Write the problem in a few words.'
      if (draft.name.trim().length === 0) return 'Give the topic a name.'
      if (draft.marketIds.length === 0) return 'Pick at least one market.'
      if (draft.depth.questions.preset === 'custom' && questionTarget(draft.depth.questions) < 1)
        return 'Ask for at least one question.'
      return null
    case 'profile':
      return profilePoints(draft).length > 0
        ? null
        : 'CiteFox AI has not written the buyer profile yet.'
    case 'questions':
    case 'cleanup':
      return included(questionsOf(draft)).length > 0
        ? null
        : 'Keep at least one question in the topic.'
    case 'keywords':
      return included(keywordsOf(draft)).length > 0 ? null : 'Generate keywords first.'
    case 'import':
      return null
    case 'competitor':
      if (!isPageUrl(draft.competitorUrl ?? ''))
        return 'Enter their page address, starting with https://.'
      return draft.competitorPage?.ok ? null : 'Read their page first.'
    case 'pages':
      return null
    case 'estimate':
      if (draft.name.trim().length === 0) return 'Give the topic a name.'
      if (draft.marketIds.length === 0) return 'Pick at least one market.'
      return included(draft.prompts).length > 0 ? null : 'There is nothing to check yet.'
  }
}

let counter = 0
/** A draft-local id for a new line until the saved draft names it. */
export function localId(prefix: string): string {
  counter += 1
  return `${prefix}-new-${Date.now().toString(36)}${counter.toString(36)}`
}
