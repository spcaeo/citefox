import { TOPIC_STAGES, type TopicProfilePoint, type TopicStage } from '@shared/domain'
import { namesBrand } from './text'

/**
 * Buyer variety across the journey (Docs/PROMPT-AUDIT.md, P3): code hands each stage
 * call its own buyers from the profile, so no buyer carries more than a few of the
 * questions, and caps how often one piece of sending software is named. Pure.
 */

/** Different buyers the profile is asked for; the journey spreads its questions over them. */
export const JOURNEY_BUYERS_MAX = 6
/** At most this many questions name one buyer, or one piece of sending software. */
export const QUESTIONS_PER_BUYER_MAX = 3

/**
 * The buyers to write for: the profile's `who` points, then its `segments` points
 * when `who` has fewer than five, at most {@link JOURNEY_BUYERS_MAX}.
 */
export function journeyBuyers(
  points: readonly Pick<TopicProfilePoint, 'section' | 'text'>[]
): string[] {
  const of = (section: TopicProfilePoint['section']): string[] =>
    points
      .filter((point) => point.section === section)
      .map((point) =>
        point.text
          .replace(/\[(?:[^\]]*?\be\.g\.,?\s*)?([^\]]+)\]/gu, '$1')
          .trim()
          .replace(/[\s.;]+$/u, '')
      )
      .filter((text) => text.length > 0)
  const who = of('who')
  const buyers = who.length >= 5 ? who : [...who, ...of('segments')]
  return [...new Set(buyers)].slice(0, JOURNEY_BUYERS_MAX)
}

/**
 * One buyer per question slot, dealt in journey order (problem first), so with six
 * buyers and 15 questions no buyer gets more than three and each stage's buyers differ.
 */
export function assignBuyers(
  buyers: readonly string[],
  perStage: Readonly<Record<TopicStage, number>>
): Record<TopicStage, string[]> {
  let slot = 0
  const assigned = {} as Record<TopicStage, string[]>
  for (const stage of TOPIC_STAGES) {
    const count = Math.max(0, perStage[stage])
    assigned[stage] = []
    for (let index = 0; index < count && buyers.length > 0; index += 1) {
      assigned[stage].push(buyers[slot % buyers.length] as string)
      slot += 1
    }
  }
  return assigned
}

/** `{{ buyers }}`: "Question 1: <buyer>" lines, one per question asked. */
export function buyersText(buyers: readonly string[]): string {
  if (buyers.length === 0) return 'Pick a different buyer from the profile for each question.'
  return buyers.map((buyer, index) => `Question ${index + 1}: ${buyer}.`).join('\n')
}

/** A kept question as the cap sees it. */
export interface CappedQuestion {
  stage: TopicStage
  text: string
  namedTool: string | null
}

/** Software names, never a carrier gateway or an email-to-text address. */
const NOT_SOFTWARE = /gateway|carrier|vtext|txt\.att|tmomail|e-?mail[- ]to[- ](?:text|sms)/iu

function flat(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * The software named in more than {@link QUESTIONS_PER_BUYER_MAX} questions, and which
 * questions go over: the first three (in journey order) are kept, the rest are listed
 * by stage and position. "Milestone XProtect" and "XProtect" count as one.
 */
export function overusedSoftware(
  questions: readonly CappedQuestion[],
  max: number = QUESTIONS_PER_BUYER_MAX
): { tools: string[]; over: CappedQuestion[] } {
  const names: string[] = []
  for (const question of questions) {
    const tool = question.namedTool?.trim() ?? ''
    if (tool.length < 3 || NOT_SOFTWARE.test(tool)) continue
    const key = flat(tool)
    const same = names.findIndex((name) => {
      const other = flat(name)
      return other.includes(key) || key.includes(other)
    })
    // Keep the shorter spelling: it matches both in text.
    if (same === -1) names.push(tool)
    else if (tool.length < (names[same] as string).length) names[same] = tool
  }
  const order = (question: CappedQuestion): number => TOPIC_STAGES.indexOf(question.stage)
  const sorted = [...questions].sort((left, right) => order(left) - order(right))
  const tools: string[] = []
  const over: CappedQuestion[] = []
  for (const name of names) {
    const naming = sorted.filter(
      (question) =>
        namesBrand(question.text, [name]) ||
        (question.namedTool !== null && flat(question.namedTool).includes(flat(name)))
    )
    if (naming.length <= max) continue
    tools.push(name)
    for (const question of naming.slice(max)) {
      if (!over.includes(question)) over.push(question)
    }
  }
  return { tools, over }
}
