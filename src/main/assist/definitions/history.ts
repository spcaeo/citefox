import type { HistorySubject, ProjectCheck, ProjectHistory } from '@shared/ipc'
import { allowedNumbers, sentences, unknownNumbers } from '../../assistant/numbers'
import { buildProjectHistory } from '../../engine/progress/project-history'
import {
  AssistInputError,
  type AssistContext,
  type AssistDefinition,
  type AssistReply
} from '../types'
import { inputText, marketLabel, projectOf } from './gather'
import { checkTags } from './rules'

/** Pairs listed in the prompt; the rest are counted, not listed. */
export const WHAT_CHANGED_MAX_PAIRS = 15

export type ChangeDirection = 'better' | 'worse' | 'same'

/** One page or topic in one market: its last full check and the one before. */
export interface CheckPair {
  subject: HistorySubject
  marketId: string
  latest: ProjectCheck
  previous: ProjectCheck | null
  /** Null for a first check, or when either check has no score. */
  scoreChange: number | null
  direction: ChangeDirection | null
}

/**
 * Every page or topic and market in the view, with its last two finished full
 * checks (a follow-up that asked only some questions is not a full check), the
 * newest latest check first. Counted in code so the answer's numbers can be
 * checked against them.
 */
export function checkPairs(
  history: ProjectHistory,
  filter: { pageId: string | null; marketId: string | null; scope: 'pages' | 'topics' | null }
): CheckPair[] {
  const subjects = new Map(history.subjects.map((subject) => [subject.id, subject]))
  const groups = new Map<string, ProjectCheck[]>()
  for (const check of history.checks) {
    const subject = subjects.get(check.pageId)
    if (subject === undefined || check.status !== 'finished' || check.partial) continue
    if (filter.pageId !== null && check.pageId !== filter.pageId) continue
    if (filter.marketId !== null && check.marketId !== filter.marketId) continue
    if (filter.scope !== null && `${subject.kind}s` !== filter.scope) continue
    const key = `${check.pageId}|${check.marketId}`
    groups.set(key, [...(groups.get(key) ?? []), check])
  }
  const pairs: CheckPair[] = []
  for (const list of groups.values()) {
    const [latest, previous] = [...list].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    const subject = latest ? subjects.get(latest.pageId) : undefined
    if (latest === undefined || subject === undefined) continue
    const scoreChange =
      previous && latest.score !== null && previous.score !== null
        ? latest.score - previous.score
        : null
    pairs.push({
      subject,
      marketId: latest.marketId,
      latest,
      previous: previous ?? null,
      scoreChange,
      direction: previous ? directionOf(latest, previous, scoreChange) : null
    })
  }
  return pairs.sort((a, b) => b.latest.startedAt.localeCompare(a.latest.startedAt))
}

