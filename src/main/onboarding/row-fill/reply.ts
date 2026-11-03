import type { RowFillResult } from '@shared/ipc'
import { isSitePath, pathKey, siteCheckOf } from '../../engine/site-grounding'
import type { SiteOutline } from '../../engine/site-outline'
import { isNotAnAnswer } from '../../assist/answer-guard'
import { pathOrNull } from '../sections/rows'
import { FILL_MAX_CHARS, FILL_MAX_WORDS, type RowFillDef } from './defs'

/**
 * Reads the AI's JSON answer into a fill. Pure. The rules the prompt asks for hold here
 * too: an "unknown" answer is blank, a line is cut to the word cap, a line that only
 * repeats the name is blank, and a page that is not already a known page of the site is
 * dropped (a URL is never invented). A blank line drops the page too: the AI did not
 * recognise the name.
 */

export const BLANK_FILL: RowFillResult = { detail: '', url: null }

const UNKNOWN =
  /^(?:unknown|unsure|not sure|n\/?a|none|nothing|no idea|unclear|not known|i don'?t know|can(?:'|’)?t tell|cannot tell|\?+|-+|—+|…+|\.+)\.?$/iu

/** Words that make a cut line read badly if it ends on them. */
const DANGLING = new Set([
  'and',
  'or',
  'for',
  'to',
  'the',
  'a',
  'an',
  'of',
  'in',
  'with',
  'by',
  'that'
])

/** The reply as JSON: the provider's own parse, else the first {...} in the text. */
export function replyJson(json: unknown, text: string): unknown {
  if (json !== null && json !== undefined) return json
  try {
    return JSON.parse(text) as unknown
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown
    } catch {
      return null
    }
  }
}

function cleanLine(raw: string): string {
  let line = raw
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^["“'‘`]+|["”'’`]+$/gu, '')
    .trim()
  if (UNKNOWN.test(line)) return ''
  const words = line.split(' ').filter(Boolean)
  if (words.length > FILL_MAX_WORDS) {
    const cut = words.slice(0, FILL_MAX_WORDS)
    while (
      cut.length > 1 &&
      DANGLING.has((cut.at(-1) ?? '').toLowerCase().replace(/[^\p{L}]/gu, ''))
    ) {
      cut.pop()
    }
    line = cut.join(' ')
  }
  if (line.length > FILL_MAX_CHARS) line = `${line.slice(0, FILL_MAX_CHARS - 1).trimEnd()}…`
  return line
    .replace(/[\s,;:–—-]+$/u, '')
    .replace(/\.$/u, '')
    .trim()
}

const fold = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The known page spelled as the site lists it, when `path` is one of them. */
function knownPage(site: SiteOutline | null, path: string): string | null {
  if (site === null) return null
  const check = siteCheckOf(site)
  if (check === null || check.paths.size === 0 || !isSitePath(check, path)) return null
  const key = pathKey(path)
  const listed = [...site.pages.map((page) => page.path), ...site.menu.map((link) => link.path)]
  return listed.find((item) => pathKey(item) === key) ?? path
}

export function readRowFill(
  def: RowFillDef,
  name: string,
  value: unknown,
  site: SiteOutline | null
): RowFillResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return BLANK_FILL
  const record = value as Record<string, unknown>
  const raw = typeof record.line === 'string' ? record.line : ''
  const line = cleanLine(raw)
  // Claude talking about itself, or the name said again, is not a description.
  if (line.length === 0 || isNotAnAnswer(line) || fold(line) === fold(name)) return BLANK_FILL
  let url: string | null = null
  if (def.withPage && typeof record.page === 'string') {
    const path = pathOrNull(record.page.trim())
    url = path === null ? null : knownPage(site, path)
  }
  return { detail: line, url }
}
