/**
 * Code checks of Claude's setup answers against what the site read actually saw
 * (prompt bench report 2026-10-31): a path must be a real page or menu path, a name or
 * quote must appear in the page text, a number must appear in the page text next to the
 * same word, and a category label ("cloud", "platform", "AI-powered") stays only when the
 * site uses that word. Prompt rules ask for the same; these make it hold. Pure.
 */

/** Below this much page text a missing word proves little: the text checks stay off. */
export const CHECK_MIN_CHARS = 5000

/** Labels a summary may use only when the site uses the same word. */
const LABELS: readonly { word: string; swap: string }[] = [
  { word: 'cloud-based', swap: '' },
  { word: 'cloud', swap: '' },
  { word: 'AI-powered', swap: '' },
  { word: 'AI powered', swap: '' },
  { word: 'AI-driven', swap: '' },
  { word: 'enterprise-grade', swap: '' },
  { word: 'enterprise', swap: '' },
  { word: 'all-in-one', swap: '' },
  { word: 'end-to-end', swap: '' },
  { word: 'leading', swap: '' },
  { word: 'innovative', swap: '' },
  { word: 'cutting-edge', swap: '' },
  { word: 'seamless', swap: '' },
  { word: 'powerful', swap: '' },
  { word: 'robust', swap: '' },
  { word: 'world-class', swap: '' },
  { word: 'best-in-class', swap: '' },
  { word: 'next-generation', swap: '' },
  { word: 'platform', swap: 'product' },
  { word: 'platforms', swap: 'products' }
]

export interface SiteCheck {
  /** Path keys of every page read and menu link. */
  paths: ReadonlySet<string>
  /** The page text (titles and menu words included), or '' when too little was read. */
  text: string
  /** `text` folded: lower case, letters and digits only. */
  folded: string
}

export interface SiteSource {
  pages: readonly { path: string; title: string }[]
  menu: readonly { text: string; path: string }[]
  text?: string
}

/** The checks for a site; text checks only when the read saw `CHECK_MIN_CHARS`. */
export function siteCheckOf(site: SiteSource | null | undefined): SiteCheck | null {
  if (!site) return null
  const paths = new Set<string>()
  for (const page of site.pages) if (page.path.length > 0) paths.add(pathKey(page.path))
  for (const link of site.menu) paths.add(pathKey(link.path))
  const raw = site.text ?? ''
  const text =
    raw.length >= CHECK_MIN_CHARS
      ? [raw, ...site.pages.map((page) => page.title), ...site.menu.map((link) => link.text)].join(
          '\n'
        )
      : ''
  return { paths, text, folded: fold(text) }
}

/** True when the check can judge words (enough page text). */
export function canCheckText(check: SiteCheck | null): check is SiteCheck {
  return check !== null && check.text.length > 0
}

