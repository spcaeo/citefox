/**
 * Dates a page states about itself in its visible text: "Last updated: Oct 15, 2026",
 * "Published on 1 October 2026". Many pages show these to readers but put nothing in
 * their meta tags, JSON-LD or `<time>` elements, so the page read falls back to them
 * last. Pure: same text, same dates.
 *
 * The text comes from untrusted pages. Labels are found with one forward pass, and the
 * date patterns only ever run on a short slice after a label, so a hostile page cannot
 * make the matching slow.
 */

export interface VisibleDates {
  /** `YYYY-MM-DD` from "Published on …", "Published: …" or "Posted on …". */
  publishedAt: string | null
  /** `YYYY-MM-DD` from "Updated on …", "Last updated: …" or "Modified on …". */
  modifiedAt: string | null
}

/**
 * "Last updated" is listed before "updated" so the longer label wins where both start.
 * `\b` on both sides keeps "Republished" and "outdated" out.
 */
const LABEL = /\b(last\s+updated|updated|modified|published|posted)\b/gi

/** A date has to start this close to its label, and its patterns see no more. */
const SLICE = 64

/** "on", a colon, or both, between the label and the date. */
const JOINER = /^\s*(?:on\b)?\s*:?\s*/i

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/
/** "Oct 15, 2026", "Oct. 15, 2026", "October 15th, 2026". */
const MONTH_FIRST = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)/i
/** "15 October 2026", "15 Oct 2026", "15 Oct. 2026". */
const DAY_FIRST = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})(?!\d)/i

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
}

/**
 * The first published and the first updated date the text states. A label with no
 * readable date after it (or an impossible one, such as Feb 30) is skipped, and the
 * search goes on to the next label of that kind.
 */
export function visibleDates(text: string): VisibleDates {
  let publishedAt: string | null = null
  let modifiedAt: string | null = null
  for (const match of text.matchAll(LABEL)) {
    const label = (match[1] ?? '').toLowerCase()
    const published = label === 'published' || label === 'posted'
    if (published ? publishedAt !== null : modifiedAt !== null) continue
    const after = match.index + match[0].length
    const date = parseVisibleDate(text.slice(after, after + SLICE).replace(JOINER, ''))
    if (date === null) continue
    if (published) publishedAt = date
    else modifiedAt = date
    if (publishedAt !== null && modifiedAt !== null) break
  }
  return { publishedAt, modifiedAt }
}

/**
 * The date at the start of `raw` as `YYYY-MM-DD`, or null. Reads "2026-10-15",
 * "Oct 15, 2026", "Oct. 15, 2026", "October 15, 2026", "15 October 2026" and
 * "15 Oct 2026". Only the first 64 characters are looked at.
 */
export function parseVisibleDate(raw: string): string | null {
  const head = raw.trimStart().slice(0, SLICE)
  const iso = ISO.exec(head)
  if (iso !== null) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const monthFirst = MONTH_FIRST.exec(head)
  if (monthFirst !== null) {
    return calendarDate(Number(monthFirst[3]), monthNumber(monthFirst[1]), Number(monthFirst[2]))
  }
  const dayFirst = DAY_FIRST.exec(head)
  if (dayFirst !== null) {
    return calendarDate(Number(dayFirst[3]), monthNumber(dayFirst[2]), Number(dayFirst[1]))
  }
  return null
}

function monthNumber(name: string | undefined): number {
  return MONTHS[(name ?? '').toLowerCase()] ?? 0
}

/** `YYYY-MM-DD` when the day exists on the calendar, else null (Feb 30, month 13). */
function calendarDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null
  if (date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
