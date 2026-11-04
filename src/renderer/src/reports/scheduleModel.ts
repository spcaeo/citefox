import {
  CHANGE_KINDS,
  DEFAULT_REPORT_SCHEDULE_STATUS,
  type ChangeKind,
  type DeliveryRecord,
  type ReportFormat,
  type ReportSchedule,
  type ReportScheduleListItem,
  type ReportScheduleStatus,
  type ReportScope,
  type ReportTiming,
  type ScheduledReportKind,
  type SummaryStyle,
  normalizeExportSections
} from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { REPORT_SECTION_COPY } from '@shared/report-copy'
import { REPORT_TITLES } from '@shared/report/review'
import { errorText } from '../components/errorText'
import { resultPhrase } from './schedules/utils/deliveryRows'
import { scheduledReportLabel } from './schedules/utils/readyReport'
import { formatInstant, nextMonthly, nextWeekly } from './schedules/utils/zoned'

export {
  deliveryKindLabel,
  resendAria,
  resendLabel,
  resultFacet,
  resultPhrase,
  timelineDays,
  toDeliveryRow,
  type DeliveryRow,
  type TimelineDay
} from './schedules/utils/deliveryRows'
export { formatDayHeading, formatInstant, localDayKey } from './schedules/utils/zoned'

/** The preview's To line before anyone is added: plain text, nothing to copy. */
export const NO_RECIPIENTS_YET = 'No recipients yet'

export const SCHEDULE_NOT_FOUND = 'That schedule is not on this computer.'

const NO_ACCOUNT = /no sending account/i
const NO_ACCOUNT_STEP = 'Add a sending account in Email setup, then send the test again.'

export interface Explained {
  reason: string
  nextStep: string | null
}

/** Plain text for a thrown reports or deliveries call. Strips Electron's invoke wrapper. */
export function explainReportsError(error: unknown): Explained {
  if (isReportNotFoundResult(error)) return { reason: error.message, nextStep: null }
  const stripped = errorText(error, 'Could not load scheduled reports.')
  return { reason: stripped, nextStep: NO_ACCOUNT.test(stripped) ? NO_ACCOUNT_STEP : null }
}

function isReportNotFoundResult(error: unknown): error is { code: 'not_found'; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    !(error instanceof Error) &&
    'code' in error &&
    error.code === 'not_found' &&
    'message' in error &&
    typeof error.message === 'string'
  )
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

const WEEKDAYS = [
  { day: 1 as const, label: 'Monday', short: 'Mondays', abbrev: 'Mon' },
  { day: 2 as const, label: 'Tuesday', short: 'Tuesdays', abbrev: 'Tue' },
  { day: 3 as const, label: 'Wednesday', short: 'Wednesdays', abbrev: 'Wed' },
  { day: 4 as const, label: 'Thursday', short: 'Thursdays', abbrev: 'Thu' },
  { day: 5 as const, label: 'Friday', short: 'Fridays', abbrev: 'Fri' },
  { day: 6 as const, label: 'Saturday', short: 'Saturdays', abbrev: 'Sat' },
  { day: 7 as const, label: 'Sunday', short: 'Sundays', abbrev: 'Sun' }
]

/**
 * What each stored format actually sends. The ids stay as stored (no DB change):
 * `html_link` is now the zipped interactive report folder, attached.
 */
export const FORMAT_OPTIONS: readonly { id: ReportFormat; label: string }[] = [
  { id: 'pdf', label: 'PDF report attached' },
  { id: 'excel', label: 'Excel workbook attached' },
  { id: 'csv', label: 'CSV tables (.zip) attached' },
  { id: 'html_link', label: 'Interactive HTML report (.zip) attached' },
  { id: 'summary', label: 'Email summary only, no attachment' }
]

/** Shown with the format choice. Every email carries this summary above any attachment. */
export const EMAIL_SUMMARY_NOTE =
  'Every email starts with a plain-text summary: the headline sentence, the score and its change, what changed, and the top 3 actions. The attachment comes after it.'

export const TRIGGER_OPTIONS = [
  {
    id: 'after_check' as const,
    label: 'After every check',
    desc: 'As soon as a scheduled check finishes'
  },
  { id: 'weekly' as const, label: 'Weekly', desc: 'Same day and time each week' },
  { id: 'monthly' as const, label: 'Monthly', desc: 'Same day each month' },
  {
    id: 'on_change' as const,
    label: 'When something changes',
    desc: 'Only when an event below happens'
  }
]

export const TRIGGER_FACET = TRIGGER_OPTIONS.map((item) => item.label)

