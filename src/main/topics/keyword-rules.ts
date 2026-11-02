import { KEYWORD_INTENT_FAMILY_LABEL } from '@shared/domain'
import type {
  FunnelStage,
  KeywordDepth,
  KeywordIntent,
  KeywordIntentFamily,
  PageType,
  TopicDraft
} from '@shared/domain'
import type { CompetitorContext, NamedCompetitor } from '../engine/competitor-context'

/**
 * Keyword rules worked out in code (Docs/PROMPT-AUDIT.md, package P4): which
 * families the competitor step writes, what each family means, the intent, funnel
 * and page type each family maps to, the names a keyword may or may not contain,
 * and how the keyword budget is shared. Pure functions only.
 */

/** Families written by `topic_keyword_competitor`; every keyword in them names a listed option. */
export const COMPETITOR_FAMILIES: readonly KeywordIntentFamily[] = [
  'alternatives_vs',
  'competitor_vs'
]

export function isCompetitorFamily(family: KeywordIntentFamily): boolean {
  return COMPETITOR_FAMILIES.includes(family)
}

interface FamilyRule {
  intent: KeywordIntent
  funnel: FunnelStage
  pageType: PageType
  /** What searches belong in the family, with examples of the shape (not of the topic). */
  means: string
}

/** One rule per family. The intent, funnel and page type are fixed by the family. */
export const KEYWORD_FAMILY_RULES: Readonly<Record<KeywordIntentFamily, FamilyRule>> = {
  definitional: {
    intent: 'informational',
    funnel: 'tofu',
    pageType: 'glossary',
    means:
      'people learning what the thing is: "what is …", "… meaning", "how does … work", "… vs …" between two kinds of solution.'
  },
  core_category: {
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'landing page',
    means:
      'the head and mid-tail phrases a buyer types when shopping for the category: "<category> service", "<category> for <use>", "<category> provider". No best, free or price words.'
  },
  best_lists: {
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'listicle',
    means: 'list-style searches: "best …", "top …", "… for small business", "… software for <who>".'
  },
  pricing: {
    intent: 'commercial',
    funnel: 'bofu',
    pageType: 'landing page',
    means:
      'price and plan searches: "… pricing", "… cost", "… per message", "free …", "… free trial", "cheap …".'
  },
  alternatives_vs: {
    intent: 'commercial',
    funnel: 'bofu',
    pageType: 'comparison page',
    means:
      'buyers leaving or doubting a named option: "<name> alternative", "<name> alternatives", "apps like <name>", "<old option> replacement", "switch from <name>".'
  },
  features: {
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'product page',
    means:
      'the category plus one capability buyers ask for: "… with an api", "… with reports", "… integration with <tool>", "… on mobile".'
  },
  how_to: {
    intent: 'informational',
    funnel: 'mofu',
    pageType: 'blog',
    means: 'task searches that start with "how to", in the words a buyer uses for the task.'
  },
  benefits_roi: {
    intent: 'informational',
    funnel: 'tofu',
    pageType: 'blog',
    means: 'why it is worth it: "benefits of …", "why use …", "is … worth it", "… vs <manual way>".'
  },
  problem_aware: {
    intent: 'informational',
    funnel: 'tofu',
    pageType: 'blog',
    means:
      'the symptom in the buyer\'s words before they know the fix: "… not working", "… stopped", "missed …", "not getting … alerts". No solution words.'
  },
  question_long_tail: {
    intent: 'informational',
    funnel: 'mofu',
    pageType: 'blog',
    means:
      'full questions people type into Google or ask an AI assistant, 6 to 14 words, about a real situation in this topic.'
  },
  trust_risk: {
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'blog',
    means:
      'worries before buying: reliability, delays, delivery, spam filtering, compliance and registration, security, legality.'
  },
  emerging_terms: {
    intent: 'informational',
    funnel: 'tofu',
    pageType: 'blog',
    means:
      'newer phrasing buyers have started to search because the market changed (new rules, shutdowns, new technology). Only changes you are sure of.'
  },
  branded_defensive: {
    intent: 'navigational',
    funnel: 'bofu',
    pageType: 'product page',
    means:
      'the category phrases a buyer types when looking for a business like this one, without its name: "<category> company", "<category> login", "<category> sign up".'
  },
  competitor_vs: {
    intent: 'commercial',
    funnel: 'bofu',
    pageType: 'comparison page',
    means:
      'head-to-head and evaluation searches that name a listed competitor: "<a> vs <b>", "<a> vs <category>", "<a> review", "is <a> good for <use>", "<a> <category> pricing".'
  }
}

