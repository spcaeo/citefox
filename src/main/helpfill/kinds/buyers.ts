import type { BuyerProfile } from '@shared/domain'
import type { AssistResult } from '@shared/ipc'
import { ensureShippedAssists } from '../../assist/definitions'
import { runAssist } from '../../assist/run'
import type { EngineHost } from '../../engine/host'
import { getLatestBuyerProfile } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import type { HelpFillContext, HelpFillDraftRow, HelpFillKindDef, HelpFillValues } from '../types'

/**
 * Buyer profile (Page › Audience) → ✦ Help me fill this: buyer types for one page,
 * each with its problem, the event that sends them searching now and what they need.
 * The page's saved segments are listed so they are not repeated (and rows close to one
 * are merged); saved triggers and values are named in the task. Describe runs the
 * existing `audience.sharpen` and `audience.triggers` assists with the user's sentence
 * as their instruction (their prompts are not copied here) and keeps only what the
 * profile does not hold yet. The renderer splits each row into segment, trigger and
 * value suggestions for the profile's own review card.
 */

/** Saved triggers or values named in the task; more are left out. */
const PROMPT_POINTS = 12

export const BUYERS_KIND: HelpFillKindDef = {
  kind: 'buyers',
  noun: ['buyer type', 'buyer types'],
  scope: 'page',
  sections: [
    { id: 'main', title: null, columns: ['who', 'problem', 'trigger', 'need'], entity: null }
  ],
  neutral: false,
  defaultCount: 5,
  maxCount: 6,
  chatbotCount: 8,
  describeCost: { calls: 2, usd: 0.03 },
  role: () => 'You help a company describe the buyers who search for what one page offers.',
  task(context, count) {
    const saved = (name: string, label: string): string[] => {
      const items = context.extra?.[name] ?? []
      if (items.length === 0) return []
      const shown = items.slice(0, PROMPT_POINTS).map((item) => item.replace(/[\s.;]+$/u, ''))
      const more = items.length > shown.length ? '; …' : ''
      return [`${label} already saved, don't repeat: ${shown.join('; ')}${more}.`]
    }
    return [
      `List ${count} buyer types who would search for this page: real roles, team or company sizes and industries, as specifically as a buyer would describe themselves. A buyer type that would fit any business is wrong.`,
      'who = a short name for the buyer type, such as "Field service managers at HVAC companies"',
      'problem = their problem, in one sentence',
      'trigger = the named event that sends them searching now: something that happens (a carrier shuts a gateway, an alert goes unread), not a wish',
      'need = what they need from a fix, in a few words',
      ...saved('triggers', 'Trigger events'),
      ...saved('values', 'Needs')
    ]
  },
  tracked: (context) => ({
    listed: context.extra?.segments ?? [],
    merge: { main: context.extra?.segmentNames ?? [] }
  }),
  extra(db, _project, pageId): Readonly<Record<string, readonly string[]>> {
    const profile = pageId === null ? null : readProfile(db, pageId)
    if (profile === null) return {}
    return {
      segments: profile.segments.map((segment) =>
        segment.reason.trim() ? `${segment.name}: ${segment.reason}` : segment.name
      ),
      segmentNames: profile.segments.map((segment) => segment.name),
      triggers: profile.triggers,
      values: profile.values
    }
  },
  clean: cleanBuyer,
  describe: describeBuyers
}

/** Characters kept of a buyer type's name (a saved segment name holds 200). */
const WHO_CHARS = 160

/** Every cell trimmed; a row without a buyer type is dropped. */
export function cleanBuyer(values: HelpFillValues): HelpFillValues | null {
  let who = (values.who ?? '').trim().replace(/[.;:]+$/u, '')
  if (who.length < 2) return null
  if (who.length > WHO_CHARS) who = `${who.slice(0, WHO_CHARS - 1).trimEnd()}…`
  return {
    who,
    problem: (values.problem ?? '').trim(),
    trigger: (values.trigger ?? '').trim(),
    need: (values.need ?? '').trim()
  }
}

