import { TOPIC_PROFILE_SECTIONS, type TopicProfileSection, type TopicStage } from '@shared/domain'
import type { NamedCompetitor } from '../engine/competitor-context'
import { duplicateKey, MAX_QUESTION_WORDS, namesBrand, wordCount } from './text'

/**
 * Code checks for the topic profile and journey questions (Docs/PROMPT-AUDIT.md,
 * P3; section 3 rule 4: code computes what code can). Pure.
 */

/** A journey question is at least this many words. */
export const MIN_JOURNEY_WORDS = 15
/** Points kept per profile section. */
export const PROFILE_POINTS_MIN = 3
/** The who section names this many different buyers, so the journey can spread over them. */
export const WHO_POINTS_MIN = 5
export const PROFILE_POINTS_MAX = 6

/** The stages whose questions may name competitors. */
export const COMPETITOR_STAGES: ReadonlySet<TopicStage> = new Set<TopicStage>(['compare', 'decide'])

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

function flat(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** `textmagic.com` gives `textmagic`; a plain name gives null. */
function domainLabel(value: string): string | null {
  const match = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.[a-z.]{2,}(?:\/.*)?$/iu.exec(value.trim())
  return match?.[1] ?? null
}

/**
 * Words a domain label can be that buyers write anyway: `text.email` must not turn
 * every question that says "text" into one that names a competitor.
 */
const PLAIN_LABEL_WORDS: ReadonlySet<string> = new Set([
  'alarm',
  'alert',
  'alerts',
  'email',
  'emails',
  'message',
  'messages',
  'notify',
  'phone',
  'texts',
  'texting'
])

/** A domain label short or plain enough to be an everyday word is not a name. */
function distinctiveLabel(label: string | null): string | null {
  if (label === null) return null
  return label.length < 5 || PLAIN_LABEL_WORDS.has(label.toLowerCase()) ? null : label
}

/**
 * The spellings a competitor may appear as in text: its name, its domain and the
 * domain's label when that label is distinctive (`simpletexting`, never `text`).
 */
export function nameForms(item: NamedCompetitor): string[] {
  const forms = new Set<string>()
  const add = (value: string | null): void => {
    if (value === null) return
    const clean = value.trim()
    if (clean.length >= 3) forms.add(clean)
  }
  add(item.name)
  add(item.domain)
  add(distinctiveLabel(domainLabel(item.name)))
  add(item.domain === null ? null : distinctiveLabel(domainLabel(item.domain)))
  return [...forms]
}

/** The competitor `claimed` names, matched loosely by name or domain. Null when none. */
export function findCompetitor(
  claimed: string,
  list: readonly NamedCompetitor[]
): NamedCompetitor | null {
  const key = flat(claimed)
  if (key.length === 0) return null
  for (const item of list) {
    for (const form of nameForms(item)) {
      const other = flat(form)
      if (other.length === 0) continue
      if (key === other) return item
      // A prefix match ("Textmagic SMS") needs the shorter side to be a real name.
      const prefix = key.startsWith(other) || other.startsWith(key)
      if (prefix && Math.min(key.length, other.length) >= 5) return item
    }
  }
  return null
}

/** The competitors from `list` that `text` names (whole word, like the brand check). */
export function competitorsIn(text: string, list: readonly NamedCompetitor[]): NamedCompetitor[] {
  return list.filter((item) => namesBrand(text, nameForms(item)))
}

/** True when `claimed` is one of the plain names in `list` (switch-from options, tools). */
function inPlainList(claimed: string, list: readonly string[]): boolean {
  const key = flat(claimed)
  return (
    key.length > 0 &&
    list.some((name) => {
      const other = flat(name)
      return other.length > 0 && (key === other || key.includes(other) || other.includes(key))
    })
  )
}

// ---------------------------------------------------------------------------
// Journey questions
// ---------------------------------------------------------------------------

export interface StageQuestionReply {
  /** The stage the question is for. A project's own older body may write other stages. */
  stage?: TopicStage | null
  text: string
  namedTool: string | null
  competitorNamed: string | null
}

export interface StageCheckInput {
  stage: TopicStage
  brands: readonly string[]
  /** Direct and partial competitors for the topic's product. */
  competitors: readonly NamedCompetitor[]
  /** Replaced or discontinued options: never an option to buy. */
  switchingFrom: readonly string[]
  /** Questions already in the draft, so a reply never repeats one. */
  existing: readonly string[]
  /** Software that sends the emails or alerts: never called a gateway. */
  integrations?: readonly string[]
  /** Software already named in enough questions: a reply naming it is dropped. */
  bannedTools?: readonly string[]
}

export type DropReason =
  | 'other_stage'
  | 'brand'
  | 'short'
  | 'long'
  | 'competitor'
  | 'switch_from'
  | 'gateway'
  | 'tool_cap'
  | 'repeat'

/** Words that mark a carrier gateway, not software, in a `namedTool`. */
const GATEWAY_WORD = /gateway|carrier|vtext|txt\.att|tmomail|e-?mail[- ]to[- ](?:text|sms)/iu

function bare(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/**
 * True when one of `names` (software that sends the emails) is followed within three
 * words by "gateway", as in "our Win 911 email-to-text gateway": the software is
 * called a gateway it is not.
 */
export function softwareCalledGateway(text: string, names: readonly string[]): boolean {
  const words = text.split(/\s+/u).filter((word) => word.length > 0)
  const keys = names.map(flat).filter((key) => key.length >= 3)
  if (keys.length === 0) return false
  for (let start = 0; start < words.length; start += 1) {
    for (let span = 1; span <= 3 && start + span <= words.length; span += 1) {
      const joined = flat(words.slice(start, start + span).join(''))
      if (!keys.includes(joined)) continue
      const after = words.slice(start + span, start + span + 3).map(bare)
      if (after.some((word) => /^gateways?$/iu.test(word))) return true
    }
  }
  return false
}

export interface StageCheckResult {
  kept: { text: string; competitorNamed: string | null; namedTool: string | null }[]
  dropped: Record<DropReason, number>
}

/**
 * Keeps the replies that follow the rules for their stage:
 * - 15 to 32 words, and never the brand;
 * - compare and decide: a company named must be on the competitor list, and never a
 *   switch-from option (an option that shut down is not something to buy);
 * - other stages name no competitor at all;
 * - never the same question twice (same words in any order), here or in the draft.
 */
export function checkStageQuestions(
  replies: readonly StageQuestionReply[],
  input: StageCheckInput
): StageCheckResult {
  const dropped: Record<DropReason, number> = {
    other_stage: 0,
    brand: 0,
    short: 0,
    long: 0,
    competitor: 0,
    switch_from: 0,
    gateway: 0,
    tool_cap: 0,
    repeat: 0
  }
  const seen = new Set(input.existing.map(duplicateKey))
  const kept: StageCheckResult['kept'] = []
  const named = COMPETITOR_STAGES.has(input.stage)
  for (const reply of replies) {
    // A single-stage call keeps only its own stage, whatever the body asked for.
    if (reply.stage !== undefined && reply.stage !== null && reply.stage !== input.stage) {
      dropped.other_stage += 1
      continue
    }
    // A buyer types no [brackets]: a profile's "[e.g. APC]" note keeps only the name.
    const text = reply.text
      .replace(/\[(?:[^\]]*?\be\.g\.,?\s*)?([^\]]+)\]/gu, '$1')
      .trim()
      .replace(/\s+/gu, ' ')
    const words = wordCount(text)
    if (namesBrand(text, input.brands)) {
      dropped.brand += 1
      continue
    }
    if (words < MIN_JOURNEY_WORDS) {
      dropped.short += 1
      continue
    }
    if (words > MAX_QUESTION_WORDS) {
      dropped.long += 1
      continue
    }
    const inText = competitorsIn(text, input.competitors)
    let competitorNamed: string | null = null
    if (named) {
      const claimed = reply.competitorNamed?.trim() ?? ''
      if (claimed.length > 0 && inPlainList(claimed, input.switchingFrom)) {
        dropped.switch_from += 1
        continue
      }
      const match = claimed.length > 0 ? findCompetitor(claimed, input.competitors) : null
      if (claimed.length > 0 && match === null) {
        // A company that is not on the list: made up, or not a real alternative here.
        dropped.competitor += 1
        continue
      }
      competitorNamed = match?.name ?? inText[0]?.name ?? null
    } else if (inText.length > 0) {
      dropped.competitor += 1
      continue
    }
    const tool = reply.namedTool?.trim() ?? ''
    const software = [
      ...(input.integrations ?? []),
      ...(tool.length > 0 && !GATEWAY_WORD.test(tool) ? [tool] : [])
    ]
    if (softwareCalledGateway(text, software)) {
      dropped.gateway += 1
      continue
    }
    const banned = input.bannedTools ?? []
    if (banned.length > 0 && namesBrand(text, banned)) {
      dropped.tool_cap += 1
      continue
    }
    const key = duplicateKey(text)
    if (seen.has(key)) {
      dropped.repeat += 1
      continue
    }
    seen.add(key)
    kept.push({ text, competitorNamed, namedTool: reply.namedTool?.trim() || null })
  }
  return { kept, dropped }
}

