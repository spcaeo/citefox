import {
  MIN_SNIPPET_CHARS,
  NOSNIPPET_SHARE,
  type EligibilityIssue,
  type EligibilityWhere,
  type PageEligibility
} from '@shared/domain'
import { scanTags, type HtmlTag } from './html-scan'

/** Robots directives that hold a colon themselves, so the text before it is not a crawler name. */
const COLON_DIRECTIVES = new Set([
  'max-snippet',
  'max-image-preview',
  'max-video-preview',
  'unavailable_after'
])

/** Meta names Google Search reads for its own crawler. */
const GOOGLE_META_NAMES = new Set(['robots', 'googlebot'])

/** Elements with no content, so `data-nosnippet` on them hides nothing. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr'
])

/** A crawler name in an X-Robots-Tag group: one word, such as `googlebot` or `bingbot`. */
const CRAWLER_NAME = /^[a-z0-9_-]+$/

interface Directive {
  value: string
  where: EligibilityWhere
}

/**
 * Whether Google may show and quote the page, from the HTML of a direct read and
 * its final response headers: noindex (or none), nosnippet and a max-snippet under
 * {@link MIN_SNIPPET_CHARS} in a robots or googlebot meta tag or the X-Robots-Tag
 * header, and data-nosnippet over {@link NOSNIPPET_SHARE} of the visible text.
 * The strictest directive wins. Linear in the size of the page.
 */
export function readEligibility(
  html: string,
  headers?: Readonly<Record<string, string>>
): PageEligibility {
  const tags = scanTags(html)
  const directives = [...metaDirectives(tags), ...headerDirectives(headers)]
  const issues: EligibilityIssue[] = []
  const add = (issue: EligibilityIssue): void => {
    if (!issues.some((item) => item.code === issue.code)) issues.push(issue)
  }
  let smallest: Directive & { chars: number } = { value: '', where: 'meta', chars: Infinity }
  for (const directive of directives) {
    const value = directive.value
    if (value === 'noindex' || value === 'none') {
      add({ code: 'noindex', where: directive.where, detail: value })
    } else if (value === 'nosnippet') {
      add({ code: 'nosnippet', where: directive.where, detail: value })
    } else if (value.startsWith('max-snippet:')) {
      const chars = Number.parseInt(value.slice('max-snippet:'.length).trim(), 10)
      if (Number.isInteger(chars) && chars >= 0 && chars < smallest.chars) {
        smallest = { ...directive, chars }
      }
    }
  }
  if (smallest.chars < MIN_SNIPPET_CHARS) {
    add({ code: 'max_snippet', where: smallest.where, detail: `max-snippet:${smallest.chars}` })
  }
  const share = nosnippetShare(html, tags)
  if (share >= NOSNIPPET_SHARE) {
    add({
      code: 'data_nosnippet',
      where: 'html',
      detail: `data-nosnippet on ${Math.round(share * 100)}% of the text`
    })
  }
  return { issues }
}

function metaDirectives(tags: readonly HtmlTag[]): Directive[] {
  const found: Directive[] = []
  for (const tag of tags) {
    if (tag.closing || tag.name !== 'meta') continue
    const name = (tag.attrs.name ?? '').trim().toLowerCase()
    if (!GOOGLE_META_NAMES.has(name)) continue
    for (const value of splitDirectives(tag.attrs.content ?? '')) {
      found.push({ value, where: 'meta' })
    }
  }
  return found
}

/**
 * X-Robots-Tag: a comma list where `googlebot: nosnippet` starts a group for that
 * crawler and the tokens after it stay in that group. Tokens with no crawler name
 * apply to every crawler; another crawler's group is skipped.
 */
function headerDirectives(headers: Readonly<Record<string, string>> | undefined): Directive[] {
  const value = headerValue(headers, 'x-robots-tag')
  if (value === null) return []
  const found: Directive[] = []
  let crawler: string | null = null
  for (const raw of value.split(',')) {
    let token = raw.trim().toLowerCase()
    const colon = token.indexOf(':')
    if (colon !== -1) {
      const before = token.slice(0, colon).trim()
      if (!COLON_DIRECTIVES.has(before)) {
        // Not a crawler name (a date inside unavailable_after): not a directive either.
        if (!CRAWLER_NAME.test(before)) continue
        crawler = before
        token = token.slice(colon + 1).trim()
      }
    }
    if (token.length === 0) continue
    if (crawler !== null && crawler !== 'googlebot') continue
    found.push({ value: normalizeDirective(token), where: 'header' })
  }
  return found
}

function splitDirectives(content: string): string[] {
  return content
    .split(',')
    .map((item) => normalizeDirective(item.trim().toLowerCase()))
    .filter((item) => item.length > 0)
}

/** `max-snippet : 20` reads as `max-snippet:20`. */
function normalizeDirective(token: string): string {
  const colon = token.indexOf(':')
  if (colon === -1) return token
  return `${token.slice(0, colon).trim()}:${token.slice(colon + 1).trim()}`
}

/**
 * The share of the body's visible characters inside elements that carry
 * `data-nosnippet`. One forward pass: inside such an element, nested elements of
 * the same name are counted so its own close tag ends it. An element that never
 * closes runs to the end of the page. Spaces do not count.
 */
function nosnippetShare(html: string, tags: readonly HtmlTag[]): number {
  const bodyOpen = tags.findIndex((tag) => !tag.closing && tag.name === 'body')
  let inBody = bodyOpen === -1
  let total = 0
  let hidden = 0
  let hiddenName: string | null = null
  let depth = 0
  let cursor = 0
  for (const tag of tags) {
    if (tag.start > cursor && inBody) {
      const chars = visibleChars(html, cursor, tag.start)
      total += chars
      if (hiddenName !== null) hidden += chars
    }
    cursor = Math.max(cursor, tag.end)
    if (tag.name === 'body') {
      inBody = !tag.closing
      continue
    }
    if (hiddenName !== null) {
      if (tag.name !== hiddenName) continue
      depth += tag.closing ? -1 : 1
      if (depth === 0) hiddenName = null
      continue
    }
    if (
      !tag.closing &&
      tag.rawText === null &&
      !VOID_ELEMENTS.has(tag.name) &&
      Object.prototype.hasOwnProperty.call(tag.attrs, 'data-nosnippet')
    ) {
      hiddenName = tag.name
      depth = 1
    }
  }
  if (cursor < html.length && inBody) {
    const chars = visibleChars(html, cursor, html.length)
    total += chars
    if (hiddenName !== null) hidden += chars
  }
  return total === 0 ? 0 : hidden / total
}

function visibleChars(html: string, from: number, to: number): number {
  let count = 0
  for (let index = from; index < to; index += 1) {
    const code = html.charCodeAt(index)
    if (code !== 32 && code !== 9 && code !== 10 && code !== 13 && code !== 12) count += 1
  }
  return count
}

function headerValue(
  headers: Readonly<Record<string, string>> | undefined,
  name: string
): string | null {
  if (headers === undefined) return null
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return null
}
