import type { BuyerProfile, BuyerPrompt, NamedReason } from '@shared/domain'
import { phrasePromptIds } from '../readMatch'

/** The six parts of a page's buyer profile, in display order. */
export const PROFILE_PARTS = [
  'who',
  'environment',
  'segments',
  'triggers',
  'values',
  'poorFit'
] as const

export type PartKey = (typeof PROFILE_PARTS)[number]

export const PART_LABEL: Readonly<Record<PartKey, string>> = {
  who: 'Who they are',
  environment: 'Their environment',
  segments: 'Strongest segments',
  triggers: 'Trigger events',
  values: 'What they value',
  poorFit: 'Poor fit'
}

export const PART_HINT: Readonly<Record<PartKey, string>> = {
  who: 'The people who type these questions',
  environment: 'Tools and places they work',
  segments: 'Teams this fits best',
  triggers: 'What makes them search now',
  values: 'What they weigh, price included',
  poorFit: 'Who this is not for'
}

/** Parts whose points are "name — reason". */
export const NAMED_PARTS: ReadonlySet<PartKey> = new Set(['segments', 'poorFit'])

/** One point of the profile, as a grid row. */
export interface ProfileRow {
  id: string
  part: PartKey
  /** Position inside its part. */
  index: number
  text: string
  /** The reason of a named point (segments, poor fit). */
  reason: string | null
  /** Prompt ids that mention this point, for the drill count. Null when the part has none. */
  promptIds: readonly string[] | null
  /** The drill id (`audience:segment:0`), or null. */
  drillId: string | null
  drillTitle: string
  drillDescription: string
}

export const MENTION_NOTE =
  'Questions whose label or wording mentions this. Select one to see its AI Overview.'

const TRIGGER_NOTE =
  'Trigger-event questions whose wording matches this trigger. Select one to see its AI Overview.'

/** Every point of the profile, part by part. */
export function profileRows(profile: BuyerProfile, prompts: readonly BuyerPrompt[]): ProfileRow[] {
  const rows: ProfileRow[] = []
  const plain = (part: PartKey, index: number, text: string): ProfileRow => ({
    id: `${part}:${index}`,
    part,
    index,
    text,
    reason: null,
    promptIds: null,
    drillId: null,
    drillTitle: '',
    drillDescription: ''
  })
  if (profile.who.trim().length > 0) rows.push(plain('who', 0, profile.who))
  environmentParagraphs(profile.environment).forEach((text, index) =>
    rows.push(plain('environment', index, text))
  )
  profile.segments.forEach((segment, index) =>
    rows.push({
      ...plain('segments', index, segment.name),
      reason: segment.reason,
      promptIds: phrasePromptIds(segment.name, prompts),
      drillId: `audience:segment:${index}`,
      drillTitle: `Questions that mention “${segment.name}”`,
      drillDescription: MENTION_NOTE
    })
  )
  profile.triggers.forEach((trigger, index) =>
    rows.push({
      ...plain('triggers', index, trigger),
      promptIds: phrasePromptIds(trigger, prompts, { source: 'trigger_event' }),
      drillId: `audience:trigger:${index}`,
      drillTitle: `Questions written from “${trigger}”`,
      drillDescription: TRIGGER_NOTE
    })
  )
  profile.values.forEach((value, index) =>
    rows.push({
      ...plain('values', index, value),
      promptIds: phrasePromptIds(value, prompts),
      drillId: `audience:value:${index}`,
      drillTitle: `Questions that mention “${value}”`,
      drillDescription: MENTION_NOTE
    })
  )
  profile.poorFit.forEach((item, index) =>
    rows.push({ ...plain('poorFit', index, item.name), reason: item.reason })
  )
  return rows
}

