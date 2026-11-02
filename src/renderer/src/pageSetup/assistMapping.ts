import type { BuyerProfileBody, IntentStage, NamedReason, PromptSource } from '@shared/domain'
import type { AddPromptRequest, AssistItem, UpdateBuyerProfileRequest } from '@shared/ipc'

/**
 * Turns assist items into the screens' own requests (FR-25.2). The assists only
 * suggest; these helpers build what Apply, Add and Undo send.
 */

export type ProfilePart = keyof BuyerProfileBody

type ProfilePatch = Omit<UpdateBuyerProfileRequest, 'projectId' | 'pageId'>

const PART_NAMES: Readonly<Record<string, ProfilePart>> = {
  who: 'who',
  environment: 'environment',
  'their environment': 'environment',
  segments: 'segments',
  'strongest segments': 'segments',
  triggers: 'triggers',
  'trigger events': 'triggers',
  values: 'values',
  'what they value': 'values',
  poorfit: 'poorFit',
  poor_fit: 'poorFit',
  'poor fit': 'poorFit'
}

/** The profile part an `audience.sharpen` item changes, from its tag. */
export function profilePartOf(tag: string | null): ProfilePart | null {
  if (tag === null) return null
  return PART_NAMES[tag.trim().toLowerCase()] ?? null
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[-•*]\s*/, '').trim())
    .filter((line) => line.length > 0)
}

/** "Name: reason" or "Name — reason". */
export function parseNamedReason(line: string): NamedReason {
  const dash = line.indexOf('—')
  const colon = line.indexOf(':')
  const at = dash >= 0 ? dash : colon
  if (at < 0) return { name: line.trim(), reason: '' }
  return { name: line.slice(0, at).trim(), reason: line.slice(at + 1).trim() }
}

/** The update that writes an assist's full new value for one part. */
export function profilePatchFromText(part: ProfilePart, text: string): ProfilePatch {
  switch (part) {
    case 'who':
      return { who: text.trim() }
    case 'environment':
      return { environment: text.trim() }
    case 'triggers':
      return { triggers: lines(text) }
    case 'values':
      return { values: lines(text) }
    case 'segments':
      return { segments: lines(text).map(parseNamedReason) }
    case 'poorFit':
      return { poorFit: lines(text).map(parseNamedReason) }
  }
}

/** The update that puts one part back as it is in `profile`. */
export function profilePatchOf(profile: BuyerProfileBody, part: ProfilePart): ProfilePatch {
  switch (part) {
    case 'who':
      return { who: profile.who }
    case 'environment':
      return { environment: profile.environment }
    case 'triggers':
      return { triggers: profile.triggers }
    case 'values':
      return { values: profile.values }
    case 'segments':
      return { segments: profile.segments }
    case 'poorFit':
      return { poorFit: profile.poorFit }
  }
}

const STAGES: readonly IntentStage[] = ['problem', 'solution', 'comparison', 'objection', 'trigger']

function stageOf(tag: string | null): IntentStage {
  const value = tag?.trim().toLowerCase() ?? ''
  return STAGES.find((stage) => stage === value) ?? 'unset'
}

function sourceOf(text: string): PromptSource {
  const value = text.toLowerCase()
  if (value.includes('trigger')) return 'trigger_event'
  if (value.includes('objection')) return 'objection'
  if (value.includes('title') || value.includes('meta') || value.includes('h1')) {
    return 'title_meta_h1'
  }
  return 'detail_check'
}

const LABEL_MAX = 60

function labelOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= LABEL_MAX ? flat : `${flat.slice(0, LABEL_MAX - 1).trimEnd()}…`
}

/**
 * A `prompts.more` item as a new prompt. `detail` reads
 * "Source: <where it came from> · Maps to: <page element>".
 */
export function promptFromItem(item: AssistItem): Omit<AddPromptRequest, 'projectId' | 'pageId'> {
  const detail = item.detail ?? ''
  const source = /source:\s*([^·]*)/i.exec(detail)?.[1]?.trim() ?? ''
  const maps = /maps to:?\s*(.*)$/i.exec(detail)?.[1]?.trim() ?? ''
  return {
    label: labelOf(item.text),
    text: item.text.trim(),
    source: sourceOf(source),
    intentStage: stageOf(item.tag),
    mappedElement: maps
  }
}