export const CHANGE_OPTIONS: readonly { id: ChangeKind; label: string }[] = [
  { id: 'lost_citation', label: 'A tracked page lost a citation' },
  { id: 'gained_citation', label: 'A tracked page gained a citation' },
  { id: 'score_drop', label: 'The score dropped by more than' },
  { id: 'check_failed', label: 'A check failed' }
]

export interface ChangeSelection {
  lost_citation: boolean
  gained_citation: boolean
  score_drop: boolean
  check_failed: boolean
}

export interface ScheduleDraft {
  name: string
  projectId: string | null
  trigger: ReportTiming['kind']
  day: 1 | 2 | 3 | 4 | 5 | 6 | 7
  time: string
  mday: '1' | '15' | 'last'
  events: ChangeSelection
  drop: number
  format: ReportFormat
  sections: string[]
  marketIds: string[]
  recipients: string[]
  accountId: string | null
  timeZone: string
  subject: string
  summaryStyle: SummaryStyle | null
  /** The pages the report covers. `project` is the whole project. */
  scope: ReportScope
  /** The ready report it sends; null is the check summary built from `sections`. */
  report: ScheduledReportKind | null
  /** Head-to-head's rival domain; null is the top competitor. */
  rival: string | null
}

/** The whole project: every tracked page. */
export const WHOLE_PROJECT: ReportScope = { kind: 'project', ids: [] }

export interface NamedProject {
  id: string
  name: string
  status: 'active' | 'paused' | 'archived'
  clientName: string | null
}

export interface MarketOption {
  id: string
  label: string
}

export interface AccountOption {
  id: string
  label: string
  fromAddress: string
  isDefault: boolean
}

/** Form state for a stored schedule, so Save sends the same id. */
export function draftFromSchedule(item: ReportSchedule): ScheduleDraft {
  const base = emptyDraft(item.timeZone)
  const timing = item.timing
  const events = { ...base.events }
  if (timing.kind === 'on_change') {
    for (const kind of CHANGE_KINDS) events[kind] = timing.events.includes(kind)
  }
  return {
    ...base,
    name: item.name,
    projectId: item.projectId,
    trigger: timing.kind,
    day: timing.kind === 'weekly' ? timing.day : base.day,
    time: timing.kind === 'weekly' || timing.kind === 'monthly' ? timing.time : base.time,
    mday: timing.kind === 'monthly' ? timing.when : base.mday,
    events,
    drop: timing.kind === 'on_change' ? timing.scoreDropPoints : base.drop,
    format: item.format,
    sections: [...item.sections],
    marketIds: [...item.marketIds],
    recipients: [...item.recipients],
    accountId: item.accountId,
    timeZone: item.timeZone,
    subject: item.subject,
    summaryStyle: item.summaryStyle,
    scope: item.scope ? { kind: item.scope.kind, ids: [...item.scope.ids] } : WHOLE_PROJECT,
    report: item.report?.kind ?? null,
    rival: item.report?.rival ?? null
  }
}

export function emptyDraft(timeZone: string): ScheduleDraft {
  return {
    name: '',
    projectId: null,
    trigger: 'weekly',
    day: 1,
    time: '08:00',
    mday: '1',
    events: {
      lost_citation: true,
      gained_citation: false,
      score_drop: true,
      check_failed: true
    },
    drop: 10,
    format: 'pdf',
    sections: ['overview', 'reputation', 'trends'],
    marketIds: [],
    recipients: [],
    accountId: null,
    timeZone,
    subject: '{project}: AI Overview report for {date_range}',
    summaryStyle: null,
    scope: WHOLE_PROJECT,
    report: null,
    rival: null
  }
}

export function weekdayChoices(): readonly { day: ScheduleDraft['day']; label: string }[] {
  return WEEKDAYS.map((item) => ({ day: item.day, label: item.label }))
}

export function formatLabel(format: ReportFormat): string {
  return FORMAT_OPTIONS.find((item) => item.id === format)?.label ?? 'PDF report attached'
}

export function triggerLabel(kind: ReportTiming['kind']): string {
  return TRIGGER_OPTIONS.find((item) => item.id === kind)?.label ?? 'Weekly'
}

/** Report section titles for stored ids. Legacy ids map to their v2 section. */
export function sectionTitles(sections: readonly string[]): string[] {
  return normalizeExportSections(sections).map((id) => REPORT_SECTION_COPY[id].title)
}

export function sectionsLabel(format: ReportFormat, sections: readonly string[]): string {
  if (format === 'summary') return 'Headline, score, what changed and top 3 actions'
  const names = sectionTitles(sections)
  return names.length > 0 ? names.join(', ') : 'No sections'
}

