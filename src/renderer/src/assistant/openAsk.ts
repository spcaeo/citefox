import { ASSISTANT_QUESTION_MAX } from '@shared/ipc'
import { openDrawer } from '../shell/drawers'
import type { AiEntityKind, AiEntityRef } from './context/types'

/**
 * Opens Ask CiteFox over the current screen (`?drawer=ask`). The question and
 * what it is about go on the URL (`ask.q`, `ask.about=kind:id`), so a copied
 * link reopens the drawer with the question filled in. Sending it right away
 * (a ✦ menu pick) is kept here in memory only: a pasted link never runs
 * Claude by itself.
 */
export interface AskRequest {
  question?: string | null
  about?: AiEntityRef | null
  /** True for a ✦ pick: the drawer asks at once (when Claude is ready). */
  send?: boolean
}

export interface PendingAsk {
  question: string
  about: AiEntityRef | null
  send: boolean
}

let pending: PendingAsk | null = null

export function openAsk(request: AskRequest = {}): void {
  const question = (request.question ?? '').trim().slice(0, ASSISTANT_QUESTION_MAX)
  pending = {
    question,
    about: request.about ?? null,
    send: request.send === true && question !== ''
  }
  openDrawer('ask', {
    'ask.q': question || null,
    'ask.about': request.about ? aboutParam(request.about) : null
  })
}

/**
 * The request the drawer opened for, when it is for this question (an older
 * open's request is ignored). Reading it does not use it up: the drawer
 * reads it while rendering and calls {@link clearPendingAsk} once mounted.
 */
export function peekPendingAsk(question: string | null): PendingAsk | null {
  if (pending === null) return null
  return pending.question === (question ?? '') ? pending : null
}

/** Uses up the pending request, so reopening the drawer never sends it again. */
export function clearPendingAsk(): void {
  pending = null
}

/** Tests only. */
export function resetPendingAsk(): void {
  pending = null
}

/** `kind:id` for an entity with an id, else just `kind` (labels stay off the URL). */
export function aboutParam(about: AiEntityRef): string {
  return about.id ? `${about.kind}:${about.id}` : about.kind
}

const KINDS: ReadonlySet<string> = new Set<AiEntityKind>([
  'project',
  'page',
  'topic',
  'question',
  'market',
  'check',
  'competitor',
  'domain',
  'fix',
  'kpi',
  'chart',
  'section',
  'setting',
  'template',
  'report',
  'community',
  'video',
  'group',
  'alert',
  'connection'
])

/** The entity in an `ask.about` value. Null for anything unknown. */
export function parseAbout(
  value: string | null | undefined
): Pick<AiEntityRef, 'kind' | 'id'> | null {
  if (!value) return null
  const at = value.indexOf(':')
  const kind = at < 0 ? value : value.slice(0, at)
  const id = at < 0 ? null : value.slice(at + 1)
  if (!KINDS.has(kind)) return null
  if (id !== null && !/^[A-Za-z0-9._-]{1,120}$/.test(id)) return null
  return { kind: kind as AiEntityKind, id }
}
