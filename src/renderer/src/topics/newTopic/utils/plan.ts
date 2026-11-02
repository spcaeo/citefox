import {
  TOPIC_STAGES,
  type TopicDraft,
  type TopicDraftPrompt,
  type TopicStage
} from '@shared/domain'
import type { QuestionRow, QuestionsList, TopicPageCandidate } from '@shared/ipc'
import type { NewTopicWay } from '../types'

/** About ten questions across the six stages for the preview (custom depth). */
export const PREVIEW_PER_STAGE: Readonly<Record<TopicStage, number>> = {
  problem: 2,
  options: 2,
  doubts: 2,
  fit: 1,
  compare: 2,
  decide: 1
}

/** Tracked questions sent to "questions that fit this topic", at most. */
export const FIT_LIMIT = 100

/** The four ways to start, as the cards word them (NewTopic.dc.html). */
export const WAY_COPY: Readonly<Record<NewTopicWay, { title: string; body: string }>> = {
  problem: {
    title: 'A buyer problem',
    body: 'Describe the situation. We write the questions buyers ask at each stage.'
  },
  page: {
    title: 'One of my pages',
    body: 'Pick a page. We read it and write the questions it should answer.'
  },
  questions: {
    title: 'My own questions',
    body: 'Paste a list, or pick questions you already track.'
  },
  competitor: {
    title: 'A competitor’s page',
    body: 'Paste a URL that gets cited. We find the questions it wins.'
  }
}

/** The draft's buyer questions that go into the topic (included, not flagged for the brand). */
export function includedQuestions(draft: TopicDraft | null): TopicDraftPrompt[] {
  if (draft === null) return []
  return draft.prompts.filter(
    (prompt) =>
      prompt.kind === 'question' &&
      prompt.included &&
      prompt.text.trim().length > 0 &&
      !prompt.flags.includes('brand')
  )
}

/** Every buyer question of the draft, included or not, in stage order (no stage last). */
export function draftQuestions(draft: TopicDraft | null): TopicDraftPrompt[] {
  if (draft === null) return []
  const rank = (prompt: TopicDraftPrompt): number =>
    prompt.stage === null ? TOPIC_STAGES.length : TOPIC_STAGES.indexOf(prompt.stage)
  return draft.prompts
    .filter((prompt) => prompt.kind === 'question')
    .map((prompt, index) => ({ prompt, index }))
    .sort((a, b) => rank(a.prompt) - rank(b.prompt) || a.index - b.index)
    .map((item) => item.prompt)
}

/** One question per stage for the preview grid, in journey order. */
export function previewLines(
  prompts: readonly TopicDraftPrompt[]
): { stage: TopicStage; text: string }[] {
  return TOPIC_STAGES.flatMap((stage) => {
    const first = prompts.find((prompt) => prompt.stage === stage)
    return first ? [{ stage, text: first.text }] : []
  })
}

/** Questions that sit on a page, not in a topic (the ones a new topic can take in). */
export function unassignedRows(list: QuestionsList | null): QuestionRow[] {
  if (list === null) return []
  const pages = new Set(
    list.sources.filter((source) => source.kind !== 'topic').map((source) => source.id)
  )
  return list.rows.filter((row) => pages.has(row.sourceId))
}

/**
 * The tracked questions the picker shows: the ones already picked (from any page or
 * topic) first, then the questions not in a topic.
 */
export function pickerRows(list: QuestionsList | null, picked: ReadonlySet<string>): QuestionRow[] {
  if (list === null) return []
  const first = list.rows.filter((row) => picked.has(row.promptId))
  const rest = unassignedRows(list).filter((row) => !picked.has(row.promptId))
  return [...first, ...rest]
}

/** The picked rows as the move channels name them. */
export function pickedRefs(
  list: QuestionsList | null,
  picked: ReadonlySet<string>
): { sourceId: string; promptId: string }[] {
  if (list === null) return []
  return list.rows
    .filter((row) => picked.has(row.promptId))
    .map((row) => ({ sourceId: row.sourceId, promptId: row.promptId }))
}

/** "3 questions", "1 question". */
export function countText(value: number, noun = 'question'): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? noun : `${noun}s`}`
}

/** The draft path a way starts: one of my pages is the seed path with every target set. */
export function pathFor(way: NewTopicWay): 'seed' | 'questions' | 'competitor' {
  if (way === 'questions') return 'questions'
  if (way === 'competitor') return 'competitor'
  return 'seed'
}

/** The way a saved draft was started, when the URL does not say. */
export function wayOfDraft(draft: TopicDraft): NewTopicWay {
  if (draft.path === 'questions') return 'questions'
  if (draft.path === 'competitor') return 'competitor'
  return 'problem'
}

/** The page's title, else its path, for a select option. */
export function pageLabel(url: string, candidates: readonly TopicPageCandidate[]): string {
  const title = candidates.find((candidate) => candidate.url === url)?.title
  if (title) return title
  try {
    return new URL(url).pathname || url
  } catch {
    return url
  }
}
