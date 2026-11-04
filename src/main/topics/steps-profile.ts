import { TOPIC_PROFILE_SECTION_LABEL } from '@shared/domain'
import type { TopicDraft, TopicProfilePoint, TopicProfileSection } from '@shared/domain'
import type {
  DiscoverProfileSectionRequest,
  RewriteTopicSectionRequest,
  TopicProfileSuggestions,
  WriteTopicProfileRequest
} from '@shared/ipc'
import { modeRules, productBlock } from '../prompts/blocks'
import { PROFILE_DISCOVER_MODE_RULES, PROFILE_REWRITE_MODE_RULES } from './bodies/profile'
import { addProfileVersion, currentProfilePoints, saveDraft, TopicInputError } from './drafts'
import { runTopicTemplate } from './claude'
import {
  brandVars,
  buyerContextVars,
  draftProfileText,
  type OpenedProject,
  type TopicEnv
} from './env'
import { checkProfilePoints, type ProfilePointReply } from './journey-checks'
import { namesBrand } from './text'
import {
  askOnce,
  draftEvidence,
  topicCompetitors,
  topicLanguage,
  topicMarketBlock
} from './topic-context'

/**
 * The topic buyer profile and its assists (Docs/PROMPT-AUDIT.md, P3 items 0 to 2).
 * Evidence is the topic's own pages (`topicEvidence`), not the fixed homepage set.
 * The journey questions live in `./steps-journey.ts` and are re-exported here.
 */

export {
  discoverStageQuestions,
  findJourneyGaps,
  generateQuestions,
  rewriteQuestion
} from './steps-journey'

function toPoints(
  env: TopicEnv,
  replies: readonly ProfilePointReply[],
  previous: readonly TopicProfilePoint[]
): TopicProfilePoint[] {
  return replies.map((reply) => ({
    id: `pp-${env.host.createId()}`,
    section: reply.section,
    text: reply.text,
    foundIn: reply.foundIn,
    verify: reply.verify,
    isNew: previous.length > 0 && !previous.some((point) => point.text === reply.text)
  }))
}

/** `topics:writeProfile`: Claude writes (or rewrites) the profile as a new version. */
export async function writeProfile(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  request: WriteTopicProfileRequest
): Promise<TopicDraft> {
  if (draft.seed.trim().length === 0) {
    throw new TopicInputError(
      'Add a problem or seed first.',
      'Write the problem in the buyer’s words.'
    )
  }
  const evidence = await draftEvidence(env, opened, draft)
  const competitors = topicCompetitors(opened, draft)
  const sources = evidence.pages
  const check = (value: { points: ProfilePointReply[] }): string | null => {
    const { thin } = checkProfilePoints(value.points, sources, draft.brandNames)
    if (thin.length === 0) return null
    const names = thin.map((section) => TOPIC_PROFILE_SECTION_LABEL[section]).join(', ')
    return `These sections have too few points without the brand: ${names}. Write 5 or 6 different buyers in who and 3 to 6 points in every other section.`
  }
  const reply = await runTopicTemplate<{ points: ProfilePointReply[] }>({
    host: env.host,
    db: opened.db,
    projectId: opened.project.id,
    pageId: null,
    kind: 'topic_buyer_profile',
    channel: 'topics:writeProfile',
    context: {
      seed: draft.seed,
      about: draft.about || 'Not given',
      segments: draft.segments.join(', ') || 'Not picked',
      product_block: productBlock(competitors.product),
      market_block: topicMarketBlock(opened, draft),
      evidence: evidence.block,
      ...buyerContextVars({
        ...draft,
        switchingFrom: competitors.switchingFrom,
        integrations: competitors.integrations
      }),
      instruction: request.instruction ? `The user asks: ${request.instruction}` : '',
      ...brandVars(draft.brandNames)
    },
    check: askOnce(check)
  })
  const previous = currentProfilePoints(draft)
  const { kept } = checkProfilePoints(reply.value.points, sources, draft.brandNames)
  if (kept.length === 0) {
    throw new TopicInputError(
      'CiteFox AI wrote no profile points that could be kept.',
      'Try again, or add a line about the business.'
    )
  }
  const points = toPoints(env, kept, previous)
  const next: TopicDraft = {
    ...draft,
    step: draft.step === 'seed' ? 'profile' : draft.step,
    profile: addProfileVersion(draft.profile, points, {
      note: draft.profile === null || request.rewrite !== true ? 'written' : 'rewritten',
      writtenAt: env.host.now().toISOString(),
      templateId: reply.templateId,
      templateName: reply.templateName,
      templateHash: reply.templateHash
    })
  }
  return saveDraft(opened.db, next, env.host.now())
}

// ---------------------------------------------------------------------------
// Profile assists: discover and explain (topic_profile_discover_v2), rewrite and
// shorter (topic_profile_rewrite)
// ---------------------------------------------------------------------------