export function sectionsHint(format: ReportFormat, sections: readonly string[]): string {
  if (format === 'summary') return 'No attachment; the email holds the summary'
  const names = sectionTitles(sections)
  const listed = names.length > 0 ? names.join(', ') : 'none yet'
  switch (format) {
    case 'excel':
      return `Sections: ${listed} (one sheet per table)`
    case 'csv':
      return `Sections: ${listed} (one file per table, zipped)`
    default:
      return `Sections: ${listed}`
  }
}

/** An all-projects schedule: one email per project. */
export const ALL_PROJECTS_LABEL = 'All my projects'

/** The Project choice for an all-projects schedule. */
export const ALL_PROJECTS_CHOICE = 'All my projects (one email each)'

export function projectDisplay(
  projectId: string | null,
  projects: readonly NamedProject[]
): { name: string; tag: string | null } {
  if (projectId === null) return { name: ALL_PROJECTS_LABEL, tag: null }
  const found = projects.find((item) => item.id === projectId)
  if (!found) return { name: projectId, tag: null }
  if (found.status === 'paused') return { name: found.name, tag: 'Paused' }
  if (found.clientName) return { name: found.name, tag: 'Client' }
  return { name: found.name, tag: null }
}

export function whenLabel(timing: ReportTiming): string {
  if (timing.kind === 'after_check') return 'After every check'
  if (timing.kind === 'weekly') {
    const day = WEEKDAYS.find((item) => item.day === timing.day)
    return `${day?.short ?? 'Mondays'} ${timing.time}`
  }
  if (timing.kind === 'monthly') {
    const when = timing.when === '15' ? '15th' : timing.when === 'last' ? 'Last day' : '1st'
    return `${when} of the month ${timing.time}`
  }
  if (timing.events.length === 1 && timing.events[0] === 'lost_citation') {
    return 'When a tracked page loses a citation'
  }
  if (timing.events.length === 0) return 'When something changes'
  return timing.events.map((event) => eventPhrase(event)).join(', ')
}

function eventPhrase(event: ChangeKind): string {
  switch (event) {
    case 'lost_citation':
      return 'A tracked page lost a citation'
    case 'gained_citation':
      return 'A tracked page gained a citation'
    case 'score_drop':
      return 'The score dropped'
    case 'check_failed':
      return 'A check failed'
  }
}

export function timingFromDraft(draft: ScheduleDraft): ReportTiming {
  if (draft.trigger === 'after_check') return { kind: 'after_check' }
  if (draft.trigger === 'weekly') return { kind: 'weekly', day: draft.day, time: draft.time }
  if (draft.trigger === 'monthly') return { kind: 'monthly', when: draft.mday, time: draft.time }
  return {
    kind: 'on_change',
    events: selectedEvents(draft.events),
    scoreDropPoints: draft.drop
  }
}

export function selectedEvents(events: ChangeSelection): ChangeKind[] {
  return CHANGE_KINDS.filter((kind) => events[kind])
}

export function draftIssues(draft: ScheduleDraft): string | null {
  if (draft.name.trim() === '') return 'Name this schedule.'
  if (draft.recipients.length === 0) return 'Add at least one recipient.'
  if (draft.report === null && draft.format !== 'summary' && draft.sections.length === 0) {
    return 'Pick at least one section, or send the email summary only.'
  }
  const bad = draft.recipients.find((address) => emailProblem(address) !== null)
  if (bad) return `${bad} is not an email address. Fix it or remove it.`
  if (draft.projectId !== null && draft.scope.kind !== 'project' && draft.scope.ids.length === 0) {
    return 'Pick what the report covers, or choose Whole project.'
  }
  if (draft.trigger === 'on_change' && selectedEvents(draft.events).length === 0) {
    return 'Pick at least one event.'
  }
  if (draft.trigger === 'on_change' && draft.events.score_drop && !(draft.drop > 0)) {
    return 'Enter how many points the score must drop.'
  }
  return null
}

