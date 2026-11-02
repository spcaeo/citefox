import {
  SMTP_PRESETS,
  type EmailAccount,
  type EmailAccountUse,
  type IntervalDays,
  type SmtpProvider,
  type SmtpSecurity
} from '@shared/domain'
import type { SaveEmailAccountRequest } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { guideFor, type ProviderGuide } from './guides'
import { errorText } from '../components/errorText'
import { formatClock, formatMoment } from '../utils/dates'

/**
 * FR-23.3. Shown when security is `none`.
 * The mock-up says the password is sent unencrypted. The requirement also
 * names the mail, so both are in this sentence.
 */
export const UNENCRYPTED_MAIL_WARNING =
  'Not recommended: mail and the password are sent unencrypted.'

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface Explained {
  reason: string
  nextStep: string | null
}

export function explainAlertsError(error: unknown, secret = ''): Explained {
  return {
    reason: errorText(error, 'Could not load schedule and alerts.', { secret }),
    nextStep: null
  }
}

/** FR-23.3. Null unless mail would go out with no TLS. */
export function securityWarning(security: SmtpSecurity): string | null {
  return security === 'none' ? UNENCRYPTED_MAIL_WARNING : null
}

export {
  SECURITY_OPTIONS,
  guideFor,
  providerGuides,
  providerSummary,
  securityLabel,
  type ProviderGuide,
  type ProviderStep
} from './guides'
/**
 * Screen row. `usedFor` here is the sentence this screen already shows.
 * {@link EmailAccount.usedFor} is the contract list of projects and schedules.
 */
export interface EmailAccountRow extends Omit<EmailAccount, 'usedFor'> {
  usedFor: string | null
  /** The projects and live schedules behind `usedFor`. Absent on a row just saved. */
  uses?: readonly EmailAccountUse[]
}

/** "Acme Clinics client reports, Example Co", or null when nothing uses the account. */
export function usesSentence(uses: readonly EmailAccountUse[]): string | null {
  if (uses.length === 0) return null
  return uses.map((use) => use.label).join(', ')
}

export interface AccountDraft {
  id: string | null
  provider: SmtpProvider
  fromName: string
  fromAddress: string
  replyTo: string
  host: string
  port: string
  security: SmtpSecurity
  username: string
  /** Write-only. Empty on an edit keeps the keychain password. Never logged. */
  password: string
  isDefault: boolean
  usedFor: string | null
}

export interface AccountIssues {
  fromName?: string
  fromAddress?: string
  replyTo?: string
  host?: string
  port?: string
  username?: string
  password?: string
}

export function emptyAccountDraft(provider: SmtpProvider = 'gmail'): AccountDraft {
  const preset = SMTP_PRESETS.find((item) => item.provider === provider)
  const guide = guideFor(provider)
  return {
    id: null,
    provider,
    fromName: 'CiteFox reports',
    fromAddress: '',
    replyTo: '',
    host: preset?.host ?? '',
    port: preset ? String(preset.port) : '587',
    security: preset?.security ?? 'starttls',
    username: guide.fixedUsername ?? '',
    password: '',
    isDefault: false,
    usedFor: null
  }
}

export function draftFromAccount(account: EmailAccountRow): AccountDraft {
  return {
    id: account.id,
    provider: account.provider,
    fromName: account.fromName,
    fromAddress: account.fromAddress,
    replyTo: account.replyTo ?? '',
    host: account.host,
    port: String(account.port),
    security: account.security,
    username: account.username,
    password: '',
    isDefault: account.isDefault,
    usedFor: account.usedFor
  }
}

/** A provider button starts a new account and keeps the from fields already typed. */
export function draftForProvider(
  provider: SmtpProvider,
  kept: Pick<AccountDraft, 'fromName' | 'fromAddress' | 'replyTo'>
): AccountDraft {
  return {
    ...emptyAccountDraft(provider),
    fromName: kept.fromName,
    fromAddress: kept.fromAddress,
    replyTo: kept.replyTo
  }
}

export function passwordHint(guide: ProviderGuide, editing: boolean): string {
  const tail = editing
    ? 'Saved in your keychain; leave blank to keep it.'
    : 'Saved in your system keychain.'
  return `${guide.passHint} ${tail}`
}

export function connectionSubtitle(draft: AccountDraft): string {
  const guide = guideFor(draft.provider)
  if (draft.id === null) {
    return `New account: ${guide.name}. Prefilled from the provider; check each field.`
  }
  if (draft.usedFor) {
    return `Editing ${guide.shortName} · ${draft.fromAddress}, used for ${draft.usedFor}.`
  }
  if (draft.isDefault) {
    return `Editing your default account, ${guide.shortName} · ${draft.fromAddress}.`
  }
  return `Editing ${guide.shortName} · ${draft.fromAddress}.`
}

