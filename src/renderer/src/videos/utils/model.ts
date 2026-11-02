import {
  VIDEO_CHECKLIST_ITEMS,
  VIDEO_STEPS,
  type Market,
  type PageSummary,
  type PromptCheckStatus,
  type VideoBrief,
  type VideoChecklistItem,
  type VideoIdea,
  type VideoStep
} from '@shared/domain'
import { marketLabel } from '../../shell/model'
import { errorText } from '../../components/errorText'

/** FR-18.2 board columns, in flow order. */
export const STEP_COLUMNS: readonly { step: VideoStep; label: string }[] = [
  { step: 'idea', label: 'Idea' },
  { step: 'brief', label: 'Brief' },
  { step: 'sent', label: 'Sent' },
  { step: 'published', label: 'Published' },
  { step: 'tracking', label: 'Tracking' }
]

/** The status pill for an idea's step. */
export function stepLabel(step: VideoStep): string {
  switch (step) {
    case 'idea':
      return 'Suggested'
    case 'brief':
      return 'Brief ready'
    case 'sent':
      return 'Sent to FoxCue'
    case 'published':
      return 'Published'
    case 'tracking':
      return 'Tracking'
  }
}

/** Ideas grouped into the five board columns. Each idea is in exactly one column. */
export function boardColumns(
  ideas: readonly VideoIdea[]
): { step: VideoStep; label: string; ideas: VideoIdea[] }[] {
  return STEP_COLUMNS.map((column) => ({
    ...column,
    ideas: ideas.filter((idea) => idea.step === column.step)
  }))
}

/** Ranked by evidence, then a deadline first, then the question (FR-18.2). */
export function sortIdeas(ideas: readonly VideoIdea[]): VideoIdea[] {
  return [...ideas].sort(
    (left, right) =>
      right.evidence - left.evidence ||
      Number(right.deadline !== null) - Number(left.deadline !== null) ||
      left.question.localeCompare(right.question)
  )
}

/** Whole percent of `of`, or an em dash when there is nothing to divide by. */
export function kpiPercent(part: number, of: number): string {
  if (of <= 0) return '—'
  return `${Math.round((part / of) * 100)}%`
}

/** FR-18.6 checklist wording. */
export function checklistLabel(item: VideoChecklistItem): string {
  switch (item) {
    case 'title_wording':
      return "The title uses the buyer's own wording"
    case 'chapters':
      return 'Chapters are in the description'
    case 'captions':
      return 'Captions are uploaded'
    case 'description_link':
      return 'The description links the page'
    case 'embedded':
      return 'The video is embedded on the page'
    case 'video_object':
      return 'The page has VideoObject structured data'
    case 'faq_link':
      return 'The video is linked in the matching FAQ'
  }
}

export const CHECKLIST: readonly VideoChecklistItem[] = VIDEO_CHECKLIST_ITEMS

/** Checklist with `item` turned on or off, kept in the fixed order. */
export function toggleChecklist(
  current: readonly VideoChecklistItem[],
  item: VideoChecklistItem,
  on: boolean
): VideoChecklistItem[] {
  const next = new Set(current)
  if (on) next.add(item)
  else next.delete(item)
  return VIDEO_CHECKLIST_ITEMS.filter((entry) => next.has(entry))
}

