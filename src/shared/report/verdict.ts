import type { ChangeCounts } from './diff'

/**
 * The verdict (Docs/REPORT-SPEC.md "Verdict"): a badge and three to five short
 * findings, derived from stored counts by fixed rules. No AI and no estimate: every
 * number in a finding is a {@link VerdictCount} that names the set of questions behind
 * it, so the Overview and the report can make it clickable and open exactly those
 * questions (the drawer total equals the number, NFR-14).
 */

/** The question sets a finding can point at. The consumer maps each to its own drill. */
export const VERDICT_SETS = [
  'tracked',
  'aio',
  'cited',
  'named',
  'not_visible',
  'cited_before',
  'cited_after',
  'named_before',
  'named_after',
  'gained',
  'kept',
  'lost',
  'top_site'
] as const

export type VerdictSet = (typeof VERDICT_SETS)[number]

export interface VerdictCount {
  set: VerdictSet
  n: number
  /** Drawer title, such as "Gained since the previous check". */
  label: string
}

/** A finding sentence: plain text and clickable counts, in reading order. */
export type VerdictPart = string | VerdictCount

export type VerdictTone = 'ok' | 'warn' | 'bad' | 'neutral'

export interface VerdictFinding {
  id: 'movement' | 'holding' | 'named' | 'opportunity' | 'competition' | 'first'
  tone: VerdictTone
  /** The coloured lead phrase, such as "More answers cite you." */
  lead: string
  parts: readonly VerdictPart[]
}

export type VerdictStatus = 'strong' | 'working' | 'mixed' | 'slipping' | 'flat' | 'early'

export interface Verdict {
  status: VerdictStatus
  /** The badge, such as "Working, strong early results". */
  label: string
  tone: VerdictTone
  findings: readonly VerdictFinding[]
}

export interface VerdictInput {
  /** The brand as the user knows it, such as "Example Co". */
  brand: string
  /**
   * How the earlier check reads in a sentence ("the previous check", "the Oct 3
   * check"). Null when there is no earlier full check to compare with.
   */
  compareLabel: string | null
  tracked: number
  /** Questions whose latest check showed an AI Overview. */
  aio: number
  /** Questions whose latest overview cites the own domain. */
  cited: number
  named: number
  /** AI Overview shown, neither cited nor named. */
  notVisible: number
  /** Null without an earlier check. Counts only questions measured both times. */
  changes: ChangeCounts | null
  /** Of the questions measured both times: named in the earlier check, and now. */
  namedBefore: number | null
  namedAfter: number | null
  /** The most cited other site now (questions citing it), or null. */
  topSite: { name: string; count: number } | null
  /**
   * What one counted item is called. Default "question" (the app screens); the
   * exported report says "buyer prompt", as its headline and cover do.
   */
  noun?: string
}

const STATUS_LABELS: Readonly<Record<VerdictStatus, { label: string; tone: VerdictTone }>> = {
  strong: { label: 'Working, strong early results', tone: 'ok' },
  working: { label: 'Working, early signs', tone: 'ok' },
  mixed: { label: 'Mixed', tone: 'warn' },
  slipping: { label: 'Slipping', tone: 'bad' },
  flat: { label: 'Not moving yet', tone: 'neutral' },
  early: { label: 'Too early to tell', tone: 'neutral' }
}

/** Fewest questions measured in both checks before a verdict is given. */
export const MIN_COMPARABLE = 3

/** Questions measured in both checks. */
export function comparableCount(changes: ChangeCounts): number {
  return changes.gained + changes.kept + changes.lost + changes.never
}

/**
 * A move counts as clear when it is at least 2 questions and 10% of those measured
 * both times: answers vary from run to run, so one question moving is not a trend.
 */
export function clearMove(comparable: number): number {
  return Math.max(2, Math.ceil(comparable * 0.1))
}

export function verdictStatus(changes: ChangeCounts | null): VerdictStatus {
  if (changes === null) return 'early'
  const comparable = comparableCount(changes)
  if (comparable < MIN_COMPARABLE) return 'early'
  const net = changes.gained - changes.lost
  const clear = clearMove(comparable)
  if (net >= clear) return 'strong'
  if (net > 0) return 'working'
  if (changes.gained === 0 && changes.lost === 0) return 'flat'
  if (net <= -clear) return 'slipping'
  return 'mixed'
}

/** Most findings shown. */
export const MAX_FINDINGS = 5