export function environmentParagraphs(environment: string): string[] {
  return environment
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** A profile change as `buyerProfile:update` takes it. */
export interface ProfilePatch {
  who?: string
  environment?: string
  segments?: NamedReason[]
  triggers?: string[]
  values?: string[]
  poorFit?: NamedReason[]
}

/** One point as plain text: the reason is empty outside segments and poor fit. */
export interface PlainPoint {
  text: string
  reason: string
}

/** The part's points as plain lists. */
export function partList(profile: BuyerProfile, part: PartKey): PlainPoint[] {
  switch (part) {
    case 'who':
      return profile.who.trim() ? [{ text: profile.who, reason: '' }] : []
    case 'environment':
      return environmentParagraphs(profile.environment).map((text) => ({ text, reason: '' }))
    case 'segments':
      return profile.segments.map((item) => ({ text: item.name, reason: item.reason }))
    case 'triggers':
      return profile.triggers.map((text) => ({ text, reason: '' }))
    case 'values':
      return profile.values.map((text) => ({ text, reason: '' }))
    case 'poorFit':
      return profile.poorFit.map((item) => ({ text: item.name, reason: item.reason }))
  }
}

export function patchFromList(part: PartKey, list: readonly PlainPoint[]): ProfilePatch {
  switch (part) {
    case 'who':
      return { who: list.map((item) => item.text).join(' ') }
    case 'environment':
      return { environment: list.map((item) => item.text).join('\n') }
    case 'segments':
      return { segments: list.map((item) => ({ name: item.text, reason: item.reason })) }
    case 'triggers':
      return { triggers: list.map((item) => item.text) }
    case 'values':
      return { values: list.map((item) => item.text) }
    case 'poorFit':
      return { poorFit: list.map((item) => ({ name: item.text, reason: item.reason })) }
  }
}

/** Replaces one point's text (and reason). */
export function editPointPatch(
  profile: BuyerProfile,
  row: Pick<ProfileRow, 'part' | 'index'>,
  text: string,
  reason: string
): ProfilePatch {
  const list = partList(profile, row.part).map((item, index) =>
    index === row.index ? { text: text.trim(), reason: reason.trim() } : item
  )
  return patchFromList(row.part, list)
}

/** Adds one point at the end of its part. */
export function addPointPatch(
  profile: BuyerProfile,
  part: PartKey,
  text: string,
  reason: string
): ProfilePatch {
  return patchFromList(part, [
    ...partList(profile, part),
    { text: text.trim(), reason: reason.trim() }
  ])
}

/** Removes points, merging the patches of every part they touch. */
export function removePointsPatch(
  profile: BuyerProfile,
  rows: ReadonlyArray<Pick<ProfileRow, 'part' | 'index'>>
): ProfilePatch {
  const patch: ProfilePatch = {}
  const parts = new Set(rows.map((row) => row.part))
  for (const part of parts) {
    const gone = new Set(rows.filter((row) => row.part === part).map((row) => row.index))
    const list = partList(profile, part).filter((_item, index) => !gone.has(index))
    Object.assign(patch, patchFromList(part, list))
  }
  return patch
}

/** The parts as they are now, for an undo that puts them back. */
export function partsPatch(profile: BuyerProfile, parts: Iterable<PartKey>): ProfilePatch {
  const patch: ProfilePatch = {}
  for (const part of new Set(parts))
    Object.assign(patch, patchFromList(part, partList(profile, part)))
  return patch
}

/** "Who" is one sentence the prompts are written from: it can be edited, not removed. */
export function removable(row: Pick<ProfileRow, 'part'>): boolean {
  return row.part !== 'who'
}

/** The whole part as editable text (the "Edit buyer profile" panel). */
export function draftOf(profile: BuyerProfile, part: PartKey): string {
  switch (part) {
    case 'who':
      return profile.who
    case 'environment':
      return profile.environment
    case 'segments':
      return profile.segments.map((item) => `${item.name} — ${item.reason}`).join('\n')
    case 'triggers':
      return profile.triggers.join('\n')
    case 'values':
      return profile.values.join('\n')
    case 'poorFit':
      return profile.poorFit.map((item) => `${item.name} — ${item.reason}`).join('\n')
  }
}

/** Text from the edit panel back into a patch for that part. */
export function patchOf(part: PartKey, draft: string): ProfilePatch {
  const lines = draft
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (part === 'who') return { who: draft }
  if (part === 'environment') return { environment: draft }
  if (part === 'triggers') return { triggers: lines }
  if (part === 'values') return { values: lines }
  const named = lines.map(namedReason)
  if (part === 'segments') return { segments: named }
  return { poorFit: named }
}

/** "Name — reason" as a named point; the reason may be missing. */
export function namedReason(line: string): NamedReason {
  const [name, reason] = line.split('—').map((part) => part.trim())
  return { name: name ?? line, reason: reason ?? '' }
}

/** "24 points in 6 sections". */
export function rowsSummary(rows: readonly ProfileRow[]): string {
  const sections = new Set(rows.map((row) => row.part)).size
  return `${rows.length} ${rows.length === 1 ? 'point' : 'points'} in ${sections} ${sections === 1 ? 'section' : 'sections'}`
}
