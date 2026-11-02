import type { BuyerProfile } from '@shared/domain'
import type { HelpFillRow } from '@shared/ipc'
import type { SuggestionItem } from '../../ui'
import type { ProfilePatch } from './model'

/**
 * ✦ Help me fill this on the buyer profile: each drafted buyer type (`who`, `problem`,
 * `trigger`, `need`) becomes up to three kinds of suggestion for the profile's own
 * review card: a segment ("who — problem"), its trigger events and what they value.
 * A cell may hold several points, one per line (Describe shares new triggers out that
 * way). Points the profile already holds, or that an earlier row already offered,
 * are left out. Pure.
 */

export type HelpPointKind = 'segment' | 'trigger' | 'value'

export interface HelpPoint extends SuggestionItem {
  kind: HelpPointKind
  /** The segment name, the trigger or the value as it would be saved. */
  text: string
  /** A segment's reason; empty otherwise. */
  reason: string
}

/** A segment's reason when the row gave no problem. */
export const NO_REASON = 'Suggested for this page.'

const LABEL: Readonly<Record<HelpPointKind, string>> = {
  segment: 'Segment',
  trigger: 'Trigger event',
  value: 'What they value'
}

export function helpPoints(rows: readonly HelpFillRow[], profile: BuyerProfile): HelpPoint[] {
  const seen: Record<HelpPointKind, Set<string>> = {
    segment: new Set(profile.segments.map((segment) => fold(segment.name))),
    trigger: new Set(profile.triggers.map(fold)),
    value: new Set(profile.values.map(fold))
  }
  const points: HelpPoint[] = []
  const offer = (
    kind: HelpPointKind,
    id: string,
    text: string,
    reason: string,
    who: string
  ): void => {
    const key = fold(text)
    if (key.length === 0 || seen[kind].has(key)) return
    seen[kind].add(key)
    points.push({
      id,
      kind,
      label: LABEL[kind],
      text,
      reason,
      // "For …" tells several buyer types apart; with one it only repeats.
      detail: kind === 'segment' ? reason || null : rows.length > 1 ? `For ${who}` : null
    })
  }
  for (const row of rows) {
    const who = (row.values.who ?? '').trim()
    // A saved segment always has a reason.
    const problem = (row.values.problem ?? '').trim() || NO_REASON
    offer('segment', `${row.id}:segment`, who, problem, who)
    lines(row.values.trigger).forEach((text, index) =>
      offer('trigger', `${row.id}:trigger:${index}`, text, '', who)
    )
    lines(row.values.need).forEach((text, index) =>
      offer('value', `${row.id}:value:${index}`, text, '', who)
    )
  }
  return points
}

/** The ticked points added to the end of their parts, as one `buyerProfile:update`. */
export function helpPatch(
  profile: BuyerProfile,
  points: readonly HelpPoint[],
  ids: readonly string[]
): ProfilePatch {
  const chosen = points.filter((point) => ids.includes(point.id))
  const of = (kind: HelpPointKind): HelpPoint[] => chosen.filter((point) => point.kind === kind)
  const patch: ProfilePatch = {}
  if (of('segment').length > 0) {
    patch.segments = [
      ...profile.segments,
      ...of('segment').map((point) => ({ name: point.text, reason: point.reason }))
    ]
  }
  if (of('trigger').length > 0) {
    patch.triggers = [...profile.triggers, ...of('trigger').map((point) => point.text)]
  }
  if (of('value').length > 0) {
    patch.values = [...profile.values, ...of('value').map((point) => point.text)]
  }
  return patch
}

/**
 * The parts a patch changes, as they are now (the Undo). Null when one of them is empty
 * now: `buyerProfile:update` never empties a part, so that add cannot be undone.
 */
export function helpUndo(profile: BuyerProfile, patch: ProfilePatch): ProfilePatch | null {
  const undo: ProfilePatch = {}
  if (patch.segments) undo.segments = [...profile.segments]
  if (patch.triggers) undo.triggers = [...profile.triggers]
  if (patch.values) undo.values = [...profile.values]
  const empty = Object.values(undo).some((list: readonly unknown[]) => list.length === 0)
  return empty ? null : undo
}

/** "3 segments · 4 trigger events · 2 values". */
export function helpMeta(points: readonly HelpPoint[]): string {
  const count = (kind: HelpPointKind, one: string, many: string): string | null => {
    const n = points.filter((point) => point.kind === kind).length
    return n === 0 ? null : `${n} ${n === 1 ? one : many}`
  }
  return (
    [
      count('segment', 'segment', 'segments'),
      count('trigger', 'trigger event', 'trigger events'),
      count('value', 'value', 'values')
    ]
      .filter((part): part is string => part !== null)
      .join(' · ') || 'Nothing new for this profile'
  )
}

function lines(value: string | undefined): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