/** A new schedule is active. A null account is the default sender (FR-23.5). */
export function buildSchedule(draft: ScheduleDraft, id: string, createdAt: string): ReportSchedule {
  return {
    id,
    name: draft.name.trim(),
    projectId: draft.projectId,
    timing: timingFromDraft(draft),
    format: draft.format,
    sections: draft.sections,
    marketIds: draft.marketIds,
    recipients: draft.recipients,
    accountId: draft.accountId,
    timeZone: draft.timeZone,
    subject: draft.subject,
    summaryStyle: draft.summaryStyle,
    scope:
      draft.projectId === null || draft.scope.kind === 'project'
        ? null
        : { kind: draft.scope.kind, ids: [...draft.scope.ids] },
    report:
      draft.report === null
        ? null
        : { kind: draft.report, rival: draft.report === 'rival' ? draft.rival : null },
    status: DEFAULT_REPORT_SCHEDULE_STATUS,
    createdAt
  }
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/** Why `address` cannot receive a report, or null when it looks like an email address. */
export function emailProblem(address: string): string | null {
  return EMAIL.test(address.trim()) ? null : 'Not an email address'
}

/** "Copy of Weekly client report": the name a duplicate starts with. */
export function copyName(name: string): string {
  return name.startsWith('Copy of ') ? name : `Copy of ${name}`
}

/**
 * A copy of a stored schedule as a new draft: the same settings and a new
 * name. Saving it creates a new schedule (a new id); the original is untouched.
 */
export function duplicateDraft(item: ReportSchedule): ScheduleDraft {
  const draft = draftFromSchedule(item)
  return { ...draft, name: copyName(item.name) }
}

export interface ScheduleRow {
  id: string
  name: string
  /** Null is every project. */
  projectId: string | null
  project: string
  projectTag: string | null
  formatLabel: string
  sectionsLabel: string
  when: string
  trigger: string
  recipients: readonly string[]
  next: string
  nextSort: number | null
  last: string
  lastSort: number | null
  lastFailed: boolean
  lastReason: string | null
  /** The delivery "Last result" describes. Null before the first send. */
  lastDeliveryId: string | null
  status: ReportScheduleStatus
}

export function toScheduleRow(
  item: ReportScheduleListItem,
  projects: readonly NamedProject[],
  deliveries: readonly DeliveryRecord[],
  timeZone: string
): ScheduleRow {
  const project = projectDisplay(item.projectId, projects)
  const last = latestDelivery(item.id, deliveries)
  return {
    id: item.id,
    name: item.name,
    projectId: item.projectId,
    project: project.name,
    projectTag: project.tag,
    formatLabel: formatLabel(item.format),
    sectionsLabel: scheduledReportLabel(item.report) ?? sectionsLabel(item.format, item.sections),
    when: whenLabel(item.timing),
    trigger: triggerLabel(item.timing.kind),
    recipients: item.recipients,
    next: nextSendLabel(item, timeZone),
    nextSort:
      item.status === 'paused' || item.nextSendAt === null ? null : Date.parse(item.nextSendAt),
    last: last ? resultPhrase(last, timeZone) : 'Not sent yet',
    lastSort: last ? Date.parse(last.at) : null,
    lastFailed: last?.outcome === 'failed',
    lastReason: last?.outcome === 'failed' ? last.reason : null,
    lastDeliveryId: last?.id ?? null,
    status: item.status
  }
}

export function nextSendLabel(item: ReportScheduleListItem, timeZone: string): string {
  if (item.status === 'paused') return 'Off'
  if (item.nextSendAt) return formatInstant(item.nextSendAt, timeZone)
  if (item.timing.kind === 'on_change') return 'On change'
  return 'Paused with project'
}

export function timingHint(draft: ScheduleDraft, now: Date, projectName: string | null): string {
  if (draft.trigger === 'after_check') {
    const where = projectName ? `, ${projectName}` : ''
    return `As soon as a scheduled check finishes. Next send: after the next check${where}. Paused projects send nothing.`
  }
  if (draft.trigger === 'on_change') {
    const count = selectedEvents(draft.events).length
    if (count === 0) return 'Pick at least one event.'
    return 'Checked after every check. Sends at most one email per check, listing every event that happened.'
  }
  if (draft.trigger === 'monthly') {
    const when = nextMonthly(draft.mday, draft.time, draft.timeZone, now)
    return `Same day and time each month. Next send: ${when} at ${draft.time} (${draft.timeZone}).`
  }
  const when = nextWeekly(draft.day, draft.time, draft.timeZone, now)
  return `Same day and time each week. Next send: ${when} at ${draft.time} (${draft.timeZone}).`
}

/**
 * The drawer footer: "Next send Mon Oct 26, 08:00 (Europe/London)", "Next send
 * after the next check", "Sends when something changes".
 */
export function nextSendLine(draft: ScheduleDraft, now: Date): string {
  if (draft.trigger === 'after_check') return 'Next send after the next scheduled check'
  if (draft.trigger === 'on_change') return 'Sends after a check that finds a change'
  const when =
    draft.trigger === 'monthly'
      ? nextMonthly(draft.mday, draft.time, draft.timeZone, now)
      : nextWeekly(draft.day, draft.time, draft.timeZone, now)
  return `Next send ${when}, ${draft.time} (${draft.timeZone})`
}

export interface MailPreview {
  subject: string
  from: string
  to: string
  greeting: string
  lines: readonly string[]
  source: string
  attachLabel: string
  attachFile: string
}

export function mailPreview(
  draft: ScheduleDraft,
  projectName: string,
  marketText: string,
  fromLabel: string,
  /** What the report covers in one project ("Money pages", "12 pages"). Null: the whole project. */
  scopeText: string | null = null
): MailPreview {
  const allProjects = draft.projectId === null
  const subjectProject = allProjects ? 'each project' : projectName
  const subject = draft.subject
    .split('{project}')
    .join(subjectProject)
    .split('{date_range}')
    .join('the latest check')
    .split('{market}')
    .join(marketText || '{market}')
  const picked = ['The summary is written from the latest check when CiteFox sends this report.']
  const source =
    draft.summaryStyle === 'client_friendly'
      ? 'Client-friendly summary by CiteFox AI, without jargon. Rewritten fresh before each send.'
      : draft.summaryStyle === 'standard'
        ? 'Summary written by CiteFox AI from the latest check. Rewritten fresh before each send.'
        : 'Standard summary: three lines from the latest check.'
  const attachment = attachmentFor(draft)
  return {
    subject,
    from: fromLabel,
    to: draft.recipients.length > 0 ? draft.recipients.join(', ') : NO_RECIPIENTS_YET,
    greeting: greetingLine(allProjects, projectName, marketText, scopeText),
    lines: picked,
    source,
    attachLabel: attachment.label,
    attachFile: attachment.file
  }
}

function greetingLine(
  allProjects: boolean,
  projectName: string,
  marketText: string,
  scopeText: string | null
): string {
  if (allProjects) {
    const markets = marketText ? ` (${marketText})` : ', in its default market'
    return `Each project gets its own email${markets}. Here’s the latest for that project:`
  }
  const market = marketText || 'its default market'
  const scope = scopeText ? ` · ${scopeText}` : ''
  return `Here’s the latest for ${projectName}${scope} (${market}):`
}

const ATTACHMENT_NAMES: Record<Exclude<ReportFormat, 'summary'>, string> = {
  pdf: 'The PDF report',
  excel: 'The Excel workbook',
  csv: 'A .zip of CSV tables',
  html_link: 'The interactive HTML report (.zip)'
}

function attachmentFor(draft: ScheduleDraft): { label: string; file: string } {
  if (draft.format === 'summary') return { label: 'No attachment.', file: '' }
  if (draft.report !== null) {
    const title = REPORT_TITLES[draft.report]
    return {
      label:
        draft.format === 'html_link'
          ? `The ${title} as an offline HTML file is attached when CiteFox sends it.`
          : `The ${title} PDF is attached when CiteFox sends it.`,
      file: ''
    }
  }
  return {
    label: `${ATTACHMENT_NAMES[draft.format]} is attached when CiteFox sends the report.`,
    file: ''
  }
}

export function accountLabel(accountId: string | null, accounts: readonly AccountOption[]): string {
  if (accountId === null) return 'Default sender'
  return accounts.find((item) => item.id === accountId)?.label ?? 'Default sender'
}

export function marketSummary(ids: readonly string[], markets: readonly MarketOption[]): string {
  const names = ids
    .map((id) => markets.find((item) => item.id === id)?.label)
    .filter((label): label is string => Boolean(label))
  if (names.length === 0) return ''
  return names.join(', ')
}

export function latestDelivery(
  scheduleId: string,
  deliveries: readonly DeliveryRecord[]
): DeliveryRecord | null {
  let best: DeliveryRecord | null = null
  for (const record of deliveries) {
    if (record.scheduleId !== scheduleId) continue
    if (!best || record.at > best.at) best = record
  }
  return best
}

export function onCountLine(active: number, total: number, suffix: string): string {
  return `${active} of ${total} on · ${suffix}`
}

/** Schedule list count. 1 is singular. Every other count, including 0, is plural. */
export function scheduleListCount(count: number): string {
  return pluralize(count, 'schedule')
}

export function scheduleShowingLine(shown: number, total: number, filtering: boolean): string {
  const base = `Showing ${shown} of ${scheduleListCount(total)}`
  return filtering ? `${base} · filtered` : base
}

/** A deleted schedule leaves the list. Delivery rows are a separate list and stay. */
export function withoutDeletedSchedule<T extends { id: string }>(
  rows: readonly T[],
  scheduleId: string
): T[] {
  return rows.filter((row) => row.id !== scheduleId)
}

export const DEFAULT_ON_SUFFIX = 'sending from the default account unless a schedule picks another'
