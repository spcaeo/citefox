/**
 * Reads why Claude stopped answering from Claude Code's own words (stdout, stderr or
 * the JSON `result`) and from Anthropic API error bodies. Only failure output is read
 * here, except `limitReplyOnly`, which accepts a reply that is nothing but a limit line.
 *
 * Claude Code 2.1.x words a plan limit as "You've hit your <limit> · resets <when>",
 * where <limit> is "session limit", "5-hour limit", "weekly limit", "Opus limit" and
 * so on, and <when> is "7:30pm (America/Toronto)" or "Nov 2, 9am (America/Toronto)".
 * Older builds wrote "Claude AI usage limit reached|<epoch seconds>" and
 * "Weekly limit reached ∙ resets 3pm".
 */

/** Which window ran out. `unknown` when neither the words nor the reset time say. */
export type ClaudeLimitKind = 'session' | 'weekly' | 'unknown'

export interface ClaudeLimitInfo {
  kind: ClaudeLimitKind
  /** When Claude works again. Null when the message gives no time. */
  resetsAt: Date | null
}

/** Why a call failed when the account, not the request, is the problem. */
export type ClaudeAccountProblem = 'logged_out' | 'plan_inactive' | 'credit_low' | 'unauthorized'

/** A short-lived "try again shortly" from the API, not the plan running out. */
export type ClaudeTransientLimit = 'rate_limited' | 'overloaded'

export type ClaudeFailureKind =
  | { kind: 'account'; problem: ClaudeAccountProblem }
  | { kind: 'limit'; limit: ClaudeLimitInfo }
  | { kind: 'transient'; code: ClaudeTransientLimit }

const APOS = `['’]`

const CREDIT_LOW = /credit balance (?:is )?too low|insufficient (?:credits?|funds|balance)/i

const PLAN_INACTIVE = new RegExp(
  [
    'subscription (?:has )?(?:expired|ended|lapsed|been cancell?ed)',
    'subscription (?:is )?(?:not active|inactive|no longer active|cancell?ed|expired)',
    'no active (?:claude )?(?:subscription|plan)',
    '(?:subscription|pro or max|pro/max) (?:plan )?(?:is )?required',
    `(?:does not|doesn${APOS}t) have access to claude`,
    'account is on hold',
    'organization has been disabled',
    `seat type doesn${APOS}t include`
  ].join('|'),
  'i'
)

const INVALID_KEY =
  /invalid (?:x-)?api[ -]?key|invalid auth token|api key (?:is )?(?:invalid|revoked|disabled|expired)/i