const DROP_TEXT: Readonly<Record<DropReason, [string, string]>> = {
  other_stage: ['was for another stage', 'were for another stage'],
  brand: ['named the brand', 'named the brand'],
  short: ['was under 15 words', 'were under 15 words'],
  long: ['was over 32 words', 'were over 32 words'],
  competitor: [
    'named a company that is not on the competitor list (or named one in a stage that names none)',
    'named companies that are not on the competitor list (or named one in a stage that names none)'
  ],
  switch_from: [
    'offered a replaced or discontinued option as something to choose',
    'offered replaced or discontinued options as something to choose'
  ],
  gateway: [
    'called the software that sends the emails a gateway',
    'called the software that sends the emails a gateway'
  ],
  tool_cap: [
    'named software already used in enough questions',
    'named software already used in enough questions'
  ],
  repeat: ['repeated another question', 'repeated other questions']
}

/**
 * The retry note when a stage came back short: "2 of 3 questions could not be kept:
 * 1 was over 32 words, 1 repeated another question. Write exactly 3 questions …".
 * Null when nothing is missing.
 */
export function shortfallProblem(result: StageCheckResult, count: number): string | null {
  const missing = count - result.kept.length
  if (missing <= 0) return null
  const parts = (Object.entries(result.dropped) as [DropReason, number][])
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${n} ${DROP_TEXT[reason][n === 1 ? 0 : 1]}`)
  const why = parts.length > 0 ? `: ${parts.join(', ')}` : ''
  return `${missing} of ${count} questions could not be kept${why}. Write exactly ${count} questions that follow every rule.`
}

// ---------------------------------------------------------------------------
// Buyer profile
// ---------------------------------------------------------------------------

export interface ProfilePointReply {
  section: TopicProfileSection
  text: string
  foundIn: string | null
  verify: string | null
}

/** Where a point may cite: the evidence pages' paths and titles. */
export interface EvidenceSource {
  path: string
  title: string | null
}

function pathKey(value: string): string {
  let path = value.trim()
  try {
    if (/^https?:\/\//iu.test(path)) path = new URL(path).pathname
  } catch {
    // Keep the raw value.
  }
  return (
    path
      .replace(/^\[|\]$/gu, '')
      .replace(/\/+$/u, '')
      .toLowerCase() || '/'
  )
}

/**
 * `foundIn` as the evidence path it names, else null. A path such as `/pricing`
 * matches `/pricing/`; a page name matches an evidence page's title.
 */
export function checkedFoundIn(
  foundIn: string | null,
  sources: readonly EvidenceSource[]
): string | null {
  if (foundIn === null) return null
  const value = foundIn.trim()
  if (value.length === 0) return null
  const byPath = sources.find((source) => pathKey(source.path) === pathKey(value))
  if (byPath !== undefined) return byPath.path
  const name = flat(value)
  if (name.length < 3) return null
  const byTitle = sources.find((source) => {
    const title = flat(source.title ?? '')
    return title.length > 0 && (title === name || title.includes(name) || name.includes(title))
  })
  return byTitle?.path ?? null
}

/**
 * The profile points kept: no brand, `foundIn` checked against the evidence, and
 * at most {@link PROFILE_POINTS_MAX} per section. `thin` lists the sections with
 * fewer than {@link PROFILE_POINTS_MIN} points left.
 */
export function checkProfilePoints(
  points: readonly ProfilePointReply[],
  sources: readonly EvidenceSource[],
  brands: readonly string[]
): { kept: ProfilePointReply[]; thin: TopicProfileSection[]; branded: number } {
  const perSection = new Map<TopicProfileSection, number>()
  const seen = new Set<string>()
  const kept: ProfilePointReply[] = []
  let branded = 0
  for (const point of points) {
    const text = point.text.trim()
    if (text.length === 0) continue
    if (namesBrand(text, brands)) {
      branded += 1
      continue
    }
    const key = `${point.section}:${duplicateKey(text)}`
    if (seen.has(key)) continue
    const used = perSection.get(point.section) ?? 0
    if (used >= PROFILE_POINTS_MAX) continue
    seen.add(key)
    perSection.set(point.section, used + 1)
    kept.push({ ...point, text, foundIn: checkedFoundIn(point.foundIn, sources) })
  }
  const thin = TOPIC_PROFILE_SECTIONS.filter(
    (section) =>
      (perSection.get(section) ?? 0) < (section === 'who' ? WHO_POINTS_MIN : PROFILE_POINTS_MIN)
  )
  return { kept, thin, branded }
}
