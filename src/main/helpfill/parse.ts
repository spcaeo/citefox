import {
  HELPFILL_ITEM_CHARS,
  HELPFILL_ITEMS_MAX,
  HELPFILL_PASTE_MAX,
  HELPFILL_SENTENCE_MAX,
  type HelpFillDescribeRequest,
  type HelpFillEstimateRequest,
  type HelpFillPromptRequest,
  type HelpFillReadRequest,
  type HelpFillScope
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { getHelpFillKind } from './registry'
import type { HelpFillKindDef } from './types'

/**
 * Request parsing for `helpfill:*`. Every field is checked and unknown keys are
 * rejected; a bad request fails with the channel name only. The kind must be
 * registered, a page-scoped kind needs a page or topic, and a count is clamped to
 * the kind's range. `items` (the place's own rows, Match pages) may be left out.
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

type Rec = Record<string, unknown>

function rec(
  value: unknown,
  channel: string,
  keys: readonly string[],
  optional: readonly string[] = []
): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Rec
  for (const key of Object.keys(record)) {
    if (!keys.includes(key) && !optional.includes(key)) throw new IpcRequestError(channel)
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new IpcRequestError(channel)
  }
  return record
}

function id(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function kindOf(value: unknown, channel: string): HelpFillKindDef {
  if (typeof value !== 'string' || value.length > 40) throw new IpcRequestError(channel)
  const definition = getHelpFillKind(value)
  if (definition === null) throw new IpcRequestError(channel, 'That helper is not available.')
  return definition
}

/** Scope keys a request may leave out (a rows kind sends `{ pageId }` only). */
const OPTIONAL_SCOPE = ['promptId', 'subject'] as const

function scopeOf(value: unknown, channel: string, definition: HelpFillKindDef): HelpFillScope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const given = Object.keys(value)
  const keys = ['pageId', ...OPTIONAL_SCOPE.filter((key) => given.includes(key))]
  const r = rec(value, channel, keys)
  const pageId = r.pageId === null ? null : id(r.pageId, channel)
  if (definition.scope === 'page' && pageId === null) {
    throw new IpcRequestError(channel, 'Pick a page or topic first.')
  }
  const scope: HelpFillScope = { pageId }
  for (const key of OPTIONAL_SCOPE) {
    const raw = r[key]
    const parsed = raw === undefined || raw === null ? null : id(raw, channel)
    if (parsed !== null) scope[key] = parsed
    if (parsed === null && definition.needs?.includes(key)) {
      throw new IpcRequestError(
        channel,
        key === 'promptId' ? 'Pick a question first.' : 'Pick what to write about first.'
      )
    }
  }
  return scope
}

function text(value: unknown, channel: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new IpcRequestError(channel)
  return value
}

/** The place's own rows: absent, or up to HELPFILL_ITEMS_MAX strings of HELPFILL_ITEM_CHARS. */
function items(value: unknown, channel: string): { items?: string[] } {
  if (value === undefined) return {}
  if (!Array.isArray(value) || value.length > HELPFILL_ITEMS_MAX) throw new IpcRequestError(channel)
  return { items: value.map((item) => text(item, channel, HELPFILL_ITEM_CHARS)) }
}

/** A whole number clamped to 1..the kind's most. */
function count(value: unknown, channel: string, most: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new IpcRequestError(channel)
  return Math.min(most, Math.max(1, Math.round(value)))
}

export function parseHelpFillEstimate(value: unknown): HelpFillEstimateRequest {
  const c = 'helpfill:estimate'
  const r = rec(value, c, ['kind', 'projectId'])
  return { kind: kindOf(r.kind, c).kind, projectId: id(r.projectId, c) }
}

export function parseHelpFillPrompt(value: unknown): HelpFillPromptRequest {
  const c = 'helpfill:prompt'
  const r = rec(value, c, ['kind', 'projectId', 'scope', 'count'], ['items'])
  const definition = kindOf(r.kind, c)
  return {
    kind: definition.kind,
    projectId: id(r.projectId, c),
    scope: scopeOf(r.scope, c, definition),
    // The chatbot is free, so it may ask for more than Describe does.
    count: r.count === null ? null : count(r.count, c, Math.max(definition.chatbotCount, 50)),
    ...items(r.items, c)
  }
}

export function parseHelpFillRead(value: unknown): HelpFillReadRequest {
  const c = 'helpfill:read'
  const r = rec(value, c, ['kind', 'projectId', 'scope', 'text'], ['items'])
  const definition = kindOf(r.kind, c)
  return {
    kind: definition.kind,
    projectId: id(r.projectId, c),
    scope: scopeOf(r.scope, c, definition),
    text: text(r.text, c, HELPFILL_PASTE_MAX),
    ...items(r.items, c)
  }
}

export function parseHelpFillDescribe(value: unknown): HelpFillDescribeRequest {
  const c = 'helpfill:describe'
  const r = rec(value, c, ['kind', 'projectId', 'scope', 'sentence', 'count'], ['items'])
  const definition = kindOf(r.kind, c)
  return {
    kind: definition.kind,
    projectId: id(r.projectId, c),
    scope: scopeOf(r.scope, c, definition),
    sentence: text(r.sentence, c, HELPFILL_SENTENCE_MAX),
    count: count(r.count, c, definition.maxCount),
    ...items(r.items, c)
  }
}
