import type { AssistantAnswer, AssistantSource } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { pageHash, promptHash, readHash, topicHash } from '../shell/routes'
import { formatMoment } from '../utils/dates'
import type { AiContext } from './context/types'

/** Ask CiteFox copy, in one place. */
export const ASSISTANT_COPY = {
  title: 'Ask CiteFox',
  footer:
    'Answers come from your stored checks. It never searches Google or changes anything without asking.',
  placeholder: 'Ask about this screen, or tell me what to do…',
  inputLabel: 'Your question',
  suggested: 'Suggested for this screen',
  lookingAt: 'Looking at',
  newChat: 'New chat',
  noProject:
    'No project is open. Ask about CiteFox itself, setting up, or your projects. Answers use only what CiteFox has stored.',
  noProjectSubtitle: 'answers from what CiteFox has stored',
  claudeNotReady:
    'CiteFox AI isn’t connected, so Ask CiteFox can’t answer yet. Nothing was sent. Connect it, then ask again.',
  claudeChecking: 'Checking the AI connection…',
  flagged: (count: number) =>
    `${count === 1 ? 'A number' : `${count} numbers`} in the answer ${count === 1 ? 'was' : 'were'} not in your saved data, so ${count === 1 ? 'that sentence was' : 'those sentences were'} taken out.`,
  notInData: 'Not in your saved data',
  noSearches: 'No searches'
} as const

export function askErrorText(error: unknown): string {
  return errorText(error, 'CiteFox could not answer that. Try again.')
}

/** Where a source opens: the stored check, the page read, or the page's results. */
export function sourceHref(source: AssistantSource): string | null {
  if (source.kind === 'page-read' && source.pageId) return readHash(source.pageId)
  if (source.kind === 'topic' && source.pageId) {
    return topicHash(source.pageId, {
      marketId: source.marketId,
      filter: source.promptId ? `target:${source.promptId}` : null
    })
  }
  if (source.kind === 'check' && source.pageId && source.promptId) {
    return promptHash(source.pageId, source.promptId, {
      marketId: source.marketId,
      runId: source.runId
    })
  }
  if (source.kind === 'page' && source.pageId) {
    return pageHash(source.pageId, 'results', {
      marketId: source.marketId,
      runId: null,
      filter: null
    })
  }
  return null
}

/** "Oct 23, 3:12 PM" from an ISO time, in the computer's own zone and clock (a check always shows its time). */
export function dayLabel(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return formatMoment(iso)
}

/** The "Looking at" chips: what the assistant will read for this screen. */
export function contextChips(context: AiContext): string[] {
  const chips: string[] = []
  const named = new Set<string>()
  const push = (text: string): void => {
    if (!named.has(text)) {
      named.add(text)
      chips.push(text)
    }
  }
  push(context.screenLabel)
  for (const item of context.entities) {
    if (chips.length >= 6) break
    const noun =
      item.kind === 'topic'
        ? 'Topic'
        : item.kind === 'page'
          ? 'Page'
          : item.kind === 'question'
            ? 'Question'
            : item.kind === 'check'
              ? 'Check'
              : item.kind === 'market'
                ? null
                : null
    push(noun ? `${noun}: ${item.label}` : item.label)
  }
  if (context.selection.length > 0) {
    push(`Selected: ${context.selection.length} ${context.selection.length === 1 ? 'row' : 'rows'}`)
  }
  for (const [key, value] of Object.entries(context.filters).slice(0, 2)) {
    if (key === 'picked') continue
    push(`${key[0]?.toUpperCase() ?? ''}${key.slice(1)}: ${value}`)
  }
  if (context.numbers.length > 0) {
    push(
      `${context.numbers.length} ${context.numbers.length === 1 ? 'number' : 'numbers'} on screen`
    )
  }
  return chips
}

/** "Based on 4 stored checks in 2 markets · checked through Oct 19 · Claude · on your plan · no searches". */
export function basedOnText(answer: AssistantAnswer): string {
  const parts: string[] = []
  const { checks, markets, checkedThrough } = answer.basedOn
  if (checks > 0) {
    parts.push(
      `Based on ${checks} stored ${checks === 1 ? 'check' : 'checks'}${markets > 0 ? ` in ${markets} ${markets === 1 ? 'market' : 'markets'}` : ''}`
    )
  } else {
    parts.push('Based on what this screen shows')
  }
  const day = dayLabel(checkedThrough)
  if (day) parts.push(`checked through ${day}`)
  if (answer.label) parts.push(answer.label.connectionText)
  parts.push(ASSISTANT_COPY.noSearches.toLowerCase())
  return parts.join(' · ')
}