function sectionLines(points: readonly TopicProfilePoint[]): string {
  if (points.length === 0) return 'No points yet.'
  return points
    .map((point) => `${point.id} · [${TOPIC_PROFILE_SECTION_LABEL[point.section]}] ${point.text}`)
    .join('\n')
}

async function discoverAssist(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  section: TopicProfileSection | null,
  action: 'discover' | 'explain',
  instruction: string | null | undefined,
  channel: string
): Promise<TopicProfileSuggestions> {
  const evidence = await draftEvidence(env, opened, draft)
  const reply = await runTopicTemplate<{
    points: ProfilePointReply[]
    explanation: string | null
  }>({
    host: env.host,
    db: opened.db,
    projectId: opened.project.id,
    pageId: null,
    kind: 'topic_profile_discover_v2',
    channel,
    context: {
      seed: draft.seed,
      action,
      section: section ?? 'all',
      profile: draftProfileText(draft),
      market_language: topicLanguage(opened, draft),
      evidence: evidence.block,
      mode_rules: modeRules(PROFILE_DISCOVER_MODE_RULES, action),
      instruction: instruction ? `The user asks: ${instruction}` : '',
      ...brandVars(draft.brandNames)
    }
  })
  const existing = new Set(currentProfilePoints(draft).map((point) => point.text.toLowerCase()))
  const { kept } = checkProfilePoints(
    action === 'explain' ? [] : reply.value.points,
    evidence.pages,
    draft.brandNames
  )
  const suggestions = kept
    .filter((point) => section === null || point.section === section)
    .filter((point) => !existing.has(point.text.toLowerCase()))
    .map((point) => ({
      id: `ps-${env.host.createId()}`,
      section: point.section,
      text: point.text,
      foundIn: point.foundIn,
      verify: point.verify,
      replacesPointId: null
    }))
  return {
    draftId: draft.id,
    section,
    action,
    suggestions,
    explanation: action === 'explain' ? reply.value.explanation : null,
    toVerify: suggestions.filter((item) => item.verify !== null).length,
    info: reply.info
  }
}

async function rewriteAssist(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  section: TopicProfileSection | null,
  action: 'rewrite' | 'shorter',
  instruction: string | null | undefined,
  channel: string
): Promise<TopicProfileSuggestions> {
  const points = currentProfilePoints(draft).filter(
    (point) => section === null || point.section === section
  )
  if (points.length === 0) throw new TopicInputError('This section has no points to rewrite yet.')
  const reply = await runTopicTemplate<{
    points: { section: TopicProfileSection; text: string; replaces: string }[]
  }>({
    host: env.host,
    db: opened.db,
    projectId: opened.project.id,
    pageId: null,
    kind: 'topic_profile_rewrite',
    channel,
    context: {
      seed: draft.seed,
      action,
      section: section ?? 'all',
      profile: sectionLines(points),
      market_language: topicLanguage(opened, draft),
      mode_rules: modeRules(PROFILE_REWRITE_MODE_RULES, action),
      instruction: instruction ? `The user asks: ${instruction}` : '',
      ...brandVars(draft.brandNames)
    }
  })
  const byId = new Map(points.map((point) => [point.id, point]))
  const used = new Set<string>()
  const suggestions = reply.value.points.flatMap((item) => {
    const replaced = byId.get(item.replaces.trim())
    const text = item.text.trim()
    // `replaces` must name a point of the section; one suggestion per point.
    if (replaced === undefined || used.has(replaced.id)) return []
    if (text.length === 0 || text === replaced.text || namesBrand(text, draft.brandNames)) return []
    used.add(replaced.id)
    return [
      {
        id: `ps-${env.host.createId()}`,
        section: replaced.section,
        text,
        foundIn: replaced.foundIn,
        verify: replaced.verify,
        replacesPointId: replaced.id
      }
    ]
  })
  return {
    draftId: draft.id,
    section,
    action,
    suggestions,
    explanation: null,
    toVerify: suggestions.filter((item) => item.verify !== null).length,
    info: reply.info
  }
}

function profileAssist(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  section: TopicProfileSection | null,
  action: TopicProfileSuggestions['action'],
  instruction: string | null | undefined,
  channel: string
): Promise<TopicProfileSuggestions> {
  return action === 'discover' || action === 'explain'
    ? discoverAssist(env, opened, draft, section, action, instruction, channel)
    : rewriteAssist(env, opened, draft, section, action, instruction, channel)
}

export function discoverProfileSection(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  request: DiscoverProfileSectionRequest
): Promise<TopicProfileSuggestions> {
  return profileAssist(
    env,
    opened,
    draft,
    request.section,
    request.action,
    request.instruction,
    'topics:discoverProfileSection'
  )
}

export function rewriteSection(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  request: RewriteTopicSectionRequest
): Promise<TopicProfileSuggestions> {
  return profileAssist(
    env,
    opened,
    draft,
    request.section,
    request.mode,
    request.instruction,
    'topics:rewriteSection'
  )
}