export function accountIssues(draft: AccountDraft): AccountIssues {
  const issues: AccountIssues = {}
  if (draft.fromName.trim().length === 0) issues.fromName = 'Enter a from name.'
  if (!EMAIL.test(draft.fromAddress.trim())) issues.fromAddress = 'Enter an email address.'
  if (draft.replyTo.trim().length > 0 && !EMAIL.test(draft.replyTo.trim())) {
    issues.replyTo = 'Enter an email address, or leave reply-to blank.'
  }
  if (draft.host.trim().length === 0) issues.host = 'Enter the SMTP host.'
  if (!validPort(draft.port)) issues.port = 'Enter a port from 1 to 65535.'
  if (draft.username.trim().length === 0) issues.username = 'Enter the username.'
  if (draft.id === null && draft.password.length === 0) {
    issues.password = 'Enter the password or API key. It is saved in your system keychain.'
  }
  return issues
}

export function hasAccountIssues(issues: AccountIssues): boolean {
  return Object.keys(issues).length > 0
}

export function testRecipientIssue(value: string): string | null {
  if (!EMAIL.test(value.trim())) return 'Enter the address that should receive the test.'
  return null
}

export function toSaveRequest(draft: AccountDraft): SaveEmailAccountRequest {
  return {
    id: draft.id,
    provider: draft.provider,
    fromName: draft.fromName.trim(),
    fromAddress: draft.fromAddress.trim(),
    replyTo: draft.replyTo.trim().length > 0 ? draft.replyTo.trim() : null,
    host: draft.host.trim(),
    port: Number(draft.port),
    security: draft.security,
    username: draft.username.trim(),
    password: draft.password.length > 0 ? draft.password : null,
    isDefault: draft.isDefault
  }
}

function validPort(value: string): boolean {
  if (!/^\d+$/.test(value.trim())) return false
  const port = Number(value)
  return port >= 1 && port <= 65535
}

export function lastTestLabel(
  account: Pick<EmailAccount, 'lastTestAt' | 'lastTestOk'>,
  timeZone: string
): string {
  if (account.lastTestAt === null || account.lastTestOk === null) return 'Not tested yet'
  const when = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone
  }).format(new Date(account.lastTestAt))
  return account.lastTestOk ? `Works · ${when}` : `Failed · ${when}`
}

export function providerRowName(provider: SmtpProvider): string {
  return guideFor(provider).name
}

/**
 * A saved wall-clock time (`HH:MM`) as the computer shows times: "9:00 AM" on a
 * 12-hour clock, "09:00" on a 24-hour one. Anything else comes back as it is.
 */
export function wallClock(time: string, locale?: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) return time
  const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]))
  return formatClock(date.toISOString(), locale ? { locale } : {})
}

export function spreadHint(pagesDueToday: number, dailyCheckTime: string): string {
  return `Runs today's ${pluralize(pagesDueToday, 'due page')} in small batches from ${wallClock(dailyCheckTime)} instead of all at once, so other projects and your search rate limit get room.`
}

export interface NextCheckInput {
  paused: boolean
  intervalDays: IntervalDays
  nextCheckAt: string | null
  pagesDueToday: number
  now: Date
  timeZone: string
}

/**
 * The next-check line in parts, so the due count can be a button:
 * `{ when: 'Today 09:00', due: 14, tail: '' }`, or `{ text }` when nothing is scheduled.
 */
export type NextCheckParts = { text: string } | { when: string; due: number; tail: string }

export function nextCheckParts(input: NextCheckInput): NextCheckParts {
  if (input.paused) return { text: 'None while this project is paused' }
  if (input.nextCheckAt === null) return { text: 'No check is scheduled yet' }
  return {
    when: whenLabel(input.nextCheckAt, input.now, input.timeZone),
    due: input.pagesDueToday,
    tail: input.intervalDays === 30 ? ', then each page 30 days after its last check' : ''
  }
}

export function nextCheckLabel(input: NextCheckInput): string {
  const parts = nextCheckParts(input)
  if ('text' in parts) return parts.text
  const due = `${parts.due.toLocaleString('en-US')} ${parts.due === 1 ? 'page' : 'pages'} due`
  return `${parts.when} · ${due}${parts.tail}`
}

export function clockIssue(value: string, label: string): string | null {
  if (!CLOCK.test(value.trim())) return `Enter ${label} as HH:MM.`
  return null
}

