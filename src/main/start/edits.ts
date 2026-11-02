import type {
  StartEdit,
  StartEditRecord,
  StartQuestion,
  StartRival,
  TopicDraftPromptInput,
  TopicProfilePointInput
} from '@shared/ipc'
import type { TopicDraft } from '@shared/domain'
import {
  activeEdits,
  applyBuyerEdits,
  applyQuestionEdits,
  applyRivalEdits,
  summarizeEdit
} from '@shared/start-edits'
import type { TopicsService } from '../topics/service'
import { currentProfilePoints } from '../topics/drafts'

/**
 * How the user's edits reach the topic draft the autopilot is writing, and the
 * follow-ups an edit needs (a removed competitor named in a written question).
 */

export function newRecord(
  edit: StartEdit,
  id: string,
  at: string,
  parentId: string | null = null
): StartEditRecord {
  return {
    id,
    edit,
    summary: summarizeEdit(edit),
    at,
    undoneAt: null,
    parentId,
    system: parentId !== null
  }
}

/** "Competitors: A, B. Buyers switch from: X. Partners, never competitors: W." for the draft's About. */
export function rivalsAbout(rivals: readonly StartRival[]): string {
  const names = (kind: StartRival['kind']): string =>
    rivals
      .filter((rival) => rival.kind === kind)
      .map((rival) => rival.name)
      .join(', ')
  return [
    names('competitor')
      ? `Competitors (picked instead of us for the same job): ${names('competitor')}.`
      : '',
    names('switch_from')
      ? `Options buyers switch from (not competitors): ${names('switch_from')}.`
      : '',
    names('partner') ? `Partners and integrations (never competitors): ${names('partner')}.` : ''
  ]
    .filter(Boolean)
    .join(' ')
}

/** Feeds rival and segment edits into the draft before the buyer profile is written. */
export async function feedDraftBeforeProfile(
  topics: TopicsService,
  draft: TopicDraft,
  rivals: readonly StartRival[],
  records: readonly StartEditRecord[]
): Promise<TopicDraft> {
  const edits = activeEdits(records)
  const edited = applyRivalEdits(rivals, edits)
  const segments = applyBuyerEdits({ who: null, segments: [], triggers: [] }, edits).segments
  return topics['topics:updateDraft']({
    projectId: draft.projectId,
    draftId: draft.id,
    patch: {
      about: rivalsAbout(edited),
      switchingFrom: edited
        .filter((rival) => rival.kind === 'switch_from')
        .map((rival) => rival.name),
      integrations: edited.filter((rival) => rival.kind === 'partner').map((rival) => rival.name),
      ...(segments.length > 0 ? { segments } : {})
    }
  })
}

/** Applies segment, trigger and "who" edits to the written profile, before questions are written. */
export async function feedProfileEdits(
  topics: TopicsService,
  draft: TopicDraft,
  records: readonly StartEditRecord[]
): Promise<TopicDraft> {
  const edits = activeEdits(records).filter(
    (edit) => edit.kind === 'segment' || edit.kind === 'trigger' || edit.kind === 'who'
  )
  if (edits.length === 0) return draft
  const points = currentProfilePoints(draft)
  const texts = (section: string): string[] =>
    points.filter((point) => point.section === section).map((point) => point.text)
  const edited = applyBuyerEdits(
    { who: texts('who')[0] ?? null, segments: texts('segments'), triggers: texts('triggers') },
    edits
  )
  const keep = points.filter(
    (point) =>
      point.section !== 'segments' && point.section !== 'triggers' && point.section !== 'who'
  )
  const next: TopicProfilePointInput[] = [
    ...(edited.who ? [{ section: 'who' as const, text: edited.who }] : []),
    ...texts('who')
      .slice(1)
      .map((text) => ({ section: 'who' as const, text })),
    ...edited.segments.map((text) => ({ section: 'segments' as const, text })),
    ...edited.triggers.map((text) => ({ section: 'triggers' as const, text })),
    ...keep.map((point) => ({
      id: point.id,
      section: point.section,
      text: point.text,
      foundIn: point.foundIn,
      verify: point.verify
    }))
  ]
  return topics['topics:updateDraft']({
    projectId: draft.projectId,
    draftId: draft.id,
    patch: { profile: { points: next, note: 'edited' } }
  })
}

/**
 * Makes the draft's questions match the edited list: drops removed ones,
 * updates edited text, adds the user's own. Returns the updated draft.
 */
export async function syncDraftQuestions(
  topics: TopicsService,
  draft: TopicDraft,
  wanted: readonly StartQuestion[]
): Promise<TopicDraft> {
  const questions = draft.prompts.filter((prompt) => prompt.kind === 'question')
  const wantedIds = new Set(wanted.map((question) => question.id))
  const removePromptIds = questions
    .filter((prompt) => prompt.included && !wantedIds.has(prompt.id))
    .map((prompt) => prompt.id)
  const upsertPrompts = wanted.flatMap((question): TopicDraftPromptInput[] => {
    const current = questions.find((prompt) => prompt.id === question.id)
    if (current === undefined) {
      return [{ kind: 'question' as const, text: question.text, source: 'user' as const }]
    }
    return current.text === question.text
      ? []
      : [{ id: current.id, kind: 'question' as const, text: question.text }]
  })
  if (removePromptIds.length === 0 && upsertPrompts.length === 0) return draft
  return topics['topics:updateDraft']({
    projectId: draft.projectId,
    draftId: draft.id,
    patch: {
      ...(removePromptIds.length > 0 ? { removePromptIds } : {}),
      ...(upsertPrompts.length > 0 ? { upsertPrompts } : {})
    }
  })
}

/**
 * The draft's own questions (Claude's), the base the user's edits apply to.
 * Questions the user added come back from their edits, so they are left out.
 */
export function draftQuestions(draft: TopicDraft): StartQuestion[] {
  return draft.prompts
    .filter((prompt) => prompt.kind === 'question' && prompt.included && prompt.source !== 'user')
    .map((prompt) => ({
      id: prompt.id,
      text: prompt.text,
      stage: prompt.stage,
      targetUrl: prompt.targetUrl
    }))
}

/** Written questions that name `name` (a whole word, any case). */
export function questionsNaming(
  questions: readonly StartQuestion[],
  name: string
): StartQuestion[] {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  if (escaped.length === 0) return []
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu')
  return questions.filter((question) => pattern.test(question.text))
}

/** The questions as they stand with edits applied (for follow-ups). */
export function editedQuestions(
  base: readonly StartQuestion[],
  records: readonly StartEditRecord[]
): StartQuestion[] {
  return applyQuestionEdits(base, records)
}

/** A rename follow-up: the same question with the new name in place of the old. */
export function renamedText(text: string, from: string, to: string): string {
  const escaped = from.trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return text.replace(new RegExp(escaped, 'giu'), to.trim())
}