/** Teleprompter line after a key press, clamped to the script. Null for other keys. */
export function teleprompterLine(current: number, count: number, key: string): number | null {
  if (count <= 0) return null
  if (key === 'ArrowDown' || key === 'ArrowRight' || key === 'PageDown' || key === ' ') {
    return Math.min(count - 1, current + 1)
  }
  if (key === 'ArrowUp' || key === 'ArrowLeft' || key === 'PageUp') return Math.max(0, current - 1)
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** True when `step` is at or past `reached` in the flow. */
export function stepReached(step: VideoStep, reached: VideoStep): boolean {
  return VIDEO_STEPS.indexOf(step) >= VIDEO_STEPS.indexOf(reached)
}

/** The idea flow's steps (FR-18.3), in order: the drawer's left stepper and `?idea.step=`. */
export const FLOW_STEPS = ['question', 'brief', 'storyboard', 'make', 'publish', 'track'] as const

export type FlowStepId = (typeof FLOW_STEPS)[number]

export function isFlowStep(value: string | null | undefined): value is FlowStepId {
  return FLOW_STEPS.some((step) => step === value)
}

/** The six-step flow (FR-18.3) and which steps are done for this idea. */
export function flowSteps(
  idea: VideoIdea
): { n: number; id: FlowStepId; label: string; done: boolean }[] {
  return [
    { n: 1, id: 'question', label: 'Question', done: true },
    { n: 2, id: 'brief', label: 'Brief', done: idea.brief !== null },
    { n: 3, id: 'storyboard', label: 'Storyboard', done: idea.brief !== null },
    {
      n: 4,
      id: 'make',
      label: 'Make',
      done: idea.sentToFoxcueAt !== null || stepReached(idea.step, 'published')
    },
    {
      n: 5,
      id: 'publish',
      label: 'Publish',
      done: idea.checklist.length >= CHECKLIST.length || idea.step === 'tracking'
    },
    { n: 6, id: 'track', label: 'Track', done: idea.step === 'tracking' }
  ]
}

/**
 * The step an idea opens on when the URL names none: the question until a
 * brief exists, then the first step not done yet (Track once it is tracked).
 */
export function defaultFlowStep(idea: VideoIdea): FlowStepId {
  if (idea.brief === null) return 'question'
  return flowSteps(idea).find((step) => !step.done)?.id ?? 'track'
}

export function marketName(markets: readonly Market[], id: string): string {
  const market = markets.find((item) => item.id === id)
  return market === undefined ? id : marketLabel(market)
}

/** A check's result in the app's words (ui/resultTones.ts). */
export function statusLabel(status: PromptCheckStatus): string {
  switch (status) {
    case 'page_cited':
      return 'Right page'
    case 'other_own_page':
      return 'Your other page'
    case 'brand_mentioned':
      return 'Named, not linked'
    case 'not_cited':
      return 'Not cited'
    case 'no_aio':
      return 'No AI Overview'
    case 'error':
      return 'Check failed'
  }
}

/** "Prompt 3" or "Prompts 2, 5". */
export function promptsLabel(positions: readonly number[]): string {
  if (positions.length === 0) return 'No question'
  const sorted = [...positions].sort((a, b) => a - b)
  return `${sorted.length === 1 ? 'Question' : 'Questions'} ${sorted.join(', ')}`
}

/** `Oct 19, 2026` in the viewer's time zone (NFR-15). */
export function formatDate(iso: string | null): string {
  if (iso === null) return '—'
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Pages the scope picker lists: tracked and paused ones. */
export function scopePages(pages: readonly PageSummary[]): PageSummary[] {
  return pages.filter((page) => page.status === 'tracked' || page.status === 'paused')
}

export function pageName(page: Pick<PageSummary, 'label' | 'title' | 'url'>): string {
  return page.label ?? page.title ?? page.url ?? 'Topic'
}

/** The whole brief as plain text for the clipboard. */
export function briefText(
  brief: VideoBrief,
  idea: Pick<VideoIdea, 'question' | 'pageUrl'>
): string {
  const lines = [
    `Title: ${brief.title}`,
    `Answers: ${idea.question}`,
    `Page: ${idea.pageUrl}`,
    '',
    `Hook (first 10 seconds): ${brief.hook}`,
    '',
    'Chapters:',
    ...brief.chapters.map((chapter) => `${chapter.at} ${chapter.name}`),
    '',
    'Script:',
    ...brief.script.map(
      (line) => `${line.at} ${line.text}${line.source === null ? '' : ` [${line.source}]`}`
    ),
    '',
    'Where each claim comes from:',
    ...brief.sources.map(
      (source) => `${source.n}. ${source.section}${source.onPage ? '' : ' (not on the page yet)'}`
    ),
    '',
    'YouTube description:',
    brief.description,
    '',
    `Thumbnail text: ${brief.thumbnailText}`,
    `Tags: ${brief.tags.join(', ')}`
  ]
  return lines.join('\n')
}

/** Electron's invoke wrapper and the `channel:` prefix removed, for plain error text. */
export function plainError(cause: unknown, fallback: string): string {
  return errorText(cause, fallback)
}

/** "n of m answers" for tracking counts. */
export function ofAnswers(part: number | null, whole: number | null): string {
  if (part === null || whole === null) return 'No check before'
  return `${part} of ${whole} ${whole === 1 ? 'answer' : 'answers'}`
}