const LOGGED_OUT =
  /not logged in|logged out|login (?:has )?expired|oauth token (?:has )?(?:expired|revoked)|authentication required|sign in again|please run [`'"]?(?:claude|\/login)|run \/login|\/login\b/i

const UNAUTHORIZED = /\b401\b|authentication_error|unauthori[sz]ed|authentication failed/i

const PLAN_LIMIT = new RegExp(
  [
    `you${APOS}ve hit your\\b[^.\\n]{0,60}?\\blimit`,
    `you${APOS}ve reached your\\b[^.\\n]{0,40}?\\blimit`,
    '\\b(?:usage|session|weekly|5-hour|five-hour|opus|sonnet|plan|daily)\\s+(?:weekly\\s+)?limit\\s+(?:reached|exceeded|hit)',
    'claude ai usage limit reached',
    `you${APOS}re out of (?:extra |usage )?(?:usage|credits)`,
    'out of usage\\b',
    '\\bhit your limit\\b',
    '\\bplan limit\\b',
    '\\busage limit\\b'
  ].join('|'),
  'i'
)

const OVERLOADED = /overloaded|\b529\b/i
const RATE_LIMITED = /rate[ _-]?limit|too many requests|\b429\b/i

/**
 * A reply that is only a limit line. Claude Code has printed limits with
 * `is_error: false`, so the success path checks this one strict shape. A normal
 * answer that mentions limits does not start this way and is never caught.
 */
const LIMIT_REPLY = new RegExp(
  `^\\s*(?:API Error:\\s*)?(?:you${APOS}ve hit your|you${APOS}ve reached your|claude ai usage limit reached|you${APOS}re out of (?:extra |usage )?(?:usage|credits)|(?:5-hour|five-hour|session|weekly|opus weekly|opus|sonnet|usage)\\s+limit reached)`,
  'i'
)

/** Classifies failure text. Account problems come first: signed out is never a limit. */
export function classifyClaudeFailure(
  text: string,
  now: Date = new Date(),
  localZone?: string
): ClaudeFailureKind | null {
  const problem = accountProblem(text)
  if (problem !== null) return { kind: 'account', problem }
  if (PLAN_LIMIT.test(text)) return { kind: 'limit', limit: readLimit(text, now, localZone) }
  if (OVERLOADED.test(text)) return { kind: 'transient', code: 'overloaded' }
  if (RATE_LIMITED.test(text)) return { kind: 'transient', code: 'rate_limited' }
  return null
}

export function accountProblem(text: string): ClaudeAccountProblem | null {
  if (CREDIT_LOW.test(text)) return 'credit_low'
  if (PLAN_INACTIVE.test(text)) return 'plan_inactive'
  if (INVALID_KEY.test(text)) return 'unauthorized'
  if (LOGGED_OUT.test(text)) return 'logged_out'
  if (UNAUTHORIZED.test(text)) return 'unauthorized'
  return null
}

/** True for failure text that says Claude Code is signed out (and nothing worse). */
export function looksSignedOut(text: string): boolean {
  return accountProblem(text) === 'logged_out'
}

/** True for failure text that names a plan limit or a rate limit. */
export function looksLimited(text: string): boolean {
  const failure = classifyClaudeFailure(text)
  return failure !== null && failure.kind !== 'account'
}

/** The limit when a whole (short) reply is a limit line, else null. */
export function limitReplyOnly(
  text: string,
  now: Date = new Date(),
  localZone?: string
): ClaudeLimitInfo | null {
  if (text.length > 400 || !LIMIT_REPLY.test(text)) return null
  return readLimit(text, now, localZone)
}

export function readLimit(text: string, now: Date, localZone?: string): ClaudeLimitInfo {
  const resetsAt = parseResetTime(text, now, localZone)
  return { kind: limitKind(text, resetsAt, now), resetsAt }
}

const SIX_HOURS_MS = 6 * 60 * 60_000

/** The words that name the limit: "weekly" in "You've hit your weekly limit". */
const LIMIT_NAME = new RegExp(
  `you${APOS}ve (?:hit|reached) your ([^·∙•|\\n.]{0,40}?)\\s*limit|([\\w-]+(?:\\s+weekly)?)\\s+limit reached`,
  'i'
)

function limitKind(text: string, resetsAt: Date | null, now: Date): ClaudeLimitKind {
  // The limit's own name first: a later "(uses your weekly limit)" must not make a
  // 5-hour limit weekly.
  const named = LIMIT_NAME.exec(text)
  const name = named === null ? '' : `${named[1] ?? ''}${named[2] ?? ''}`
  const fromName = kindFromWords(name)
  if (fromName !== null) return fromName
  const fromText = kindFromWords(text)
  if (fromText !== null) return fromText
  if (resetsAt === null) return 'unknown'
  return resetsAt.getTime() - now.getTime() > SIX_HOURS_MS ? 'weekly' : 'session'
}

function kindFromWords(text: string): ClaudeLimitKind | null {
  if (/session|5[- ]?hour|five[- ]?hour|\b5h\b/i.test(text)) return 'session'
  if (/week|seven[_ -]?day|\b7[- ]?day|\b7d\b/i.test(text)) return 'weekly'
  return null
}

// ---------------------------------------------------------------------------
// Reset time
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const EPOCH = /usage limit reached\s*\|\s*(\d{9,13})\b/i
const RESETS = /\bresets?\s+(?:at\s+|on\s+)?([^·∙•|\n]+)/i
const RELATIVE =
  /^in\s+(?:(\d+)\s*d(?:ays?)?\s*)?(?:(\d+)\s*h(?:ours?|rs?)?\s*)?(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i
const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/
const ZONE = /\(\s*([A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+|UTC|GMT)\s*\)/
const MONTH_DAY =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
const TIME = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?![\d:])/gi

const DAY_MS = 24 * 60 * 60_000

/**
 * When the limit resets, from an epoch ("…reached|1761901200"), a relative time
 * ("resets in 2h 15m"), an ISO stamp, or a wall time with an optional month-day and an
 * optional IANA zone in brackets ("Nov 2, 9am (America/Toronto)"). With no zone the
 * time is read in `localZone` (this computer's zone by default). A time-only reset that
 * has already passed today rolls to tomorrow; a month-day more than a day in the past
 * rolls to next year. Null when no time can be read.
 */
export function parseResetTime(text: string, now: Date, localZone?: string): Date | null {
  const epoch = EPOCH.exec(text)
  if (epoch?.[1] !== undefined) {
    const value = Number(epoch[1])
    const ms = epoch[1].length >= 13 ? value : value * 1000
    return Number.isFinite(ms) ? new Date(ms) : null
  }
  const clause = RESETS.exec(text)?.[1]?.trim()
  if (clause === undefined || clause.length === 0) return null
  const relative = RELATIVE.exec(clause)
  if (relative !== null && (relative[1] ?? relative[2] ?? relative[3]) !== undefined) {
    const days = Number(relative[1] ?? 0)
    const hours = Number(relative[2] ?? 0)
    const minutes = Number(relative[3] ?? 0)
    return new Date(now.getTime() + days * DAY_MS + hours * 3_600_000 + minutes * 60_000)
  }
  const iso = ISO.exec(clause)
  if (iso !== null) {
    const ms = Date.parse(iso[0])
    if (Number.isFinite(ms)) return new Date(ms)
  }
  const zone = validZone(ZONE.exec(clause)?.[1]) ?? validZone(localZone) ?? systemZone()
  const withoutZone = clause.replace(ZONE, ' ')
  const monthDay = MONTH_DAY.exec(withoutZone)
  const rest = monthDay === null ? withoutZone : withoutZone.replace(monthDay[0], ' ')
  const time = readTime(rest)
  if (monthDay === null && time === null) return null
  const today = wallParts(now, zone)
  const hour = time?.hour ?? 0
  const minute = time?.minute ?? 0
  if (monthDay !== null) {
    const month = MONTHS.indexOf((monthDay[1] ?? '').slice(0, 3).toLowerCase()) + 1
    const day = Number(monthDay[2])
    if (month < 1 || day < 1 || day > 31) return null
    let at = zonedToUtc(today.year, month, day, hour, minute, zone)
    if (at < now.getTime() - DAY_MS) at = zonedToUtc(today.year + 1, month, day, hour, minute, zone)
    return new Date(at)
  }
  let at = zonedToUtc(today.year, today.month, today.day, hour, minute, zone)
  if (at <= now.getTime())
    at = zonedToUtc(today.year, today.month, today.day + 1, hour, minute, zone)
  return new Date(at)
}

/** "7:30pm", "9am", "19:30". A bare number with neither a colon nor am/pm is not a time. */
function readTime(text: string): { hour: number; minute: number } | null {
  TIME.lastIndex = 0
  for (let match = TIME.exec(text); match !== null; match = TIME.exec(text)) {
    const meridiem = match[3]?.toLowerCase().replace(/\./g, '') ?? null
    if (match[2] === undefined && meridiem === null) continue
    let hour = Number(match[1])
    const minute = Number(match[2] ?? 0)
    if (minute > 59) continue
    if (meridiem !== null) {
      if (hour < 1 || hour > 12) continue
      hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0)
    } else if (hour > 23) {
      continue
    }
    return { hour, minute }
  }
  return null
}

function validZone(zone: string | undefined): string | null {
  if (zone === undefined || zone.length === 0) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return null
  }
}

function systemZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

interface WallParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallParts(at: Date, zone: string): WallParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(at)
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second')
  }
}

/** The zone's offset from UTC at an instant, in ms (Toronto in winter: -5 h). */
function zoneOffsetMs(zone: string, utcMs: number): number {
  const wall = wallParts(new Date(utcMs), zone)
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/** The instant a wall time happens in a zone. Day overflow (32nd) rolls into the next month. */
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const first = guess - zoneOffsetMs(zone, guess)
  return guess - zoneOffsetMs(zone, first)
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * "today at 7:30 PM", "tomorrow at 9:00 AM", "Sunday, Nov 2 at 9:00 AM". Read in
 * this computer's zone (or `zone`), because that is the clock the user looks at.
 */
export function describeResetTime(resetsAt: Date, now: Date, zone?: string): string {
  const tz = validZone(zone) ?? systemZone()
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit'
  }).format(resetsAt)
  const then = wallParts(resetsAt, tz)
  const today = wallParts(now, tz)
  const dayIndex = (wall: WallParts): number =>
    Date.UTC(wall.year, wall.month - 1, wall.day) / DAY_MS
  const days = dayIndex(then) - dayIndex(today)
  if (days <= 0) return `today at ${time}`
  if (days === 1) return `tomorrow at ${time}`
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  }).format(resetsAt)
  return `${date} at ${time}`
}

/** "Claude's weekly limit", "Claude's 5-hour session limit", "Claude's usage limit". */
export function limitName(kind: ClaudeLimitKind): string {
  if (kind === 'weekly') return 'weekly Claude usage limit'
  if (kind === 'session') return '5-hour Claude usage limit'
  return 'Claude usage limit'
}
