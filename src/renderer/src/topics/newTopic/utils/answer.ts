import { isTopicStage, type TopicStage } from '@shared/domain'
import type { HelpFillRow, TopicPageCandidate, TopicTarget } from '@shared/ipc'

/**
 * A chatbot's answer for "A buyer problem" (kind `topic`: question, stage, page,
 * topic) as the dialog's plan: the topic's name, its questions with their stage,
 * and the page each should be cited on. Pure; the dialog writes it to its draft.
 */

export interface AnswerQuestion {
  text: string
  stage: TopicStage | null
  /** The page as written (`/pricing/` or a full address); '' for none. */
  page: string
}

export interface AnswerPlan {
  /** The name most rows gave; '' when none did. */
  name: string
  questions: AnswerQuestion[]
}

export function answerPlan(rows: readonly HelpFillRow[]): AnswerPlan {
  const names = new Map<string, number>()
  const questions: AnswerQuestion[] = []
  for (const row of rows) {
    const text = (row.values.question ?? '').trim()
    if (text.length === 0) continue
    const stage = row.values.stage ?? ''
    questions.push({
      text,
      stage: isTopicStage(stage) ? stage : null,
      page: (row.values.page ?? '').trim()
    })
    const name = (row.values.topic ?? '').trim()
    if (name.length > 0) names.set(name, (names.get(name) ?? 0) + 1)
  }
  let name = ''
  let most = 0
  for (const [value, count] of names) {
    if (count > most) {
      name = value
      most = count
    }
  }
  return { name, questions }
}

/** `/pricing/` from a path or an address; null when it is neither. */
export function pathOfPage(page: string): string | null {
  const trimmed = page.trim()
  if (trimmed.startsWith('/')) return trimmed.split(/[?#]/u)[0] ?? trimmed
  try {
    return new URL(trimmed).pathname || '/'
  } catch {
    return null
  }
}

function samePath(left: string, right: string): boolean {
  const strip = (path: string): string => path.replace(/\/+$/u, '').toLowerCase()
  return strip(left) === strip(right)
}

/**
 * Where a question's page points: a tracked page when its path matches one, else a
 * new page on the site (the address made from a tracked page's origin). Null when
 * the page is blank or cannot be placed; Target pages matches those.
 */
export function targetFor(
  page: string,
  candidates: readonly TopicPageCandidate[]
): TopicTarget | null {
  const path = pathOfPage(page)
  if (path === null) return null
  const known = candidates.find((candidate) => {
    const own = pathOfPage(candidate.url)
    return own !== null && samePath(own, path)
  })
  if (known) return { pageId: known.pageId, url: known.url }
  if (/^https?:\/\//iu.test(page.trim())) return { pageId: null, url: page.trim() }
  const origin = candidates
    .map((candidate) => {
      try {
        return new URL(candidate.url).origin
      } catch {
        return null
      }
    })
    .find((value): value is string => value !== null)
  return origin === undefined ? null : { pageId: null, url: `${origin}${path}` }
}

/** "Buyer problem: …" put into the prompt before the tracked list, when one was typed. */
export function promptWithProblem(prompt: string, situation: string): string {
  const problem = scrubTyped(situation).replace(/\s+/gu, ' ').trim()
  if (problem.length === 0) return prompt
  const line = `Buyer problem: ${problem.length > 400 ? `${problem.slice(0, 399)}…` : problem}`
  const lines = prompt.split('\n')
  const at = lines.findIndex((item) => item.startsWith('Already tracked'))
  if (at < 0) return `${line}\n${prompt}`
  return [...lines.slice(0, at), line, ...lines.slice(at)].join('\n')
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu
const FILE_PATH = /file:\/\/\S+|~\/\S*|\/(?:Users|Volumes|home|private|var)\/\S*|\b[A-Za-z]:\\\S*/gu
const KEYISH = /\b(?:sk-|AKIA|ghp_|xox[abp]-)[A-Za-z0-9_-]{12,}|\b[a-f0-9]{32,}\b/giu

/**
 * The typed problem leaves the app in the prompt: email addresses, key-shaped tokens
 * and local file paths are taken out, as main does for the rest of the prompt.
 */
export function scrubTyped(text: string): string {
  return text.replace(EMAIL, '').replace(KEYISH, '').replace(FILE_PATH, '')
}
