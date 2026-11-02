import type { BacklinkPriority, LoopStep } from '../../fix-loop'
import type { SiteKind } from '../site-kinds'
import type { VisibilityExtras } from './visibility-extras'
import type { AnswerExtras } from './sources-types'

/**
 * What a ready report needs beyond the metrics (Docs/REPORT-SPEC.md "Ready reports"):
 * the backlink ask list, what changed on pages that lost ground, the next round's owners,
 * the shape of each stored answer, and the "Prepared for" line. Main reads it from the
 * project database (`reports:review`, `reports:download`); a report without it still
 * builds, with these sections saying there is nothing to show.
 */

/** The shape of one stored answer, read from its text. */
export interface AnswerShape {
  words: number
  /** Two or more bullet or numbered lines. */
  list: boolean
  /** Two or more numbered lines or "Step 1" lines. */
  steps: boolean
  /** Two or more table rows (`| a | b |`). */
  table: boolean
}

/** A page on the backlink ask list (the Fixes screen's rule, `needsBacklinks`). */
export interface BacklinkAsk {
  url: string
  title: string | null
  priority: BacklinkPriority
  /** Why it needs links, in plain words: "Not cited yet", "Lost ground", "Not indexed". */
  reason: string
  /** The saved anchor text, else one suggested from the page's title or address. */
  anchor: string
  anchorSaved: boolean
  daysLive: number | null
}

/** The latest change CiteFox saw on a page that lost ground (page history). */
export interface PageChangeNote {
  url: string
  /** ISO-8601 UTC: when the change happened (or was first seen). */
  changedAt: string
  sectionsAdded: number
  sectionsRemoved: number
  headingsChanged: number
  textChanged: number
  /** The headings of the sections that changed, in page order. */
  sections: readonly string[]
  wordsBefore: number | null
  wordsAfter: number | null
  /** The headings of the version before and after the change (h2 and h3), in page order. */
  outlineBefore?: readonly OutlineLine[]
  outlineAfter?: readonly OutlineLine[]
}

/** One heading of a page version. */
export interface OutlineLine {
  level: number
  text: string
}

/** The dates a page states about itself (its newest read), by address. */
export interface PageDates {
  publishedAt: string | null
  modifiedAt: string | null
}

export interface RoundOwner {
  step: LoopStep
  owner: string
}

export interface ReportBranding {
  /** "Prepared for <name>". Empty: no line. */
  preparedFor: string
  /** The person's own logo as a data URL (png, jpeg, webp or svg). Null: none. */
  logo: string | null
  /**
   * In-house reports only (src/shared/report/review/sender.ts): "Prepared by <name or
   * team>" for this project, over the app-wide one. Absent or empty: the app-wide one.
   */
  preparedBy?: string
}

export interface ReportExtras {
  /** By metrics row id (engine rows; an All engines row reads its parts). */
  shapes: Readonly<Record<string, AnswerShape>>
  backlinks: readonly BacklinkAsk[]
  /** By page address. */
  changes: Readonly<Record<string, PageChangeNote>>
  owners: readonly RoundOwner[]
  /** ISO-8601 UTC of the next scheduled check, or null. */
  nextCheckAt: string | null
  intervalDays: number | null
  branding: ReportBranding
  /**
   * What changed › Pages: each metrics row's target pages (its Primary and Also OK
   * pages, src/main/topics/question-targets.ts), by row id. Absent or empty: no target.
   */
  targets?: Readonly<Record<string, readonly string[]>>
  /** Page history changes of every tracked page, by page address, newest first. */
  pageChanges?: Readonly<Record<string, readonly PageChangeNote[]>>
  /** The page edits CiteFox AI wrote and saved for a page, by page address. */
  pageEdits?: Readonly<Record<string, { changes: number; savedAt: string }>>
  /**
   * Answer structure: each Google AI Overview's classified blocks by metrics row id, as
   * block codes in reading order with repeats collapsed (`A1`, `C4`, …).
   */
  blocks?: Readonly<Record<string, readonly string[]>>
  /** The plain name of each block code ("What / Definition"). */
  blockLabels?: Readonly<Record<string, string>>
  /**
   * How AI talks about you: the claims CiteFox AI read about your own brand in each
   * Google AI Overview, by metrics row id (Docs/REPORT-SPEC.md §5 Reputation).
   */
  claims?: Readonly<Record<string, readonly BrandClaim[]>>
  /** Questions written for each published page (its tracked questions), by address. */
  questionsFor?: Readonly<Record<string, number>>
  /** The dates each published page states (page history), by address. */
  pageDates?: Readonly<Record<string, PageDates>>
  /**
   * Each question's own pages (the Primary page first, then the Also OK pages), by
   * metrics `questionId`. Absent or empty: no target page set. (`targets` above is the
   * same, by metrics row id, for What changed › Pages.)
   */
  questionTargets?: Readonly<Record<string, readonly string[]>>
  /** The kind of each cited site (a saved competitor, the built-in list, CiteFox AI's sort). */
  siteKinds?: Readonly<Record<string, SiteKind>>
  /** The Visibility report's cover, target pages, tone and since-last-check (optional). */
  visibility?: VisibilityExtras
  /** Citations, answer blocks and community details (Sources, Answer shape). */
  answers?: AnswerExtras
  /**
   * CiteFox AI's best page for each question without a Primary page (its pick, sure or
   * not), by metrics `questionId`. The Content plan names it as the page to write or fix.
   */
  aiPages?: Readonly<Record<string, string>>
}

