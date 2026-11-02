import { DEFAULT_PROMPT_COUNT, type Market } from '@shared/domain'
import { addressOf, nextMarketKey, type MarketRow } from '../projects/addPageModel'
import { parseIds, type ScopePage } from '../scope'

/** How the new page gets its questions: Claude drafts them from the page, or you type them. */
export type QuestionWay = 'claude' | 'type'

/** Most questions one add takes (`prompts:addQuestions` takes 50). */
export const MAX_TYPED_QUESTIONS = 50
/** Most questions Claude is asked to draft from the drawer. */
export const MAX_DRAFT_COUNT = 50

/** Add a page's values on the URL (`addpage.*`, `DRAWER_KINDS['add-page']`). */
export interface AddPageState {
  url: string
  label: string
  /** A group to file the page in. Null: none. */
  groupId: string | null
  /** The topic the drawer was opened from (prefill only; see the drawer). */
  topicId: string | null
  way: QuestionWay
  /** Questions Claude drafts. */
  count: number
}

export function parseAddPageParams(
  params: Readonly<Record<string, string | undefined>>
): AddPageState {
  const count = Number(params['addpage.count'])
  return {
    url: params['addpage.url'] ?? '',
    label: params['addpage.label'] ?? '',
    groupId: parseIds(params['addpage.group'])[0] ?? null,
    topicId: parseIds(params['addpage.topic'])[0] ?? null,
    way: params['addpage.questions'] === 'type' ? 'type' : 'claude',
    count:
      Number.isInteger(count) && count >= 1 && count <= MAX_DRAFT_COUNT
        ? count
        : DEFAULT_PROMPT_COUNT
  }
}

/** URL values for a change (null removes a key; defaults are left off the URL). */
export function addPageParamsPatch(patch: Partial<AddPageState>): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  if (patch.url !== undefined) out['addpage.url'] = patch.url || null
  if (patch.label !== undefined) out['addpage.label'] = patch.label || null
  if (patch.groupId !== undefined) out['addpage.group'] = patch.groupId
  if (patch.topicId !== undefined) out['addpage.topic'] = patch.topicId
  if (patch.way !== undefined) out['addpage.questions'] = patch.way === 'claude' ? null : patch.way
  if (patch.count !== undefined) {
    out['addpage.count'] = patch.count === DEFAULT_PROMPT_COUNT ? null : String(patch.count)
  }
  return out
}

/**
 * The addresses in what was pasted: one per line, or separated by spaces or
 * commas. Two or more means the user meant Import pages.
 */
export function pastedAddresses(text: string): string[] {
  return text
    .split(/[\s,]+/u)
    .map((part) => part.trim())
    .filter((part) => /^(https?:\/\/|\/)\S+|^[\w-]+(\.[\w-]+)+\/?\S*$/iu.test(part))
}

/** The page's address as saved, or null with the reason it cannot be added. */
export function checkedAddress(
  typed: string,
  domain: string
): { url: string; problem: null } | { url: null; problem: string } {
  if (typed.trim().length === 0) return { url: null, problem: 'Enter the page’s address.' }
  try {
    const parsed = new URL(addressOf(typed, domain))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
    return { url: parsed.toString(), problem: null }
  } catch {
    return { url: null, problem: 'Enter the page’s public http or https address.' }
  }
}

/** A URL compared loosely: no scheme, no `www.`, no trailing slash, no hash, lower-case host. */
export function comparableUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, '')
    const path = parsed.pathname.replace(/\/+$/u, '')
    return `${host}${path}${parsed.search}`
  } catch {
    return url.trim().toLowerCase()
  }
}

/** The tracked page with this address, if any ("Already tracked"). */
export function trackedMatch(url: string, pages: readonly ScopePage[]): ScopePage | null {
  const key = comparableUrl(url)
  return pages.find((page) => page.tracked && comparableUrl(page.url) === key) ?? null
}

/** The address's host when it is not the project's own site, else null. */
export function otherSite(url: string, domain: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./u, '')
    const own = domain
      .toLowerCase()
      .replace(/^https?:\/\//u, '')
      .replace(/\/.*$/u, '')
      .replace(/^www\./u, '')
    return host === own || host.endsWith(`.${own}`) ? null : host
  } catch {
    return null
  }
}

/** Typed questions, one per line, blanks and repeats dropped. */
export function typedQuestions(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of text.split('\n')) {
    const question = line.trim()
    const key = question.toLowerCase()
    if (question.length === 0 || seen.has(key)) continue
    seen.add(key)
    out.push(question)
  }
  return out
}

/** The first market row: the project's default market, else US English. */
export function defaultMarketRow(market: Market | null): MarketRow {
  return {
    key: nextMarketKey(),
    country: market?.country ?? 'US',
    language: market?.language ?? 'en',
    location: market?.location ?? '',
    localWording: market?.localWording ?? false
  }
}