export function buildVerdict(input: VerdictInput): Verdict {
  const status = verdictStatus(input.changes)
  const badge = STATUS_LABELS[status]
  const findings: VerdictFinding[] = []
  const count = (set: VerdictSet, n: number, label: string): VerdictCount => ({ set, n, label })
  const { brand } = input
  const { one, many } = nouns(input)
  const changes = input.changes
  const since = input.compareLabel === null ? null : `since ${input.compareLabel}`

  if (changes !== null && since !== null && input.compareLabel !== null) {
    const before = changes.kept + changes.lost
    const after = changes.kept + changes.gained
    const net = changes.gained - changes.lost
    const beforeCount = count('cited_before', before, `Cited at ${input.compareLabel}`)
    const afterCount = count('cited_after', after, 'Cited now')
    const gained = count('gained', changes.gained, `Gained ${since}`)
    const lost = count('lost', changes.lost, `Lost ${since}`)
    if (net > 0 || net < 0) {
      findings.push({
        id: 'movement',
        tone: net > 0 ? 'ok' : 'bad',
        lead: net > 0 ? 'More answers cite you.' : 'Fewer answers cite you.',
        parts: [
          `${capital(many)} citing ${brand} went from `,
          beforeCount,
          ' to ',
          afterCount,
          ` ${since}: `,
          gained,
          ' gained, ',
          lost,
          ' lost.'
        ]
      })
    } else if (changes.gained > 0) {
      findings.push({
        id: 'movement',
        tone: 'warn',
        lead: 'Citations moved around.',
        parts: [
          gained,
          ' gained and ',
          lost,
          ` lost ${since}, so the total stayed at `,
          afterCount,
          '.'
        ]
      })
    } else {
      findings.push({
        id: 'movement',
        tone: 'neutral',
        lead: 'No citation changed.',
        parts:
          after === 0
            ? [`No ${one} measured both times cites ${brand}, now or at ${input.compareLabel}.`]
            : ['The same ', afterCount, ` ${many} cite ${brand} as at ${input.compareLabel}.`]
      })
    }
    if (before > 0 && changes.lost > 0) {
      const holding = changes.kept / before >= 0.75
      findings.push({
        id: 'holding',
        tone: holding ? 'ok' : 'warn',
        lead: holding ? 'Most citations are holding.' : 'Some citations did not hold.',
        parts: [
          count('kept', changes.kept, `Kept ${since}`),
          ' of the ',
          beforeCount,
          ` ${many} that cited ${brand} at ${input.compareLabel} still do.`
        ]
      })
    }
  } else {
    findings.push({
      id: 'first',
      tone: 'neutral',
      lead: 'First measurement.',
      parts: [
        'Google shows an AI Overview for ',
        count('aio', input.aio, 'AI Overview shown'),
        ` of ${input.tracked} ${many}, and `,
        count('cited', input.cited, 'You are cited'),
        ` cite ${brand}. The next check shows what changes.`
      ]
    })
  }

  const named = namedFinding(input, count)
  if (named !== null) findings.push(named)

  if (input.notVisible > 0) {
    findings.push({
      id: 'opportunity',
      tone: 'warn',
      lead: 'The opportunity.',
      parts: [
        count('not_visible', input.notVisible, 'Not visible'),
        ` ${many} show an AI Overview that neither cites nor names ${brand}.`
      ]
    })
  }

  const competition = competitionFinding(input, count)
  if (competition !== null) findings.push(competition)

  return { status, label: badge.label, tone: badge.tone, findings: findings.slice(0, MAX_FINDINGS) }
}

type CountOf = (set: VerdictSet, n: number, label: string) => VerdictCount

function nouns(input: VerdictInput): { one: string; many: string } {
  const one = input.noun ?? 'question'
  // "search" → "searches"; "question" and "buyer prompt" take an s.
  return { one, many: /(s|sh|ch|x)$/.test(one) ? `${one}es` : `${one}s` }
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function namedFinding(input: VerdictInput, count: CountOf): VerdictFinding | null {
  const { brand } = input
  const { one, many } = nouns(input)
  if (
    input.namedBefore !== null &&
    input.namedAfter !== null &&
    input.compareLabel !== null &&
    input.namedBefore !== input.namedAfter
  ) {
    const up = input.namedAfter > input.namedBefore
    return {
      id: 'named',
      tone: up ? 'ok' : 'bad',
      lead: up ? 'Named more often.' : 'Named less often.',
      parts: [
        `${brand} is named in the answer text for `,
        count('named_after', input.namedAfter, 'Named now'),
        ` ${many}, ${up ? 'up' : 'down'} from `,
        count('named_before', input.namedBefore, `Named at ${input.compareLabel}`),
        '.'
      ]
    }
  }
  if (input.named === 0) return null
  return {
    id: 'named',
    tone: 'neutral',
    lead: 'Named in the answer.',
    parts: [
      `${brand} appears in the answer text for `,
      count('named', input.named, 'Brand named'),
      input.named === 1 ? ` ${one}.` : ` ${many}.`
    ]
  }
}

function competitionFinding(input: VerdictInput, count: CountOf): VerdictFinding | null {
  const top = input.topSite
  if (top === null || top.count === 0) return null
  const { brand } = input
  const { many } = nouns(input)
  if (top.count > input.cited) {
    return {
      id: 'competition',
      tone: 'warn',
      lead: `${top.name} is cited more.`,
      parts: [
        count('top_site', top.count, `Cite ${top.name}`),
        ` ${many} cite ${top.name}; `,
        count('cited', input.cited, 'You are cited'),
        ` cite ${brand}.`
      ]
    }
  }
  if (top.count === input.cited) {
    return {
      id: 'competition',
      tone: 'neutral',
      lead: `${brand} and ${top.name} are cited equally.`,
      parts: [
        count('cited', input.cited, 'You are cited'),
        ` ${many} cite ${brand}, and `,
        count('top_site', top.count, `Cite ${top.name}`),
        ` cite ${top.name}.`
      ]
    }
  }
  return {
    id: 'competition',
    tone: 'ok',
    lead: `${brand} is the most cited site.`,
    parts: [
      count('cited', input.cited, 'You are cited'),
      ` ${many} cite ${brand}, more than any other site. Next is ${top.name}, with `,
      count('top_site', top.count, `Cite ${top.name}`),
      '.'
    ]
  }
}

/** The finding as plain text, for previews, emails and accessible names. */
export function findingText(finding: VerdictFinding): string {
  const body = finding.parts.map((part) => (typeof part === 'string' ? part : String(part.n)))
  return `${finding.lead} ${body.join('')}`
}
