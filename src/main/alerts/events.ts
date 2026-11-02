import type { CheckRunStatus, PromptCheckStatus } from '@shared/domain'
import { DEFAULT_SCORE_DROP, type AlertRuleInput, type AlertRuleWhen } from '@shared/ipc'

/**
 * Alert rules read two checks of the same page in the same market: the check that just
 * finished and the full check before it. Pure: `facts.ts` reads the rows, this file
 * says whether a rule fires and what changed, so the dry run and the live evaluation
 * after each check always agree.
 */

/** One question of one check, scored as Results scores it. */
export interface QuestionFacts {
  promptId: string
  text: string
  status: PromptCheckStatus
  /** Bare domains of competitors the overview cited (classification `competitor`). */
  competitors: readonly string[]
}

/** One stored check of one page in one market. */
export interface RunFacts {
  runId: string
  pageId: string
  marketId: string
  /** ISO-8601 UTC; the start time when the run never finished. */
  at: string
  status: CheckRunStatus
  partial: boolean
  /** The page's visibility score for this check. Null without an AI Overview. */
  score: number | null
  questions: readonly QuestionFacts[]
}

export interface AlertMatch {
  when: AlertRuleWhen
  summary: string
  details: readonly string[]
}

const AIO = new Set<PromptCheckStatus>([
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited'
])

const MAX_DETAILS = 5

/** What a rule needs from `AlertRuleInput` to match. */
export type MatchRule = Pick<AlertRuleInput, 'when' | 'scoreDrop' | 'competitorDomain'>

/**
 * Whether `rule` fires for `current`, compared with `previous` (the last full check of
 * the same page and market before it, or null). Only `check_failed` fires without a
 * previous check; a partial re-check never fires a comparison (SRS section 7.4).
 */
export function matchRule(
  rule: MatchRule,
  previous: RunFacts | null,
  current: RunFacts
): AlertMatch | null {
  if (rule.when === 'check_failed') return failed(current)
  if (current.status !== 'finished' || current.partial) return null
  if (previous === null || previous.partial || previous.status !== 'finished') return null
  const before = new Map(previous.questions.map((question) => [question.promptId, question]))
  const pairs = current.questions.flatMap((question) => {
    const old = before.get(question.promptId)
    return old === undefined ? [] : [{ old, now: question }]
  })
  switch (rule.when) {
    case 'citation_lost':
      return listed(
        'citation_lost',
        pairs
          .filter(({ old, now }) => old.status === 'page_cited' && cited(now.status) === false)
          .map(({ now }) => now.text),
        (count) => `Target page no longer cited on ${questions(count)}`
      )
    case 'citation_gained':
      return listed(
        'citation_gained',
        pairs
          .filter(({ old, now }) => now.status === 'page_cited' && cited(old.status) === false)
          .map(({ now }) => now.text),
        (count) => `Right page cited on ${questions(count)}`
      )
    case 'wrong_page':
      return listed(
        'wrong_page',
        pairs
          .filter(
            ({ old, now }) => now.status === 'other_own_page' && old.status !== 'other_own_page'
          )
          .map(({ now }) => now.text),
        (count) => `Your other page cited instead on ${questions(count)}`
      )
    case 'aio_gone':
      return listed(
        'aio_gone',
        pairs
          .filter(({ old, now }) => AIO.has(old.status) && now.status === 'no_aio')
          .map(({ now }) => now.text),
        (count) => `No AI Overview any more on ${questions(count)}`
      )
    case 'score_drop':
      return scoreDrop(rule.scoreDrop ?? DEFAULT_SCORE_DROP, previous, current)
    case 'competitor_cited':
      return competitor(rule.competitorDomain, pairs)
  }
}

/** True when the overview cites the page; null when the question failed (no answer). */
function cited(status: PromptCheckStatus): boolean | null {
  if (status === 'error') return null
  return status === 'page_cited'
}

function failed(current: RunFacts): AlertMatch | null {
  if (current.status === 'error') {
    return { when: 'check_failed', summary: 'The check failed', details: [] }
  }
  if (current.status !== 'finished') return null
  const total = current.questions.length
  if (total === 0 || current.questions.some((question) => question.status !== 'error')) return null
  return {
    when: 'check_failed',
    summary: `Every question failed (${questions(total)})`,
    details: []
  }
}

function scoreDrop(points: number, previous: RunFacts, current: RunFacts): AlertMatch | null {
  if (previous.score === null || current.score === null) return null
  const drop = previous.score - current.score
  if (drop < points) return null
  return {
    when: 'score_drop',
    summary: `Score fell from ${previous.score} to ${current.score} (−${drop})`,
    details: []
  }
}

function competitor(
  domain: string | null,
  pairs: readonly { old: QuestionFacts; now: QuestionFacts }[]
): AlertMatch | null {
  const hits: string[] = []
  const domains = new Set<string>()
  for (const { old, now } of pairs) {
    if (now.status === 'page_cited') continue
    const named = now.competitors.filter((item) => domain === null || sameSite(item, domain))
    const fresh = named.filter(
      (item) =>
        old.status === 'page_cited' || !old.competitors.some((before) => sameSite(before, item))
    )
    if (fresh.length === 0) continue
    for (const item of fresh) domains.add(item)
    hits.push(`${fresh.join(', ')} on “${now.text}”`)
  }
  if (hits.length === 0) return null
  const who = domain ?? [...domains].slice(0, 2).join(', ')
  return {
    when: 'competitor_cited',
    summary: `${who} is cited instead on ${questions(hits.length)}`,
    details: hits.slice(0, MAX_DETAILS)
  }
}

function listed(
  when: AlertRuleWhen,
  texts: readonly string[],
  summary: (count: number) => string
): AlertMatch | null {
  if (texts.length === 0) return null
  return { when, summary: summary(texts.length), details: texts.slice(0, MAX_DETAILS) }
}

function questions(count: number): string {
  return count === 1 ? '1 question' : `${count} questions`
}

/** `www.twilio.com` and `twilio.com` are the same competitor; `api.twilio.com` counts too. */
export function sameSite(cited: string, domain: string): boolean {
  const a = bare(cited)
  const b = bare(domain)
  return a === b || a.endsWith(`.${b}`)
}

function bare(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
}
