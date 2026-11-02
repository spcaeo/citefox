import { ASSISTANT_ACTION_KINDS, type AssistantActionKind } from '@shared/ipc'

/**
 * Claude's Ask CiteFox reply, read against `ASSISTANT_REPLY_SCHEMA` in code
 * (the CLI may answer without enforcing it). A reply that breaks the shape is
 * rejected with one sentence naming the problem, for the one retry.
 */

export interface RawAction {
  kind: AssistantActionKind
  refs: readonly string[]
  questions: readonly string[]
  name: string | null
}

export interface RawReply {
  text: string
  sources: readonly string[]
  unknowns: readonly string[]
  draft: string | null
  questions: readonly string[]
  actions: readonly RawAction[]
}

const REF = /^[RNPH][0-9]{1,3}$/
const KEYS = ['text', 'sources', 'unknowns', 'draft', 'questions', 'actions']

export function readAssistantReply(value: unknown): { reply: RawReply } | { problem: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { problem: 'The reply was not a JSON object.' }
  }
  const record = value as Record<string, unknown>
  const extra = Object.keys(record).filter((key) => !KEYS.includes(key))
  if (extra.length > 0)
    return { problem: `The reply has fields the schema does not: ${extra.join(', ')}.` }
  const text = typeof record.text === 'string' ? cleanText(record.text, 1500) : ''
  if (text.length === 0) return { problem: '"text" must be a non-empty string.' }
  const sources = strings(record.sources, 12, 8).filter((ref) => REF.test(ref))
  const unknowns = strings(record.unknowns, 5, 300)
  const questions = strings(record.questions, 10, 300).filter((item) => item.length >= 3)
  const draft =
    record.draft === null || record.draft === undefined
      ? null
      : typeof record.draft === 'string'
        ? cleanText(record.draft, 4000, true) || null
        : undefined
  if (draft === undefined) return { problem: '"draft" must be a string or null.' }
  if (record.actions !== undefined && !Array.isArray(record.actions)) {
    return { problem: '"actions" must be a list.' }
  }
  const actions: RawAction[] = []
  for (const item of (record.actions as unknown[] | undefined) ?? []) {
    if (typeof item !== 'object' || item === null) continue
    const action = item as Record<string, unknown>
    const kind = action.kind
    if (typeof kind !== 'string' || !(ASSISTANT_ACTION_KINDS as readonly string[]).includes(kind))
      continue
    actions.push({
      kind: kind as AssistantActionKind,
      refs: strings(action.refs, 20, 8).filter((ref) => REF.test(ref)),
      questions: strings(action.questions, 10, 300),
      name: typeof action.name === 'string' ? cleanText(action.name, 120) || null : null
    })
    if (actions.length === 3) break
  }
  return { reply: { text, sources, unknowns, draft, questions, actions } }
}

function strings(value: unknown, max: number, length: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => cleanText(item, length))
    .filter((item) => item.length > 0)
    .slice(0, max)
}

/** Control characters out and the length capped; a draft keeps its line breaks. */
export function cleanText(value: string, max: number, keepLines = false): string {
  // eslint-disable-next-line no-control-regex
  const controls = keepLines ? /[\u0000-\u0009\u000b-\u001f\u007f]+/g : /[\u0000-\u001f\u007f]+/g
  const text = value.replace(controls, ' ')
  const flat = keepLines
    ? text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    : text.replace(/\s+/g, ' ')
  const trimmed = flat.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}