/** `{{ families }}`: one line per requested family, with what belongs in it. */
export function familyLines(families: readonly KeywordIntentFamily[]): string {
  return families
    .map((family) => {
      const rule = KEYWORD_FAMILY_RULES[family]
      return `- ${family} ("${KEYWORD_INTENT_FAMILY_LABEL[family]}"; ${rule.intent}, ${rule.funnel}, ${rule.pageType}): ${rule.means}`
    })
    .join('\n')
}

/**
 * Keywords per family Claude is asked for, so every family fits in the budget left
 * after the code-made keywords instead of the last families being cut off.
 */
export function keywordsPerFamily(budget: number, families: number, perGroupCap: number): number {
  if (families <= 0) return 0
  return Math.max(1, Math.min(perGroupCap, Math.floor(Math.max(0, budget) / families)))
}

// ---------------------------------------------------------------------------
// Names in keywords
// ---------------------------------------------------------------------------

const GENERIC = new Set(
  'a an and app apps by com email emails for from gateway inc io llc mail message messages messaging net online org platform service services sms software text texting texts the to via with'.split(
    ' '
  )
)

function fold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

/** Words of a folded string: letters and digits, `&` dropped ("at&t" → "att"). */
function words(value: string): string[] {
  return fold(value)
    .replace(/&/gu, '')
    .split(/[^\p{L}\p{N}.]+/u)
    .map((word) => word.replace(/^\.+|\.+$/gu, ''))
    .filter(Boolean)
}

/**
 * The spellings that count as naming an option in a keyword: the whole name, its
 * domain without the TLD, the name split at capitals ("SimpleTexting" → "simple
 * texting") and, for a descriptive name ("Verizon vtext.com"), each distinctive word.
 */
export function nameKeys(name: string, domain: string | null = null): string[] {
  const keys = new Set<string>()
  const add = (value: string): void => {
    const key = words(value).join(' ')
    if (key.length >= 3) keys.add(key)
  }
  const addHost = (host: string): void => {
    const label =
      host
        .toLowerCase()
        .replace(/^www\./u, '')
        .split('.')[0] ?? ''
    add(label)
    add(label.replace(/-/gu, ' '))
  }
  const clean = name.trim()
  if (clean.length === 0) return []
  add(clean)
  add(clean.replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/([A-Z])([A-Z][a-z])/gu, '$1 $2'))
  if (domain !== null) addHost(domain)
  const tokens = clean.split(/\s+/u).filter(Boolean)
  if (tokens.length === 1 && /\.[a-z]{2,}$/iu.test(clean)) addHost(clean)
  // A descriptive name ("Verizon vtext.com", "AT&T email to text gateway"): each
  // brand-like word counts on its own. Short plain words ("Text Em All") never do.
  const descriptive = tokens.some(
    (token) => GENERIC.has(words(token).join('')) || /\.[a-z]{2,}$/iu.test(token)
  )
  if (tokens.length > 1 && descriptive) {
    for (const token of tokens) {
      const word = words(token).join('')
      if (GENERIC.has(word) || /^\d+$/u.test(word)) continue
      const brandLike = /[&.]/u.test(token) || /^[A-Z0-9]{2,}$/u.test(token)
      if (word.length >= 4 || (brandLike && word.length >= 2)) add(word)
      if (/\.[a-z]{2,}$/iu.test(token)) addHost(token)
    }
  }
  return [...keys]
}

/** True when the keyword names any of the options (whole words, case, accents and `&` folded). */
export function namesAny(text: string, keys: readonly string[]): boolean {
  const haystack = ` ${words(text).join(' ')} `
  const squashed = haystack.replace(/\s+/gu, '')
  return keys.some((key) => {
    if (haystack.includes(` ${key} `)) return true
    // "simple texting" written as "simpletexting", for names long enough to be safe.
    const joined = key.replace(/\s+/gu, '')
    return key.includes(' ') && joined.length >= 8 && squashed.includes(joined)
  })
}

/** The options a topic's keywords may name, with the keys code checks them by. */
export interface TopicOptions {
  /** Direct and partial competitors of the topic's product. */
  competitors: NamedCompetitor[]
  partial: NamedCompetitor[]
  switchingFrom: string[]
  integrations: string[]
  competitorKeys: string[]
  switchKeys: string[]
}

