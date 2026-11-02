import type { PageBlockKind, PageEditChange, PageEditResult } from './ipc'

/**
 * The page edits as a document: the page's blocks in order, each suggested
 * change shown where it lands. A change is open (struck out or highlighted),
 * kept (applied: the struck text goes, the new text reads as normal) or undone
 * (the page as it was). Text the person typed over a block or a new block wins.
 */

export type Decision = 'open' | 'kept' | 'undone'

export interface EditState {
  /** By change id; a missing id is open. */
  decisions: Readonly<Record<string, Decision>>
  /** Typed text, by row key (`b:<block id>` or `c:<change id>`). */
  texts: Readonly<Record<string, string>>
}

export const EMPTY_STATE: EditState = { decisions: {}, texts: {} }

type AddChange = Extract<PageEditChange, { op: 'insert' | 'replace' }>
type CutChange = Extract<PageEditChange, { op: 'delete' | 'replace' }>

/** One row of the document. */
export type DocRow =
  | {
      type: 'block'
      key: string
      kind: PageBlockKind
      text: string
      /** The open change that removes this block (struck out), or null. */
      cut: CutChange | null
    }
  | {
      type: 'added'
      key: string
      kind: PageBlockKind
      text: string
      change: AddChange
      /** Still a suggestion (highlighted); false once kept. */
      open: boolean
    }

export function decisionOf(state: EditState, changeId: string): Decision {
  return state.decisions[changeId] ?? 'open'
}

/** The rows in reading order; undone suggestions and kept cuts are left out. */
export function docRows(
  edit: Pick<PageEditResult, 'blocks' | 'changes'>,
  state: EditState
): DocRow[] {
  const cuts = new Map<string, CutChange>()
  const after = new Map<string | null, AddChange[]>()
  const known = new Set(edit.blocks.map((block) => block.id))
  for (const change of edit.changes) {
    if (change.op === 'delete' || change.op === 'replace') {
      if (!known.has(change.block) || cuts.has(change.block)) continue
      cuts.set(change.block, change)
      if (change.op === 'replace') push(after, change.block, change)
    } else {
      push(after, change.after !== null && known.has(change.after) ? change.after : null, change)
    }
  }
  const rows: DocRow[] = []
  const addRows = (anchor: string | null): void => {
    for (const change of after.get(anchor) ?? []) {
      const decision = decisionOf(state, change.id)
      if (decision === 'undone') continue
      const key = `c:${change.id}`
      rows.push({
        type: 'added',
        key,
        kind: change.kind,
        text: state.texts[key] ?? change.text,
        change,
        open: decision === 'open'
      })
    }
  }
  addRows(null)
  for (const block of edit.blocks) {
    const cut = cuts.get(block.id) ?? null
    const decision = cut === null ? 'undone' : decisionOf(state, cut.id)
    if (decision !== 'kept') {
      const key = `b:${block.id}`
      rows.push({
        type: 'block',
        key,
        kind: block.kind,
        text: state.texts[key] ?? block.text,
        cut: decision === 'open' ? cut : null
      })
    }
    addRows(block.id)
  }
  return rows
}

/** Changes still to review. */
export function openCount(edit: Pick<PageEditResult, 'changes'>, state: EditState): number {
  return edit.changes.filter((change) => decisionOf(state, change.id) === 'open').length
}

/** Every open change set to one decision. */
export function decideAll(
  edit: Pick<PageEditResult, 'changes'>,
  state: EditState,
  decision: Decision
): EditState {
  const decisions = { ...state.decisions }
  for (const change of edit.changes)
    if (decisionOf(state, change.id) === 'open') decisions[change.id] = decision
  return { ...state, decisions }
}

export function decide(state: EditState, changeId: string, decision: Decision): EditState {
  return { ...state, decisions: { ...state.decisions, [changeId]: decision } }
}

export function typed(state: EditState, key: string, text: string): EditState {
  return { ...state, texts: { ...state.texts, [key]: text } }
}

/** "Remove", "Add", "Rewrite": the change in one word, for its buttons. */
export function changeVerb(change: PageEditChange): string {
  return change.op === 'delete' ? 'Remove' : change.op === 'insert' ? 'Add' : 'Rewrite'
}

/** A table block's markdown rows as cells; the `|---|` line is dropped. */
export function tableCells(text: string): string[][] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && !/^\|[\s:|-]+\|$/u.test(line))
    .map((line) =>
      line
        .replace(/^\|/u, '')
        .replace(/\|$/u, '')
        .split('|')
        .map((cell) => cell.trim())
    )
}

/** The saved decisions of one result (kept per fix and version, on this computer). */
export function storageKey(edit: Pick<PageEditResult, 'fixId' | 'savedAt'>): string {
  return `citefox.pageEdit.${edit.fixId}.${edit.savedAt}`
}

export function parseState(raw: string | null): EditState {
  if (raw === null) return EMPTY_STATE
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return EMPTY_STATE
    const { decisions, texts } = value as Record<string, unknown>
    return {
      decisions: stringRecord(
        decisions,
        (item): item is Decision => item === 'open' || item === 'kept' || item === 'undone'
      ),
      texts: stringRecord(texts, (item): item is string => typeof item === 'string')
    }
  } catch {
    return EMPTY_STATE
  }
}

function stringRecord<T>(value: unknown, ok: (item: unknown) => item is T): Record<string, T> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, T> = {}
  for (const [key, item] of Object.entries(value)) if (ok(item)) out[key] = item
  return out
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * What changed on the page, as plain text for "Log as a fix": every change not
 * undone (kept, or still open), with typed text in place of the suggestion.
 */
export function changeSummaryText(
  edit: Pick<PageEditResult, 'url' | 'blocks' | 'changes'>,
  state: EditState
): string {
  const blocks = new Map(edit.blocks.map((block) => [block.id, block]))
  const lines: string[] = []
  for (const change of edit.changes) {
    if (decisionOf(state, change.id) === 'undone') continue
    if (change.op === 'delete') {
      lines.push(`- Removed: ${blocks.get(change.block)?.text ?? ''}`)
      continue
    }
    const text = state.texts[`c:${change.id}`] ?? change.text
    lines.push(change.op === 'insert' ? `- Added: ${text}` : `- Rewrote: ${text}`)
  }
  return [`Page edits on ${edit.url}:`, ...lines].join('\n')
}