export function fold(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** A path compared without case, query or a trailing slash. */
export function pathKey(path: string): string {
  let value = path.trim().toLowerCase()
  value = value.replace(/^https?:\/\/[^/]+/u, '').replace(/[?#].*$/u, '')
  if (!value.startsWith('/')) value = `/${value}`
  return value.length > 1 ? value.replace(/\/+$/u, '') || '/' : value
}

/** True when the path is a page read or a menu link on the site. */
export function isSitePath(check: SiteCheck | null, path: string | null): boolean {
  if (check === null || path === null) return false
  return check.paths.has(pathKey(path))
}

/** The path when the site has it, else null (no check: the path as given). */
export function sitePathOrNull(check: SiteCheck | null, path: string | null): string | null {
  if (path === null) return null
  if (check === null || check.paths.size === 0) return path
  return isSitePath(check, path) ? path : null
}

/** True when the words appear in the page text (case, spaces and punctuation ignored). */
export function siteSays(check: SiteCheck, words: string): boolean {
  const key = fold(words)
  return key.length >= 2 && check.folded.includes(key)
}

/**
 * True when a quote or a path backs the row: a real non-home path, or at least four
 * letters copied from the page text.
 */
export function backedBy(check: SiteCheck, evidence: string): boolean {
  const value = evidence.trim().replace(/^["“'‘]|["”'’]$/gu, '')
  if (value.length === 0) return false
  if (value.startsWith('/') && !/\s/u.test(value)) {
    return pathKey(value) !== '/' && isSitePath(check, value)
  }
  return fold(value).length >= 4 && siteSays(check, value)
}

/** Numbers a text states ("40,000", "$29", "30+", "5-50"), each with the word after it. */
function numberClaims(text: string): { number: string; word: string; next: string }[] {
  const out: { number: string; word: string; next: string }[] = []
  const pattern =
    /(?<![\p{L}\d])[$€£]?(\d[\d,.]*)(?:\s?[kKmMbB](?![\p{L}]))?\+?%?(?:\s+(\p{L}[\p{L}-]*)(?:\s+(\p{L}[\p{L}-]*))?)?/gu
  for (const match of text.matchAll(pattern)) {
    const number = (match[1] ?? '').replace(/[.,]+$/u, '').replace(/,(?=\d{3}\b)/gu, '')
    if (number.length === 0) continue
    const whole = match[0]
    const before = text.slice(Math.max(0, (match.index ?? 0) - 30), match.index ?? 0)
    // A year, or a version in a product's name ("Windows 10", "Magento 1"), is not a claim.
    if (/^(?:19|20)\d{2}$/u.test(number) && !/[$€£%+]/u.test(whole)) continue
    if (
      /^\d{1,2}(?:\.\d)?$/u.test(number) &&
      /\b\p{Lu}[\p{L}.-]*\s$/u.test(before) &&
      !/[$€£%+]/u.test(whole)
    ) {
      continue
    }
    out.push({
      number,
      word: (match[2] ?? '').toLowerCase(),
      next: (match[3] ?? '').toLowerCase()
    })
  }
  return out
}

/**
 * The numbers in `text` the page text does not back: the number must appear, and when a
 * word follows it ("30+ currencies"), that word's stem must follow it on the site too.
 */
export function unbackedNumbers(check: SiteCheck, text: string): string[] {
  const site = check.text.replace(/(\d),(?=\d{3}\b)/gu, '$1')
  const bad: string[] = []
  for (const { number, word, next } of numberClaims(text)) {
    const at = new RegExp(`(?<![\\d.])${escape(number)}(?![\\d])`, 'gu')
    const hits = [...site.matchAll(at)]
    if (hits.length === 0) {
      bad.push(number)
      continue
    }
    if (word.length < 3 || /^(?:and|or|to|of|in|a|an|the|per|a-month)$/u.test(word)) continue
    // "45+ connected apps" is backed by "45+ Apps included": the noun may come one word later.
    const stems = [word, next]
      .filter((item) => item.length >= 3)
      .map((item) => item.slice(0, Math.min(5, item.length)))
    const near = hits.some((hit) => {
      const after = site.slice(hit.index ?? 0, (hit.index ?? 0) + number.length + 40).toLowerCase()
      return stems.some((stem) => after.includes(stem))
    })
    if (!near) bad.push(`${number} ${word}`)
  }
  return bad
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * A summary held to the site: category labels the site never uses are taken out (a
 * noun such as "platform" becomes "product"), and a sentence with a number the site does
 * not back is dropped (never the only sentence). No check: the text as given.
 */
export function groundSummary(text: string, check: SiteCheck | null): string {
  if (!canCheckText(check)) return text
  let out = text
  for (const label of LABELS) {
    if (wordIn(check.text, label.word)) continue
    out = replaceWord(out, label.word, label.swap)
  }
  const sentences = splitSentences(out)
  const kept = sentences.filter((sentence) => unbackedNumbers(check, sentence).length === 0)
  if (kept.length > 0 && kept.length < sentences.length) out = kept.join(' ')
  return out.replace(/\s{2,}/gu, ' ').trim()
}

function wordIn(text: string, word: string): boolean {
  return new RegExp(`(?<![\\p{L}])${escape(word)}(?![\\p{L}])`, 'iu').test(text)
}

/** Takes a word out (or swaps it), fixing "a"/"an" in front of it. */
function replaceWord(text: string, word: string, swap: string): string {
  const pattern = new RegExp(
    `(\\b[Aa]n?\\s+)?(?<![\\p{L}-])${escape(word)}(?![\\p{L}-])(\\s*)`,
    'giu'
  )
  return text.replace(
    pattern,
    (_all, article: string | undefined, space: string, offset, whole: string) => {
      const rest = whole.slice(offset + _all.length)
      const next = swap.length > 0 ? swap : (rest.match(/^\p{L}+/u)?.[0] ?? '')
      const lead = article === undefined ? '' : articleFor(article, next)
      return swap.length > 0 ? `${lead}${swap}${space}` : lead
    }
  )
}

function articleFor(article: string, next: string): string {
  const upper = article.startsWith('A')
  const an = /^[aeiou]/iu.test(next)
  return `${upper ? 'A' : 'a'}${an ? 'n' : ''} `
}

export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/gu) ?? [text])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

/** At most `max` characters, cut at the last sentence end that fits (else at a word). */
export function cutAtSentence(text: string, max: number): string {
  const flat = text.trim()
  if (flat.length <= max) return flat
  const head = flat.slice(0, max)
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  if (end >= max * 0.4) return head.slice(0, end + 1).trim()
  const space = head.lastIndexOf(' ')
  return `${head.slice(0, space > 0 ? space : max - 1).trimEnd()}…`
}

/**
 * A buyer or trigger line without size bands and money the site does not back:
 * "(50-300 employees)", "with 200–2,000 employees", "doing $500K–$5M a year".
 */
export function withoutGuessedSizes(text: string, check: SiteCheck | null): string {
  const backed = (part: string): boolean =>
    canCheckText(check) && unbackedNumbers(check, part).length === 0
  let out = text.replace(/\s*\(([^)]*\d[^)]*)\)/gu, (all, inner: string) =>
    backed(inner) ? all : ''
  )
  const NUM = String.raw`[$€£]?\d[\d,.]*\s?[kKmMbB]?\+?(?:\s?(?:-|–|—|to)\s?[$€£]?\d[\d,.]*\s?[kKmMbB]?\+?)?`
  const UNIT = String.raw`(?:employees?|staff|people|persons?|engineers?|reps?|clients?|locations?|seats?|users?|agents?|clinicians?|stores?|developers?|members?|customers?)`
  // "5-person", "50-200 employee": a size used as an adjective ("a 40-person startup").
  const ADJECTIVE = new RegExp(
    String.raw`(\b[Aa]n?\s+)?\b${NUM}[- ](?:person|employee|people|seat|location|engineer|clinician|store|country|office)\b\s*`,
    'gu'
  )
  // "a team of 800", "a company of about 300 people".
  const TEAM_OF = new RegExp(
    String.raw`\b(team|company|firm|business|startup|group|organi[sz]ation|staff)\s+of\s+(?:about|around|roughly|over|under|nearly|almost|some)?\s*${NUM}(?:\s+${UNIT})?(?![\d\p{L}])`,
    'giu'
  )
  // "with 200–2,000 employees", "doing $500K–$5M a year".
  const PHRASE = new RegExp(
    String.raw`\s*,?\s+(?:with|of|doing|having|running|managing|and)\s+(?:under|over|about|around|fewer than|more than|up to|roughly)?\s*${NUM}\s+(?:${UNIT}|in (?:annual )?revenue|a year|per year|annually|ARR|in sales)\b`,
    'giu'
  )
  out = out.replace(PHRASE, (all) => (backed(all) ? all : ''))
  out = out.replace(TEAM_OF, (all, noun: string) => (backed(all) ? all : noun))
  out = out.replace(
    ADJECTIVE,
    (all: string, article: string | undefined, offset: number, whole: string) => {
      if (backed(all)) return all
      if (article === undefined) return ''
      const next = whole.slice(offset + all.length).match(/^\p{L}+/u)?.[0] ?? ''
      return articleFor(article, next)
    }
  )
  return out
    .replace(/\s{2,}/gu, ' ')
    .replace(/\s+([,.;])/gu, '$1')
    .trim()
}

/** Plan and tier words: never a brand on their own ("Premium", "Pro Plus"). */
const PLAN_WORD =
  /^(?:free|pro|plus|premium|essentials?|starter|basic|standard|business|enterprise|teams?|advanced|ultimate|growth|scale|core|max|lite|personal|professional|startup|plan)$/iu

/**
 * True for a name that is an ordinary word or feature label rather than a brand
 * (round 2 of the prompt bench): it never holds the main brand word, and it is a plan
 * word, a short acronym ("CDP", "AEO"), one plural or -ing word ("Surveys", "Tracing"),
 * a phrase with a lower-case word ("Data warehouse"), or words the pages also use in
 * lower case mid-sentence ("storage", "session replay"). Such names match ordinary words
 * in any AI answer, so they make poor tracked brands. Product names ("Jira", "Shop Pay",
 * "Linear Agent") pass. Without enough page text only the shape rules apply.
 */
export function ordinaryName(name: string, main: string, check: SiteCheck | null): boolean {
  const words = name.trim().split(/\s+/u).filter(Boolean)
  if (words.length === 0) return true
  const mainKey = fold(main)
  if (mainKey.length >= 3 && fold(name).includes(mainKey)) return false
  // A family name ("Freshsales", "Freshdesk" for Freshworks): one word sharing the brand's start.
  if (words.length === 1 && mainKey.length >= 5 && fold(name).startsWith(mainKey.slice(0, 5))) {
    return false
  }
  if (words.every((word) => PLAN_WORD.test(word))) return true
  if (words.length === 1) {
    const word = words[0] ?? ''
    if (/^[A-Z]{2,4}$/u.test(word)) return true
    // A plural ("Surveys", "Releases"; not "Atlas" or "Nexus") or an -ing word.
    if (/^[A-Z][a-z]+(?:[^aiosu\W]s|ing)$/u.test(word)) return true
  } else if (words.slice(1).some((word) => /^[a-z]{3,}$/u.test(word))) {
    return true
  }
  if (!canCheckText(check)) return false
  const spaced = name
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/\s+/u)
    .map(escape)
    .join('\\s+')
  if (spaced === escape(name)) return false
  // Lower case and not inside a path, host or handle ("/storage", "trello.com").
  const lower = new RegExp(
    `(?<![\\p{L}\\p{N}/.@#_-])${spaced}(?![\\p{L}\\p{N}/@_-])(?!\\.\\p{L})`,
    'u'
  )
  return lower.test(check.text)
}