/**
 * The topic's competitors: the product's own lists once products are saved
 * (package PC), else the draft's list (the project's, unless the topic changed it).
 */
export function topicOptions(
  context: CompetitorContext,
  draft: Pick<TopicDraft, 'competitors' | 'switchingFrom' | 'integrations'>
): TopicOptions {
  const own = context.product !== null
  const direct = own
    ? context.direct
    : uniqueNamed([...draft.competitors.map(namedFromEntry), ...context.direct])
  const partial = uniqueNamed(context.partial).filter(
    (item) => !direct.some((other) => sameName(other, item))
  )
  const switchingFrom = unique([...(draft.switchingFrom ?? []), ...context.switchingFrom])
  const integrations = unique([...(draft.integrations ?? []), ...context.integrations])
  return {
    competitors: direct,
    partial,
    switchingFrom,
    integrations,
    competitorKeys: unique(
      [...direct, ...partial].flatMap((item) => nameKeys(item.name, item.domain))
    ),
    switchKeys: unique(switchingFrom.flatMap((name) => nameKeys(name)))
  }
}

function namedFromEntry(entry: string): NamedCompetitor {
  const name = entry.trim()
  const domain = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/?$/iu.exec(name)
  return { name, domain: domain?.[1]?.toLowerCase() ?? null }
}

function sameName(a: NamedCompetitor, b: NamedCompetitor): boolean {
  if (a.domain !== null && a.domain === b.domain) return true
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase()
}

function uniqueNamed(items: readonly NamedCompetitor[]): NamedCompetitor[] {
  const out: NamedCompetitor[] = []
  for (const item of items) {
    if (item.name.trim().length === 0 || out.some((other) => sameName(other, item))) continue
    out.push(item)
  }
  return out
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLowerCase()
      if (value.length === 0 || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

// ---------------------------------------------------------------------------
// Keyword shape
// ---------------------------------------------------------------------------

/** Lower case, spaces squeezed, quotes and end punctuation dropped (question marks kept). */
export function normalizeKeyword(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/["“”]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.!,;:]+$/u, '')
    .trim()
}

/** Words a keyword of the family may have: long-tail questions are longer. */
export function keywordWordsFit(text: string, family: KeywordIntentFamily | null): boolean {
  const count = text.split(' ').filter(Boolean).length
  if (family === 'question_long_tail') return count >= 4 && count <= 16
  return count >= 2 && count <= 9
}

// ---------------------------------------------------------------------------
// Coverage patterns
// ---------------------------------------------------------------------------

/** Patterns kept from one core-terms reply. */
export const MAX_TOPIC_PATTERNS = 6

/**
 * A pattern from the core-terms reply in the form the expansion reads: lower case,
 * `X` or `<x>` written as `{X}`, `<segment>` as `{segment}`, exactly one `{X}` and
 * 1 to 4 words besides it. Null when it is not a usable pattern.
 */
export function cleanKeywordPattern(raw: string): string | null {
  const text = raw
    .trim()
    .replace(/["“”]/gu, '')
    .replace(/[{<[]\s*segment\s*[}>\]]/giu, '{segment}')
    .replace(/[{<[]\s*x\s*[}>\]]/giu, '{X}')
    .replace(/(^|\s)X(?=\s|$)/gu, '$1{X}')
    .replace(/\s+/gu, ' ')
  const lower = text.toLowerCase().replace(/\{x\}/gu, '{X}')
  if ((lower.match(/\{X\}/gu) ?? []).length !== 1) return null
  const extra = lower
    .replace('{X}', '')
    .split(' ')
    .filter((word) => word.length > 0)
  if (extra.length < 1 || extra.length > 4 || lower.length > 60) return null
  if (/[^\p{L}\p{N}\s'&-]/u.test(lower.replace(/\{X\}|\{segment\}/gu, ''))) return null
  return lower
}

/**
 * The patterns the coverage expansion applies: the depth's own (a preset's current
 * defaults, so a draft saved with the old AI patterns no longer uses them; Custom's
 * as the user set them) plus the topic's patterns from the core-terms step.
 */
export function patternsToApply(
  depth: Pick<KeywordDepth, 'preset' | 'patternVariants'>,
  topicPatterns: readonly string[] | undefined,
  presetPatterns: readonly string[]
): string[] {
  const base = depth.preset === 'custom' ? depth.patternVariants : presetPatterns
  return [...new Set([...base, ...(topicPatterns ?? [])])].slice(0, 20)
}