/** The score decides; with no score on either side, the page-cited count does. */
function directionOf(
  latest: ProjectCheck,
  previous: ProjectCheck,
  scoreChange: number | null
): ChangeDirection {
  const delta = scoreChange ?? latest.cited - previous.cited
  return delta > 0 ? 'better' : delta < 0 ? 'worse' : 'same'
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function score(check: ProjectCheck): string {
  return check.score === null ? 'no score' : String(check.score)
}

function pairLine(pair: CheckPair, market: string): string {
  const { latest, previous, subject } = pair
  const name = `"${subject.label}" (${subject.kind}${subject.url ? `, ${subject.url}` : ''}) · ${market}`
  if (previous === null) {
    return `- ${name}: one full check, ${day(latest.startedAt)}. Score ${score(latest)}. AI Overviews ${latest.aiOverviews} of ${latest.questionsChecked} questions. Page cited ${latest.cited}. Brand named ${latest.named}.`
  }
  const change = pair.scoreChange === null ? '' : ` (change ${signed(pair.scoreChange)})`
  return [
    `- ${name}: ${day(previous.startedAt)} → ${day(latest.startedAt)}, ${pair.direction ?? 'same'}.`,
    `Score ${score(previous)} → ${score(latest)}${change}.`,
    `AI Overviews ${previous.aiOverviews} of ${previous.questionsChecked} → ${latest.aiOverviews} of ${latest.questionsChecked} questions.`,
    `Page cited ${previous.cited} → ${latest.cited}.`,
    `Brand named ${previous.named} → ${latest.named}.`
  ].join(' ')
}

function scopeOf(context: AssistContext): 'pages' | 'topics' | null {
  const value = inputText(context, 'scope', 20)
  return value === 'pages' || value === 'topics' ? value : null
}

export interface WhatChangedRead {
  facts: string
  pairs: CheckPair[]
}

/** The pairs and the saved-data text for one run, read once per run. */
const READS = new WeakMap<AssistContext, WhatChangedRead>()
/** Runs whose first answer quoted a number that is not in the saved checks. */
const REJECTED = new WeakSet<AssistContext>()

function readWhatChanged(context: AssistContext): WhatChangedRead {
  const cached = READS.get(context)
  if (cached) return cached
  const opened = projectOf(context)
  const history = buildProjectHistory(opened.db, {
    projectId: opened.project.id,
    builtAt: new Date().toISOString()
  })
  const read = whatChangedFacts(history, {
    pageId: context.request.pageId,
    marketId: context.request.marketId,
    scope: scopeOf(context)
  })
  READS.set(context, read)
  return read
}

/**
 * The saved-data text for "What changed": the view, the counts code worked out,
 * and one line per page or topic and market with both checks' numbers. Throws
 * `AssistInputError` when the view has no finished full check.
 */
export function whatChangedFacts(
  history: ProjectHistory,
  filter: { pageId: string | null; marketId: string | null; scope: 'pages' | 'topics' | null }
): WhatChangedRead {
  const { pageId, marketId, scope } = filter
  if (pageId !== null && !history.subjects.some((subject) => subject.id === pageId)) {
    throw new AssistInputError('That page or topic has no checks yet.', 'Pick another one.')
  }
  const markets = new Map(history.markets.map((market) => [market.id, market]))
  if (marketId !== null && !markets.has(marketId)) {
    throw new AssistInputError('That market was not found.', 'Pick another market.')
  }
  const pairs = checkPairs(history, filter)
  if (pairs.length === 0) {
    throw new AssistInputError(
      'There is no finished full check in this view yet.',
      'Press Check now, then try again.'
    )
  }
  const compared = pairs.filter((pair) => pair.previous !== null)
  const count = (direction: ChangeDirection): number =>
    compared.filter((pair) => pair.direction === direction).length
  const label = (id: string): string => {
    const market = markets.get(id)
    return market ? marketLabel(market) : 'Removed market'
  }
  const listed = compared.slice(0, WHAT_CHANGED_MAX_PAIRS)
  const firsts = pairs.filter((pair) => pair.previous === null)
  const subject = history.subjects.find((item) => item.id === pageId)
  const view = subject
    ? subject.label
    : scope === 'pages'
      ? 'All pages'
      : scope === 'topics'
        ? 'All topics'
        : 'All pages and topics'
  const lines = [
    `View: ${view} · ${marketId === null ? 'All markets' : label(marketId)}`,
    `Compared: ${compared.length} (each page or topic in each market: its last full check and the one before)`,
    `Better: ${count('better')} · Worse: ${count('worse')} · Same: ${count('same')} · One check only: ${firsts.length}`,
    '',
    'Changes:',
    ...(listed.length > 0
      ? listed.map((pair) => pairLine(pair, label(pair.marketId)))
      : ['- none']),
    ...(compared.length > listed.length
      ? [`- ${compared.length - listed.length} more not listed`]
      : []),
    ...(firsts.length > 0
      ? [
          '',
          'One check only (nothing to compare yet):',
          ...firsts.slice(0, 5).map((pair) => pairLine(pair, label(pair.marketId)))
        ]
      : [])
  ]
  return { facts: lines.join('\n'), pairs }
}

/** What Claude may quote: the saved data and the user's own instruction. */
function allowedFor(context: AssistContext): Set<string> {
  return allowedNumbers(readWhatChanged(context).facts, context.request.instruction ?? '')
}

function replyNumbers(reply: AssistReply, allowed: ReadonlySet<string>): string[] {
  const texts = [
    reply.summary ?? '',
    reply.caution ?? '',
    ...reply.items.flatMap((item) => [item.text, item.detail ?? ''])
  ]
  return [...new Set(texts.flatMap((text) => unknownNumbers(text, allowed)))]
}

/** A text without the sentences that quote an unknown number, or null when none is left. */
function kept(
  text: string | null,
  allowed: ReadonlySet<string>,
  flagged: Set<string>
): string | null {
  if (text === null) return null
  const left: string[] = []
  for (const sentence of sentences(text)) {
    const bad = unknownNumbers(sentence, allowed)
    for (const value of bad) flagged.add(value)
    if (bad.length === 0) left.push(sentence)
  }
  const joined = left.join(' ').trim()
  return joined.length > 0 ? joined : null
}

export const HISTORY_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'history.whatChanged',
    title: 'What changed',
    expectedSeconds: 10,
    acceptsInstruction: true,
    needsProject: true,
    minItems: 0,
    maxItems: 5,
    task: `Say what changed between the last two full checks of each page or topic below, from the saved numbers only.
Write "summary" as one or two sentences on the overall picture: how many got better, worse or stayed the same.
Then give up to 5 items, the biggest changes first (worse before better when they are the same size). Each item is one page or topic in one market: tag "worse", "better" or "same"; "text" is one sentence that names it, the market, the two dates, and what moved (score, AI Overviews, page cited, brand named).
Use only numbers listed under "Saved data", written exactly as they are. Do not add, subtract, average or estimate a number. Do not say why anything changed.`,
    gather(context) {
      return readWhatChanged(context).facts
    },
    answerFromSaved(context) {
      const { pairs } = readWhatChanged(context)
      if (pairs.some((pair) => pair.previous !== null)) return null
      return {
        summary: `${pairs.length === 1 ? 'This page or topic has' : `All ${pairs.length} pages and topics here have`} one full check so far, so there is nothing to compare yet.`,
        items: [],
        caution: null
      }
    },
    check(reply, context) {
      const tags = checkTags(
        reply,
        ['worse', 'better', 'same'],
        'Tag each item "worse", "better" or "same".'
      )
      if (tags !== null) return tags
      // The first answer with an invented number is asked again with the numbers named;
      // what is still wrong after that is taken out in `finish` and flagged.
      const invented = replyNumbers(reply, allowedFor(context))
      if (invented.length === 0 || REJECTED.has(context)) return null
      REJECTED.add(context)
      return `These numbers are not in the saved checks: ${invented.join(', ')}. Use only the numbers listed, or say the number is not in the saved data.`
    },
    finish(reply, context) {
      const allowed = allowedFor(context)
      if (replyNumbers(reply, allowed).length === 0) return reply
      const flagged = new Set<string>()
      const summary = kept(reply.summary, allowed, flagged)
      const items = reply.items.flatMap((item) => {
        const text = kept(item.text, allowed, flagged)
        if (text === null) return []
        return [{ ...item, text, detail: kept(item.detail, allowed, flagged) }]
      })
      const caution = kept(reply.caution, allowed, flagged)
      const note = `Took out sentences with numbers that are not in your saved checks (${[...flagged].join(', ')}). Check the grid for those.`
      return { summary, items, caution: caution === null ? note : `${caution} ${note}` }
    }
  }
]
