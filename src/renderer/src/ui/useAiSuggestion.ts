import type { AssistResult } from '@shared/ipc'
import { useAssist, type AssistState, type UseAssistOptions } from '../assist/useAssist'
import type { SuggestionCardProps, SuggestionItem, SuggestionStatus } from './SuggestionCard'

/** The SuggestionCard props that come from one assist run. */
export type AiSuggestionProps = Pick<
  SuggestionCardProps,
  | 'title'
  | 'body'
  | 'items'
  | 'recheckCount'
  | 'status'
  | 'error'
  | 'footnote'
  | 'onRetry'
  | 'progress'
  | 'reads'
  | 'expectedSeconds'
>

export interface AiSuggestion {
  /** The underlying assist state (`run`, `close`, `result`). */
  assist: AssistState
  /** False while idle: render the card only when `open` is true. */
  open: boolean
  /** Spread on `<SuggestionCard>`, then add `onApply` (the screen's own write) and `onClose`. */
  card: AiSuggestionProps
}

/** "about 20 s · no searches", from a run's duration and what it reads. */
export function suggestionFootnote(result: AssistResult): string {
  const seconds = Math.max(1, Math.round(result.durationMs / 1000))
  const reads = result.savedDataOnly && result.searchesUsed === 0 ? 'no searches' : null
  return [`CiteFox AI · about ${seconds} s`, reads].filter(Boolean).join(' · ')
}

/** Assist items as suggestion items. A `tag` becomes the small label above the text. */
export function suggestionItems(result: AssistResult): SuggestionItem[] {
  return result.items.map((item) => ({
    id: item.id,
    text: item.text,
    ...(item.tag ? { label: item.tag } : {}),
    detail: item.verify ? `[Re-check] ${item.verify}` : item.detail
  }))
}

function statusOf(phase: AssistState['phase']): SuggestionStatus {
  if (phase === 'running') return 'running'
  if (phase === 'error') return 'error'
  return 'ready'
}

/**
 * One AI menu action wired to the assist channels (FR-25), shaped for a
 * SuggestionCard. Nothing is written: Apply belongs to the screen, which passes
 * its own `onApply`. Unconfirmed facts (`verify`) count toward the re-check row.
 */
export function useAiSuggestion(
  options: UseAssistOptions,
  fallbackTitle = 'Suggestion'
): AiSuggestion {
  const assist = useAssist(options)
  const { result, phase, error } = assist
  const title = result?.title ?? assist.description?.title ?? fallbackTitle
  const recheckCount = result ? result.items.filter((item) => item.verify).length : 0
  const card: AiSuggestionProps = {
    title,
    status: statusOf(phase),
    error,
    onRetry: (instruction) => assist.run(instruction ?? null),
    progress: assist.progress,
    ...(assist.description?.savedDataOnly === false ? {} : { reads: 'no new searches' }),
    ...(assist.description ? { expectedSeconds: assist.description.label.expectedSeconds } : {}),
    ...(result
      ? {
          body: result.summary ?? undefined,
          items: suggestionItems(result),
          footnote: suggestionFootnote(result),
          ...(recheckCount > 0 ? { recheckCount } : {})
        }
      : {})
  }
  return { assist, open: phase !== 'idle', card }
}
