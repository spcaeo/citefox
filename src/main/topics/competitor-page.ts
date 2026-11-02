import type { NamedCompetitor } from '../engine/competitor-context'

/**
 * A competitor's page as the competitor prompts see it (Docs/PROMPT-AUDIT.md,
 * package P4): its real name, its headings and text without Markdown noise, a
 * question's section snapped to one of its headings, and fence-safe text. Pure.
 */

/** "[Send text from your email](https://…)", "**30,000+**", "1.   Upload numbers" → plain words. */
export function cleanHeading(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`]{1,3}/gu, '')
    .replace(/^\s*(?:\d+\.|[-•])\s+/u, '')
    .replace(/\s+#+\s*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

const CHROME_HEADING =
  /^(?:cookie settings|cookies?|skip to (?:main )?content|menu|close|search)$/iu

/** Menu and footer labels; a short heading that is one of these is site chrome, not content. */
const NAV_LABEL =
  /^(?:about(?: us)?|account|apps?|blog|careers|channels|company|contact(?: us)?|developers|features|free tools|get (?:the )?app|help(?: center)?|integrations|legal|login|log in|partners|platform|press|products?|resources|solutions|support|tools|use cases|industries)$/iu

/**
 * Their headings in page order: cleaned, unique, without cookie, menu and footer
 * chrome: a one- or two-word heading the page repeats, or a menu label when the
 * page has a cluster of them (three or more, as a footer menu does). A single
 * "Integrations" section is content and stays.
 */
export function cleanHeadings(outline: readonly string[]): string[] {
  const cleaned = outline.map(cleanHeading)
  const repeats = new Map<string, number>()
  for (const heading of cleaned) {
    const key = headingKey(heading)
    repeats.set(key, (repeats.get(key) ?? 0) + 1)
  }
  const navLabels = new Set(
    cleaned.map(headingKey).filter((key) => key.split(' ').length <= 2 && NAV_LABEL.test(key))
  )
  const footerMenu = navLabels.size >= 3
  const seen = new Set<string>()
  const out: string[] = []
  for (const heading of cleaned) {
    const key = headingKey(heading)
    const short = key.split(' ').length <= 2
    const chrome =
      CHROME_HEADING.test(heading) ||
      (footerMenu && navLabels.has(key)) ||
      (short && (repeats.get(key) ?? 0) > 1)
    if (heading.length < 2 || chrome || seen.has(key)) continue
    seen.add(key)
    out.push(heading)
  }
  return out
}

/**
 * Page text without Markdown links, images and bare addresses, so the characters
 * sent are words a reader sees. Cut at `max` characters on a line.
 */
export function cleanPageText(markdown: string, max: number): string {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/<https?:\/\/[^>]+>/gu, '')
    .replace(/https?:\/\/\S+/gu, '')
    .replace(/[*_]{2,3}/gu, '')
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line, index, lines) => line.length > 0 && line !== lines[index - 1])
    .join('\n')
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lineEnd = cut.lastIndexOf('\n')
  return lineEnd > max * 0.8 ? cut.slice(0, lineEnd) : cut
}

/** Breaks a closing `</tag` inside untrusted text so it cannot end the fence early. */
export function fenceSafe(text: string, tag: string): string {
  return text.replace(new RegExp(`</(\\s*${tag})`, 'giu'), '< /$1')
}

function headingKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function tokens(value: string): Set<string> {
  return new Set(
    headingKey(value)
      .split(' ')
      .filter((word) => word.length > 1)
  )
}

/**
 * A section named by a reply, as one of their headings exactly as written: the same
 * words, or a heading that shares most of its words. Null when none is close.
 */
export function snapSection(section: string | null, headings: readonly string[]): string | null {
  if (section === null) return null
  const key = headingKey(cleanHeading(section))
  if (key.length === 0) return null
  const exact = headings.find((heading) => headingKey(heading) === key)
  if (exact !== undefined) return exact
  const wanted = tokens(section)
  let best: { heading: string; score: number } | null = null
  for (const heading of headings) {
    const have = tokens(heading)
    const shared = [...wanted].filter((word) => have.has(word)).length
    const score = shared / Math.max(1, new Set([...wanted, ...have]).size)
    if (best === null || score > best.score) best = { heading, score }
  }
  return best !== null && best.score >= 0.6 ? best.heading : null
}

// ---------------------------------------------------------------------------
// The competitor's real name
// ---------------------------------------------------------------------------

/** What the name is read from. */
export interface CompetitorNameInput {
  /** Host without `www.`, such as `get-voip.com`. */
  domain: string
  title: string | null
  h1: string | null
  /** `og:site_name` when the read kept it. */
  siteName?: string | null
  /** The page text (Markdown or plain). */
  text: string
}

/** The domain's first label, letters and digits only: `get-voip.com` → `getvoip`. */
function domainStem(domain: string): string {
  const host = domain.toLowerCase().replace(/^www\./u, '')
  const parts = host.split('.')
  // `co.uk`-style endings: the stem is the label before them.
  const label = parts.length > 2 && (parts.at(-2)?.length ?? 0) <= 3 ? parts.at(-3) : parts[0]
  return (label ?? host).replace(/[^a-z0-9]/gu, '')
}

function letters(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '')
}

/** Title parts split at " | ", " - ", " – ", " — ", " · " and ": ". */
function titleParts(title: string): string[] {
  return title
    .split(/\s+[|–—·-]\s+|:\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 40)
}

/**
 * The competitor's real name, in this order:
 * 1. a saved competitor with the same domain (unless it was saved as a bare domain);
 * 2. `og:site_name` when it spells the domain;
 * 3. the title part that spells the domain ("… | TXTImpact" for txtimpact.com);
 * 4. the brand as the page writes it ("GetVoIP" in the text of get-voip.com);
 * 5. `og:site_name`, then the last short title part;
 * 6. the domain's first label, capitalised.
 */
export function competitorName(
  input: CompetitorNameInput,
  known: readonly NamedCompetitor[] = []
): string {
  const domain = input.domain.toLowerCase().replace(/^www\./u, '')
  const stem = domainStem(domain)
  const saved = known.find(
    (item) =>
      item.domain !== null &&
      (item.domain === domain || domain.endsWith(`.${item.domain}`)) &&
      item.name.trim().toLowerCase() !== item.domain
  )
  if (saved !== undefined) return saved.name.trim()
  const siteName = (input.siteName ?? '').trim()
  if (siteName.length > 0 && letters(siteName) === stem) return siteName
  const parts = [input.title, input.h1]
    .filter((value): value is string => value !== null)
    .flatMap(titleParts)
  const spelled = parts.find((part) => letters(part) === stem)
  if (spelled !== undefined) return spelled
  const onPage = brandOnPage(input.text, stem)
  if (onPage !== null) return onPage
  if (siteName.length > 0 && siteName.length <= 40) return siteName
  const lastPart = input.title === null ? undefined : titleParts(input.title).at(-1)
  if (lastPart !== undefined && lastPart.split(/\s+/u).length <= 3) {
    if (titleParts(input.title ?? '').length > 1) return lastPart
  }
  const label = domain.split('.')[0] ?? domain
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * The most frequent spelling on the page that reads as the domain stem: one word
 * ("TXTImpact"), or two or three words joined ("Get VoIP"). Null when none does.
 */
function brandOnPage(text: string, stem: string): string | null {
  if (stem.length < 3) return null
  const counts = new Map<string, number>()
  const tokens = text.split(/[^\p{L}\p{N}&'-]+/u).filter(Boolean)
  for (let i = 0; i < tokens.length; i += 1) {
    for (let size = 1; size <= 3 && i + size <= tokens.length; size += 1) {
      const phrase = tokens.slice(i, i + size).join(size === 1 ? '' : ' ')
      if (letters(phrase) !== stem) continue
      // A lower-case match is a word in a sentence, not the brand as written.
      if (phrase === phrase.toLowerCase()) continue
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1)
    }
  }
  let best: [string, number] | null = null
  for (const entry of counts) if (best === null || entry[1] > best[1]) best = entry
  return best?.[0] ?? null
}
