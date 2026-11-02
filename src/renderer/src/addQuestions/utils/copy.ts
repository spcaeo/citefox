import type { Market } from '@shared/domain'
import type { QuestionTarget } from '@shared/ipc'
import { pluralize, questionsAndKeywords } from '@shared/pluralize'
import { plainMarket, searchRange } from '../../promptDetail/edit/model'

/** Questions at or after this many days out name the date, not the weekday. */
const WEEK_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** "#/questions?source=<id>": the Questions list filtered to one page or topic. */
export function questionsHash(targetId: string): string {
  return `#/questions?source=${encodeURIComponent(targetId)}`
}

/** "Replacing a carrier gateway · 10 questions", keywords counted apart. */
export function targetOption(
  target: Pick<QuestionTarget, 'name' | 'questions' | 'keywords'>
): string {
  return `${target.name} · ${questionsAndKeywords(target.questions - target.keywords, target.keywords)}`
}

/** True when the page or topic takes questions now. */
export function takesQuestions(target: Pick<QuestionTarget, 'status'>): boolean {
  return target.status === 'tracked' || target.status === 'paused'
}

/** "market US · EN" or "markets US · EN and UK · EN". */
export function marketsText(markets: readonly Market[]): string {
  const names = markets.map(plainMarket)
  if (names.length === 0) return 'no market yet'
  if (names.length === 1) return `market ${names[0] ?? ''}`
  return `markets ${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

/**
 * What "Add and check now" spends, counted as a re-check is (prompt detail): one search
 * per question, market and sample, and a second when Google loads the overview apart.
 */
export function checkCost(
  questions: number,
  markets: number,
  samples: number
): { min: number; max: number } {
  const one = searchRange(samples, markets)
  return { min: one.min * questions, max: one.max * questions }
}

/** "checking now uses 6 searches, up to 12 · 412 left · market US · EN". */
export function costText(input: {
  questions: number
  markets: readonly Market[]
  samples: number
  searchesLeft: number | null
}): string {
  const { min, max } = checkCost(input.questions, input.markets.length, input.samples)
  const uses = `checking now uses ${pluralize(min, 'search', 'searches')}`
  const most = max > min ? `, up to ${max.toLocaleString('en-US')}` : ''
  const left =
    input.searchesLeft === null ? '' : ` · ${input.searchesLeft.toLocaleString('en-US')} left`
  return `${uses}${most}${left} · ${marketsText(input.markets)}`
}

/**
 * Why "Add and check now" cannot run, or null. Adding to the next check still works.
 * The worst case counts: a check that can use more searches than are left would stop
 * part-way, so it is blocked with both numbers shown.
 */
export function checkNowProblem(input: {
  questions: number
  markets: number
  samples: number
  searchesLeft: number | null
}): string | null {
  if (input.markets === 0) return 'This page has no market to check in yet.'
  const { min, max } = checkCost(input.questions, input.markets, input.samples)
  if (input.searchesLeft !== null && max > input.searchesLeft) {
    const left = input.searchesLeft
    const uses =
      max > min
        ? `can use up to ${max.toLocaleString('en-US')}`
        : `uses ${max.toLocaleString('en-US')}`
    return `Not enough searches left this month to check now: this ${uses} and ${left.toLocaleString('en-US')} ${left === 1 ? 'is' : 'are'} left. Add them to the next check instead.`
  }
  return null
}

/**
 * The secondary button: "Add to Tuesday’s check" for a check within the week,
 * "Add to today’s check", "Add to tomorrow’s check", "Add to the Nov 12 check"
 * further out, and "Add without checking" when nothing is scheduled.
 */
export function nextCheckLabel(nextCheckAt: string | null, now: Date): string {
  if (nextCheckAt === null) return 'Add without checking'
  const at = new Date(nextCheckAt)
  if (Number.isNaN(at.getTime())) return 'Add without checking'
  const days = Math.round((startOfDay(at) - startOfDay(now)) / MS_PER_DAY)
  if (days <= 0) return 'Add to today’s check'
  if (days === 1) return 'Add to tomorrow’s check'
  if (days < WEEK_DAYS) {
    return `Add to ${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(at)}’s check`
  }
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(at)
  return `Add to the ${date} check`
}

/** "6 questions added" or "6 questions added · checking now". */
export function addedText(count: number, checking: boolean): string {
  const base = `${pluralize(count, 'question')} added`
  return checking ? `${base} · checking now` : base
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