function readProfile(db: SqliteDatabase, pageId: string): BuyerProfile | null {
  try {
    return getLatestBuyerProfile(db, pageId)
  } catch {
    // A profile that cannot be read adds nothing to the prompt.
    return null
  }
}

/**
 * Sharpen (segments, triggers, values) and Find more trigger events, both with the
 * user's sentence. One of them failing still returns the other's points. Segments the
 * profile holds are dropped; new triggers and values are shared out over the new
 * segments (several in one cell, one per line), so the review can offer each one.
 */
async function describeBuyers(
  host: EngineHost,
  context: HelpFillContext,
  input: { sentence: string; count: number }
): Promise<readonly HelpFillDraftRow[]> {
  ensureShippedAssists()
  if (context.target === null) return []
  const pageId = context.target.id
  const instruction = input.sentence.trim() || null
  const run = (assistId: string): Promise<AssistResult> =>
    runAssist(host, {
      assistId,
      projectId: context.projectId,
      pageId,
      marketId: null,
      promptId: null,
      inputs: {},
      instruction
    })
  const [sharpen, triggers] = await Promise.allSettled([
    run('audience.sharpen'),
    run('audience.triggers')
  ])
  if (sharpen.status === 'rejected' && triggers.status === 'rejected') throw sharpen.reason
  const sharpened = sharpen.status === 'fulfilled' ? sharpen.value.items : []
  const lines = (tag: string): string[] =>
    sharpened
      .filter((item) => item.tag === tag)
      .flatMap((item) => item.text.split('\n'))
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

  const savedNames = folded(context.extra?.segmentNames ?? [])
  const segments = lines('segments')
    .map(splitNamed)
    .filter((segment) => !savedNames.has(fold(segment.name)))
    .slice(0, input.count)
  const fresh = (items: readonly string[], saved: readonly string[]): string[] => {
    const seen = folded(saved)
    return items.filter((item) => {
      const key = fold(item)
      if (key.length === 0 || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  const newTriggers = fresh(
    [
      ...(triggers.status === 'fulfilled' ? triggers.value.items.map((item) => item.text) : []),
      ...lines('triggers')
    ],
    context.extra?.triggers ?? []
  )
  const newNeeds = fresh(lines('values'), context.extra?.values ?? [])

  if (segments.length === 0) {
    // No new segment: the triggers and values go under who the profile says this buyer is.
    const who = firstSentence(lines('who')[0] ?? '') || firstSentence(input.sentence)
    if (who.length === 0 || newTriggers.length + newNeeds.length === 0) return []
    segments.push({ name: who, reason: '' })
  }
  return segments.map((segment, index) => ({
    section: null,
    values: {
      who: segment.name,
      problem: segment.reason,
      trigger: shareOf(newTriggers, index, segments.length).join('\n'),
      need: shareOf(newNeeds, index, segments.length).join('\n')
    }
  }))
}

/** "Field service: crews are away from desks" as a name and a reason. */
function splitNamed(line: string): { name: string; reason: string } {
  const at = line.search(/\s*[:–—]\s+/u)
  if (at <= 0) return { name: line, reason: '' }
  return {
    name: line.slice(0, at).trim(),
    reason: line
      .slice(at)
      .replace(/^\s*[:–—]\s+/u, '')
      .trim()
  }
}

/** Items index, index + n, index + 2n…: one segment's share. */
function shareOf(items: readonly string[], index: number, n: number): string[] {
  return items.filter((_, at) => at % n === index)
}

function firstSentence(text: string): string {
  const trimmed = text.trim()
  const end = trimmed.search(/[.!?](\s|$)/u)
  const sentence = end > 0 ? trimmed.slice(0, end) : trimmed
  return sentence.length > 120 ? `${sentence.slice(0, 119)}…` : sentence
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function folded(items: readonly string[]): Set<string> {
  return new Set(items.map(fold).filter((item) => item.length > 0))
}
