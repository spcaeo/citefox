import type { BuyerProfile } from '@shared/domain'
import {
  PROFILE_PARTS,
  partList,
  patchFromList,
  type PartKey,
  type PlainPoint,
  type ProfilePatch
} from './model'

/**
 * One line of a regenerate diff. `same` is a point both versions have; a
 * `changed` line pairs a point only the old profile has with one only the new
 * profile has (either side may be missing), and the person keeps or replaces it.
 */
export interface DiffLine {
  /** `<part>:<n>`: stable for the drawer's choices. */
  id: string
  part: PartKey
  kind: 'same' | 'changed'
  before: PlainPoint | null
  after: PlainPoint | null
}

export interface PartDiff {
  part: PartKey
  lines: DiffLine[]
}

/** Keep the old point, or replace it with the new one. */
export type DiffChoice = 'keep' | 'replace'

function sameText(left: PlainPoint, right: PlainPoint): boolean {
  return left.text.trim().toLowerCase() === right.text.trim().toLowerCase()
}

/**
 * The old and new profile section by section. Points with the same wording
 * pair up as `same`; the rest pair in order, so a rewritten third trigger
 * sits next to the old third trigger.
 */
export function profileDiff(before: BuyerProfile, after: BuyerProfile): PartDiff[] {
  return PROFILE_PARTS.map((part) => {
    const old = partList(before, part)
    const next = partList(after, part)
    const matched = new Set<number>()
    const lines: DiffLine[] = []
    for (const point of old) {
      const twin = next.findIndex((item, index) => !matched.has(index) && sameText(item, point))
      if (twin >= 0) {
        matched.add(twin)
        lines.push({ id: '', part, kind: 'same', before: point, after: next[twin] ?? point })
      } else {
        lines.push({ id: '', part, kind: 'changed', before: point, after: null })
      }
    }
    const fresh = next.map((_point, index) => index).filter((index) => !matched.has(index))
    let cursor = 0
    for (const line of lines) {
      if (line.kind !== 'changed') continue
      const at = fresh[cursor]
      if (at === undefined) break
      line.after = next[at] ?? null
      cursor += 1
    }
    for (const at of fresh.slice(cursor)) {
      lines.push({ id: '', part, kind: 'changed', before: null, after: next[at] ?? null })
    }
    return { part, lines: lines.map((line, index) => ({ ...line, id: `${part}:${index}` })) }
  })
}

/** The changed lines only: the ones that take a choice. */
export function changedLines(diff: readonly PartDiff[]): DiffLine[] {
  return diff.flatMap((part) => part.lines.filter((line) => line.kind === 'changed'))
}

/**
 * The profile the choices make, as a `buyerProfile:update` patch of every
 * part. A line without a choice keeps the old point.
 */
export function applyDiff(
  diff: readonly PartDiff[],
  choices: Readonly<Record<string, DiffChoice>>
): ProfilePatch {
  const patch: ProfilePatch = {}
  for (const { part, lines } of diff) {
    const list: PlainPoint[] = []
    for (const line of lines) {
      const chosen =
        line.kind === 'same' || (choices[line.id] ?? 'keep') === 'keep' ? line.before : line.after
      if (chosen) list.push(chosen)
    }
    Object.assign(patch, patchFromList(part, list))
  }
  return patch
}