/** One claim an AI Overview makes about your brand. */
export interface BrandClaim {
  polarity: 'positive' | 'neutral' | 'negative'
  sentence: string
  theme: string
}

export const NO_BRANDING: ReportBranding = { preparedFor: '', logo: null }

export const EMPTY_EXTRAS: ReportExtras = {
  shapes: {},
  backlinks: [],
  changes: {},
  owners: [],
  nextCheckAt: null,
  intervalDays: null,
  branding: NO_BRANDING
}

/** Longest "Prepared for" name, in characters. */
export const PREPARED_FOR_MAX = 80
/** Largest logo, as a data URL, in characters (about 150 KB of image). */
export const LOGO_MAX = 200_000
export const LOGO_PATTERN = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/

/** A branding as saved: the name trimmed and cut, a logo only when it is a small image. */
export function cleanBranding(value: unknown): ReportBranding {
  if (typeof value !== 'object' || value === null) return NO_BRANDING
  const { preparedFor, logo, preparedBy } = value as Record<string, unknown>
  const clip = (text: unknown): string =>
    typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, PREPARED_FOR_MAX) : ''
  const name = clip(preparedFor)
  const image =
    typeof logo === 'string' && logo.length <= LOGO_MAX && LOGO_PATTERN.test(logo) ? logo : null
  const by = clip(preparedBy)
  return by === ''
    ? { preparedFor: name, logo: image }
    : { preparedFor: name, logo: image, preparedBy: by }
}

const TABLE_LINE = /^\s*\|.*\|\s*$/
const TABLE_RULE = /^\s*\|?\s*:?-{3,}/
const NUMBERED = /^\s*(?:\d{1,2}[.)]|step\s+\d{1,2}\b)/i
const BULLET = /^\s*(?:[-*•▪◦‣]|\d{1,2}[.)])\s+\S/

/**
 * The shape of an answer from its stored text (Markdown or plain text): lists, steps,
 * tables and length. Pure. Null text: no shape.
 */
export function answerShape(text: string | null | undefined): AnswerShape | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const lines = trimmed.split(/\r?\n/)
  let bullets = 0
  let numbered = 0
  let tableRows = 0
  for (const line of lines) {
    if (TABLE_LINE.test(line) && !TABLE_RULE.test(line)) tableRows += 1
    if (NUMBERED.test(line)) numbered += 1
    if (BULLET.test(line)) bullets += 1
  }
  const words = trimmed
    .replace(/[|#*_`>-]+/g, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length
  return { words, list: bullets >= 2, steps: numbered >= 2, table: tableRows >= 2 }
}

/**
 * A suggested anchor text from a page's title or address: the title without the site
 * name after "|" or " - ", else the address's last part in words. Pure.
 */
export function suggestAnchor(url: string, title: string | null): string {
  const fromTitle = (title ?? '')
    .split(/\s[|–—-]\s|\s\|\s?/)[0]
    ?.replace(/\s+/g, ' ')
    .trim()
  if (fromTitle && fromTitle.length >= 3) return fromTitle.slice(0, 70)
  let slug: string
  try {
    slug =
      new URL(url).pathname
        .split('/')
        .filter((part) => part.length > 0)
        .at(-1) ?? ''
  } catch {
    slug = ''
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(slug)
  } catch {
    decoded = slug
  }
  const words = decoded
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[-_+]+/g, ' ')
    .trim()
  if (words.length === 0) return 'home page'
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const STEP_TEXT = /^\s*(?:\d{1,2}[.)]|step\s+\d{1,2}\b)/i

/**
 * A Google AI Overview's shape from its stored SerpApi blocks (`raw_aio_json`): the
 * stored text is one line, so lists, steps and tables come from the block types. Falls
 * back to the text alone. Pure.
 */
export function overviewShape(raw: string | null, text: string | null): AnswerShape | null {
  const base = answerShape(text)
  if (raw === null) return base
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return base
  }
  const found = { list: false, steps: false, table: false, words: 0 }
  const seen = new Set<unknown>()
  const walk = (value: unknown, depth: number): void => {
    if (depth > 8 || value === null || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    const block = value as Record<string, unknown>
    if (typeof block.snippet === 'string') found.words += block.snippet.split(/\s+/).length
    const list = block.list
    if (Array.isArray(list) && list.length >= 2) {
      found.list = true
      const numbered = list.filter((item) => {
        const record = item as Record<string, unknown> | null
        const words = `${typeof record?.title === 'string' ? record.title : ''} ${typeof record?.snippet === 'string' ? record.snippet : ''}`
        return STEP_TEXT.test(words)
      }).length
      if (numbered >= 2 || String(block.type ?? '').includes('ordered')) found.steps = true
    }
    if ((Array.isArray(block.table) && block.table.length >= 2) || block.type === 'table') {
      found.table = true
    }
    for (const [key, item] of Object.entries(block)) {
      if (key !== 'references') walk(item, depth + 1)
    }
  }
  walk(parsed, 0)
  if (base === null && found.words === 0) return null
  return {
    words: base?.words ?? found.words,
    list: (base?.list ?? false) || found.list,
    steps: (base?.steps ?? false) || found.steps,
    table: (base?.table ?? false) || found.table
  }
}
