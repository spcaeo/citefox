import { useCallback, useSyncExternalStore } from 'react'
import type { ActionOutcome } from './runAction'
import {
  ASSISTANT_HISTORY_MAX,
  type AssistantAnswer,
  type AssistantContextInput,
  type AssistantTurn
} from '@shared/ipc'
import type { AssistantClient } from './client'
import { askErrorText } from './words'

/**
 * The conversation, per project, for this session: closing the drawer and
 * opening it again (Back, ⌘J) keeps it; "New chat" clears it. Follow-ups send
 * the last turns as short summaries, never the rows again.
 */

export interface Turn {
  id: string
  question: string
  /** Where it was asked: "Topics", "Results". */
  where: string
  status: 'asking' | 'done' | 'error'
  answer: AssistantAnswer | null
  error: string | null
}

type Listener = () => void

export type SettledCard = { kind: 'done'; outcome: ActionOutcome } | { kind: 'skipped' }

export function settledCard(key: string | undefined): SettledCard | null {
  return key === undefined ? null : (settledCards.get(key) ?? null)
}

export function settleCard(key: string | undefined, value: SettledCard): void {
  if (key !== undefined) settledCards.set(key, value)
}

const threads = new Map<string, readonly Turn[]>()
/**
 * Action cards already confirmed or put away, by turn and action, so a card
 * drawn again (the drawer reopened on another screen) cannot run twice.
 */
const settledCards = new Map<string, SettledCard>()
const listeners = new Set<Listener>()
let seed = 0
const EMPTY: readonly Turn[] = []

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setThread(projectId: string, turns: readonly Turn[]): void {
  threads.set(projectId, turns)
  emit()
}

function patchTurn(projectId: string, id: string, patch: Partial<Turn>): void {
  const turns = threads.get(projectId) ?? EMPTY
  setThread(
    projectId,
    turns.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn))
  )
}

/** Tests only. */
export function resetThreads(): void {
  threads.clear()
  settledCards.clear()
  emit()
}

/** The turns sent with a follow-up: the last answered ones, short. */
export function historyOf(turns: readonly Turn[]): AssistantTurn[] {
  return turns
    .filter((turn) => turn.status === 'done' && turn.answer !== null)
    .slice(-ASSISTANT_HISTORY_MAX)
    .map((turn) => ({
      question: turn.question,
      answer: (turn.answer?.text ?? '').slice(0, 400)
    }))
}

export interface Thread {
  turns: readonly Turn[]
  asking: boolean
  ask(question: string, context: AssistantContextInput): Promise<void>
  clear(): void
}

/** The conversation asked with no project open (project ids are never empty). */
const APP_THREAD = ''

export function useAssistantThread(client: AssistantClient, projectId: string | null): Thread {
  const key = projectId ?? APP_THREAD
  const turns = useSyncExternalStore(
    subscribe,
    () => threads.get(key) ?? EMPTY,
    () => EMPTY
  )
  const asking = turns.some((turn) => turn.status === 'asking')

  const ask = useCallback(
    async (question: string, context: AssistantContextInput): Promise<void> => {
      const text = question.trim()
      if (text.length === 0) return
      const before = threads.get(key) ?? EMPTY
      if (before.some((turn) => turn.status === 'asking')) return
      seed += 1
      const id = `turn-${seed}`
      setThread(key, [
        ...before,
        {
          id,
          question: text,
          where: context.screenLabel,
          status: 'asking',
          answer: null,
          error: null
        }
      ])
      try {
        const answer = await client.ask({
          projectId,
          question: text,
          context,
          history: historyOf(before)
        })
        patchTurn(key, id, { status: 'done', answer })
      } catch (failure) {
        patchTurn(key, id, { status: 'error', error: askErrorText(failure) })
      }
    },
    [client, projectId, key]
  )

  const clear = useCallback(() => setThread(key, EMPTY), [key])

  return { turns, asking, ask, clear }
}