/** Both blank turns quiet hours off. One side alone is incomplete. */
export function quietIssue(from: string, until: string): string | null {
  const start = from.trim()
  const end = until.trim()
  if (start.length === 0 && end.length === 0) return null
  if (!CLOCK.test(start) || !CLOCK.test(end)) {
    return 'Set both quiet hours, or leave both blank.'
  }
  return null
}

export function emailListIssue(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return 'Enter an email address.'
  if (!EMAIL.test(trimmed)) return 'Enter an email address.'
  return null
}

/** The first address that is not an email address, as a field error; null when all are fine. */
export function emailChipsIssue(items: readonly string[]): string | null {
  if (items.length === 0) return 'Enter an email address.'
  const bad = items.find((item) => emailListIssue(item) !== null)
  return bad === undefined ? null : `“${bad}” is not an email address.`
}

/** "Today 9:00 AM" or "Oct 21, 9:00 AM", in the schedule's zone and the computer's clock style. */
function whenLabel(iso: string, now: Date, timeZone: string): string {
  if (calendarDay(iso, timeZone) === calendarDay(now.toISOString(), timeZone)) {
    return `Today ${formatClock(iso, { timeZone })}`
  }
  return formatMoment(iso, { now, timeZone })
}

function calendarDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(iso))
}

export function userTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone) return zone
  } catch {
    // Intl throws when the runtime has no locale data.
  }
  return 'UTC'
}

/** One project's re-check cadence, for the note under Re-check. */
export interface ProjectScheduleRow {
  projectId: string
  name: string
  intervalDays: number
  /** `HH:MM`, local. */
  time: string
  paused: boolean
}

const APP_WIDE_NOTE =
  'The tray app and the optional background job are app-wide, set once in App settings › General.'

export const PROJECT_NOTE_LEAD = `${APP_WIDE_NOTE} Inside them, each project runs on its own schedule: `

/** "every 14 days at 9:00 AM", "every day at 9:00 AM" or "paused": what follows a project name in the note. */
export function projectCadence(row: ProjectScheduleRow): string {
  const every = row.intervalDays === 1 ? 'every day' : `every ${row.intervalDays} days`
  return row.paused ? 'paused' : `${every} at ${wallClock(row.time)}`
}

/** FR-24 note. Lists the user's own projects; with none, only the app-wide sentence. */
export function projectScheduleNote(rows: readonly ProjectScheduleRow[]): string {
  if (rows.length === 0) return APP_WIDE_NOTE
  const parts = rows.map((row) => `${row.name} ${projectCadence(row)}`)
  return `${PROJECT_NOTE_LEAD}${parts.join(', ')}.`
}

export type DesktopPlatform = 'mac' | 'windows' | 'linux' | 'other'

/** The system the window runs on, from the renderer's user agent. */
export function platformFromUserAgent(userAgent: string): DesktopPlatform {
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'mac'
  if (/Windows/.test(userAgent)) return 'windows'
  if (/Linux|X11/.test(userAgent)) return 'linux'
  return 'other'
}

/**
 * SCH-1 hint under "Also check when CiteFox is closed": what this system
 * really gets. The job opens CiteFox hidden each hour, runs only the checks
 * and reports due then, and quits.
 */
export function closedHint(platform: DesktopPlatform): string {
  const what = 'to run due checks and send due reports every hour while CiteFox is closed'
  switch (platform) {
    case 'mac':
      return `Adds a background item to your Mac (System Settings → General → Login Items) ${what}. Turning this off removes it.`
    case 'windows':
      return `Adds a CiteFox task to Windows Task Scheduler ${what}. Turning this off removes it.`
    case 'linux':
      return `Adds a systemd user timer (or a cron entry when systemd is not available) ${what}. Turning this off removes it.`
    default:
      return `Adds a scheduled job to your system ${what}. Turning this off removes it.`
  }
}

/** The hint for the system this window runs on. */
export const CLOSED_HINT = closedHint(
  platformFromUserAgent(typeof navigator === 'undefined' ? '' : navigator.userAgent)
)

export const CATCH_UP_HINT =
  'If the computer was asleep at check time, run missed checks when it wakes (outside quiet hours).'

export const PAUSE_HINT = 'Pages, questions and history stay. Nothing runs until you turn this off.'

export const DRAFT_MODE_NOTE =
  "When a scheduled report is due, CiteFox shows a tray notification. Click it and the draft opens in your default mail app, addressed and with the file attached. Reports due while you're away wait until you click."
