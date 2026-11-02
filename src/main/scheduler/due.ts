import { isIntervalDays, isPageStatus } from '@shared/domain'
import type { FixFollowUpInput } from '@shared/domain'
import { formatInstant, parseClockTime, parseInstant } from './clock-time'
import { ScheduleError } from './errors'
import { FIX_RECHECK_RULES, followUpRawAt } from './follow-up'
import { SPREAD_BATCH_GAP_MS, SPREAD_BATCH_SIZE } from './intervals'
import { addLocalDays, assertTimeZone, dailyCheckOnDay, localDateKey } from './local-time'
import { intervalElapsedAt, inQuiet, quietEnds, releaseInstant } from './release'
import type {
  AppSchedule,
  DuePage,
  DueReason,
  ProjectSchedule,
  SchedulePlan,
  ScheduledMarketInput,
  ScheduledPageInput,
  ScheduledProjectInput,
  TopicBatchInput
} from './types'

export interface PlanScheduleInput {
  app: AppSchedule
  projects: readonly ScheduledProjectInput[]
  pages: readonly ScheduledPageInput[]
  followUps?: readonly FixFollowUpInput[]
  topicBatches?: readonly TopicBatchInput[]
}

interface MarketSlot {
  marketId: string
  /** Instant the interval (or first check) elapsed, before gates. */
  rawAt: number
  /** When it may run. */
  at: number
  catchUp: boolean
}

interface PageRow {
  page: ScheduledPageInput
  project: ScheduledProjectInput
  reason: DueReason
  marketIds: string[]
  dueMs: number
  promptIds: readonly string[] | null
  followUpId: string | null
  topicBatchId?: string
}

/**
 * FR-7.1, SCH-3, SCH-9, SCH-10, decision 8.
 * A tracked page on an unpaused, unarchived project is due when its next
 * check falls on the local today or earlier. A page still setting up is due
 * on that same rule only once it has a prompt set. A market that has never
 * been checked is due today unless a stagger hold keeps it. A paused project
 * is not due, and its
 * `nextCheckAt` is still the next check after resume (SCH-9). An archived
 * project is never due (FR-10.8). `nowMs` and
 * `timeZone` are injected. `timeZone`
 * is the computer's local zone. It is not stored on the project.
 * This function does not read `Date.now`.
 */
export function planSchedule(
  input: PlanScheduleInput,
  nowMs: number,
  timeZone: string
): SchedulePlan {
  assertNow(nowMs)
  assertTimeZone(timeZone)
  validateApp(input.app)
  const projects = indexProjects(input.projects)
  const pages = validatePages(input.pages, projects)
  const rows: PageRow[] = []
  for (const page of pages) {
    const project = projects.get(page.projectId)
    if (project === undefined) throw new ScheduleError(`No schedule for project ${page.projectId}`)
    const scheduled = scheduledRow(page, project, input.app, nowMs, timeZone)
    if (scheduled !== null) rows.push(scheduled)
  }
  for (const fix of input.followUps ?? []) {
    rows.push(...followUpRows(fix, pages, projects, input.app, nowMs, timeZone))
  }
  for (const batch of input.topicBatches ?? []) {
    rows.push(...topicBatchRows(batch, pages, projects, input.app, nowMs, timeZone))
  }
  const spreadRows = applySpread(rows, nowMs, timeZone)
  const day = localDateKey(nowMs, timeZone)
  const duePages = spreadRows
    .filter((row) => localDateKey(row.dueMs, timeZone) <= day)
    .map((row) => toDuePage(row))
  duePages.sort(compareDue)
  const plannedProjects = input.projects.map((project) =>
    fillProject(project, pages, input.followUps ?? [], input.app, spreadRows, nowMs, timeZone)
  )
  return { due: { day, pages: duePages }, projects: plannedProjects }
}

/**
 * FR-7.5. Pause stops scheduled checks only. Check now still runs for a paused
 * page or project. Archived projects and pages that are not tracked or paused
 * do not run.
 */
export function checkNowMarketIds(
  page: ScheduledPageInput,
  project: ScheduledProjectInput
):
  { ok: true; marketIds: readonly string[] } | { ok: false; reason: 'not_scheduled' | 'archived' } {
  if (project.archived) return { ok: false, reason: 'archived' }
  if (page.status !== 'tracked' && page.status !== 'paused') {
    return { ok: false, reason: 'not_scheduled' }
  }
  return { ok: true, marketIds: page.markets.map((market) => market.marketId) }
}

function scheduledRow(
  page: ScheduledPageInput,
  project: ScheduledProjectInput,
  app: AppSchedule,
  nowMs: number,
  timeZone: string
): PageRow | null {
  if (project.archived || project.paused || !isOpenForSchedule(page)) return null
  const slots = scheduledMarkets(page)
    .map((market) => marketSlot(market, page.intervalDays, project, app, nowMs, timeZone))
    .filter((slot) => localDateKey(slot.at, timeZone) <= localDateKey(nowMs, timeZone))
  if (slots.length === 0) return null
  const dueMs = Math.min(...slots.map((slot) => slot.at))
  return {
    page,
    project,
    reason: slots.some((slot) => slot.catchUp) ? 'catch_up' : 'scheduled',
    marketIds: slots.map((slot) => slot.marketId).sort(),
    dueMs,
    promptIds: null,
    followUpId: null
  }
}

function marketSlot(
  market: ScheduledMarketInput,
  intervalDays: number,
  project: ScheduledProjectInput,
  app: AppSchedule,
  nowMs: number,
  timeZone: string
): MarketSlot {
  const rawAt = rawElapsed(market, intervalDays, nowMs, project, timeZone)
  const gated = gate(rawAt, project, app, nowMs, timeZone)
  return { marketId: market.marketId, rawAt, at: gated.at, catchUp: gated.catchUp }
}

function rawElapsed(
  market: ScheduledMarketInput,
  intervalDays: number,
  nowMs: number,
  project: ScheduledProjectInput,
  timeZone: string
): number {
  if (market.lastCheckedAt === null) {
    if (market.firstCheckNotBefore === null) return nowMs
    return parseInstant(market.firstCheckNotBefore, 'first check')
  }
  return intervalElapsedAt(
    parseInstant(market.lastCheckedAt, 'last check'),
    intervalDays,
    project,
    timeZone
  )
}

/**
 * Catch-up runs only when both the app and the project allow it (SCH-1, SCH-9).
 * A missed slot then runs on wake, outside quiet hours, even before today's
 * daily check time. Otherwise it waits for today's daily check time.
 */
function gate(
  rawAt: number,
  project: ScheduledProjectInput,
  app: AppSchedule,
  nowMs: number,
  timeZone: string
): { at: number; catchUp: boolean } {
  const firstSlot = releaseInstant(rawAt, project, timeZone)
  const today = localDateKey(nowMs, timeZone)
  const catchUpOn = app.catchUpAfterSleep && project.catchUp
  if (nowMs < firstSlot) return { at: firstSlot, catchUp: false }
  const slotDay = localDateKey(firstSlot, timeZone)
  if (slotDay < today && !catchUpOn) {
    return {
      at: releaseInstant(
        dailyCheckOnDay(
          nowMs,
          timeZone,
          parseClockTime(project.dailyCheckTime, 'daily check time')
        ),
        project,
        timeZone
      ),
      catchUp: false
    }
  }
  if (inQuiet(nowMs, project, timeZone)) {
    return { at: quietEnds(nowMs, project, timeZone), catchUp: slotDay < today && catchUpOn }
  }
  if (slotDay < today && catchUpOn) return { at: firstSlot, catchUp: true }
  return { at: firstSlot, catchUp: false }
}

function followUpRows(
  fix: FixFollowUpInput,
  pages: readonly ScheduledPageInput[],
  projects: ReadonlyMap<string, ScheduledProjectInput>,
  app: AppSchedule,
  nowMs: number,
  timeZone: string
): PageRow[] {
  validateFix(fix)
  const project = projects.get(fix.projectId)
  if (project === undefined) throw new ScheduleError(`No schedule for project ${fix.projectId}`)
  if (project.archived || project.paused) return []
  const page = pages.find((item) => item.pageId === fix.pageId && item.projectId === fix.projectId)
  if (page === undefined) throw new ScheduleError(`No page ${fix.pageId} for follow-up ${fix.id}`)
  if (page.status !== 'tracked') return []
  const today = localDateKey(nowMs, timeZone)
  const marketIds: string[] = []
  let dueMs = Number.POSITIVE_INFINITY
  for (const marketId of fix.marketIds) {
    const market = page.markets.find((item) => item.marketId === marketId)
    if (market === undefined)
      throw new ScheduleError(`Page ${page.pageId} has no market ${marketId}`)
    const rawAt = followUpRawAt(fix, page, market, project, timeZone)
    const gated = gate(rawAt, project, app, nowMs, timeZone)
    if (localDateKey(gated.at, timeZone) > today) continue
    marketIds.push(marketId)
    dueMs = Math.min(dueMs, gated.at)
  }
  if (marketIds.length === 0) return []
  return [
    {
      page,
      project,
      reason: 'follow_up',
      marketIds: marketIds.sort(),
      dueMs,
      promptIds: fix.promptIds,
      followUpId: fix.id
    }
  ]
}

/**
 * SCH-9. Batches of {@link SPREAD_BATCH_SIZE} start at the project check time,
 * then every {@link SPREAD_BATCH_GAP_MS}. A slot inside quiet hours moves to
 * when they end. A slot that leaves the local day restarts at the next day's
 * check time. Follow-ups keep their own time.
 */
function applySpread(rows: readonly PageRow[], nowMs: number, timeZone: string): PageRow[] {
  const groups = new Map<string, PageRow[]>()
  const untouched: PageRow[] = []
  for (const row of rows) {
    if (
      !row.project.spreadAcrossDay ||
      row.reason === 'follow_up' ||
      row.topicBatchId !== undefined
    ) {
      untouched.push(row)
      continue
    }
    const list = groups.get(row.project.projectId) ?? []
    list.push(row)
    groups.set(row.project.projectId, list)
  }
  const shifted: PageRow[] = []
  for (const group of groups.values()) {
    const project = group[0]?.project
    if (project === undefined) continue
    group.sort(compareRows)
    const slots = spreadSlots(project, group.length, nowMs, timeZone)
    group.forEach((row, index) => {
      const slot = slots[index]
      if (slot === undefined) return
      shifted.push({ ...row, dueMs: Math.max(row.dueMs, slot) })
    })
  }
  return [...untouched, ...shifted]
}

export function spreadSlots(
  project: ScheduledProjectInput,
  count: number,
  nowMs: number,
  timeZone: string
): number[] {
  const minute = parseClockTime(project.dailyCheckTime, 'daily check time')
  let origin = legalStart(dailyCheckOnDay(nowMs, timeZone, minute), project, timeZone)
  const slots: number[] = []
  let next = origin
  let batchCount = 0
  for (let index = 0; index < count; index += 1) {
    if (batchCount === SPREAD_BATCH_SIZE) {
      const advanced = legalStart(next + SPREAD_BATCH_GAP_MS, project, timeZone)
      if (localDateKey(advanced, timeZone) !== localDateKey(origin, timeZone)) {
        const nextCheck = addLocalDays(dailyCheckOnDay(origin, timeZone, minute), timeZone, 1)
        origin = legalStart(nextCheck, project, timeZone)
        next = origin
      } else {
        next = advanced
      }
      batchCount = 0
    }
    slots.push(next)
    batchCount += 1
  }
  return slots
}

function legalStart(at: number, project: ScheduledProjectInput, timeZone: string): number {
  if (!inQuiet(at, project, timeZone)) return at
  return quietEnds(at, project, timeZone)
}

function fillProject(
  project: ScheduledProjectInput,
  pages: readonly ScheduledPageInput[],
  followUps: readonly FixFollowUpInput[],
  app: AppSchedule,
  rows: readonly PageRow[],
  nowMs: number,
  timeZone: string
): ProjectSchedule {
  if (project.archived) return publishProject(project, null, 0)
  const today = localDateKey(nowMs, timeZone)
  let soonest: number | null = null
  const consider = (at: number): void => {
    if (soonest === null || at < soonest) soonest = at
  }
  for (const page of pages) {
    if (page.projectId !== project.projectId || !isOpenForSchedule(page)) continue
    for (const market of scheduledMarkets(page)) {
      const onDueRow = rows.some(
        (row) =>
          row.reason !== 'follow_up' &&
          row.topicBatchId === undefined &&
          row.page.pageId === page.pageId &&
          row.page.projectId === page.projectId &&
          row.marketIds.includes(market.marketId)
      )
      if (onDueRow) continue
      const rawAt = rawElapsed(market, page.intervalDays, nowMs, project, timeZone)
      consider(gate(rawAt, project, app, nowMs, timeZone).at)
    }
  }
  for (const row of rows) {
    if (row.project.projectId === project.projectId) consider(row.dueMs)
  }
  for (const fix of followUps) {
    if (fix.projectId !== project.projectId) continue
    const page = pages.find(
      (item) => item.pageId === fix.pageId && item.projectId === project.projectId
    )
    if (page === undefined || page.status !== 'tracked') continue
    for (const marketId of fix.marketIds) {
      const market = page.markets.find((item) => item.marketId === marketId)
      if (market === undefined) continue
      consider(
        gate(followUpRawAt(fix, page, market, project, timeZone), project, app, nowMs, timeZone).at
      )
    }
  }
  const dueIds = new Set<string>()
  for (const row of rows) {
    if (row.project.projectId !== project.projectId) continue
    if (localDateKey(row.dueMs, timeZone) <= today) dueIds.add(row.page.pageId)
  }
  return publishProject(
    project,
    soonest === null ? null : formatInstant(soonest),
    project.paused ? 0 : dueIds.size
  )
}

function publishProject(
  project: ScheduledProjectInput,
  nextCheckAt: string | null,
  pagesDueToday: number
): ProjectSchedule {
  return {
    projectId: project.projectId,
    defaultIntervalDays: project.defaultIntervalDays,
    dailyCheckTime: project.dailyCheckTime,
    quietFrom: project.quietFrom,
    quietUntil: project.quietUntil,
    spreadAcrossDay: project.spreadAcrossDay,
    catchUp: project.catchUp,
    paused: project.paused,
    nextCheckAt,
    pagesDueToday
  }
}

/**
 * Tracked pages are on the schedule. A page still setting up is on it only
 * once a prompt set exists, so startup does not queue a half-set-up page.
 */
function isOpenForSchedule(page: ScheduledPageInput): boolean {
  // A topic with no question yet has nothing to search.
  if (page.noQuestions === true) return false
  if (page.status === 'tracked') return true
  return page.status === 'setting_up' && page.promptSetVersion !== null
}

/**
 * The markets the schedule may run. A page added on its own waits for the
 * user's "Start first check" (or the project's "check automatically when
 * ready"), so its never-checked markets are left out until then.
 */
function scheduledMarkets(page: ScheduledPageInput): readonly ScheduledMarketInput[] {
  if (page.firstCheckWaits !== true) return page.markets
  return page.markets.filter((market) => market.lastCheckedAt !== null)
}

function toDuePage(row: PageRow): DuePage {
  const page: DuePage = {
    projectId: row.page.projectId,
    pageId: row.page.pageId,
    label: row.page.label,
    title: row.page.title,
    url: row.page.url,
    marketIds: row.marketIds,
    dueAt: formatInstant(row.dueMs),
    intervalDays: row.page.intervalDays,
    reason: row.reason,
    promptIds: row.reason === 'follow_up' || row.topicBatchId !== undefined ? row.promptIds : null
  }
  if (row.reason === 'follow_up' && row.followUpId !== null) page.fixId = row.followUpId
  if (row.topicBatchId !== undefined) page.topicBatchId = row.topicBatchId
  return page
}

/**
 * A staggered topic batch whose day has come, after quiet hours. Paused and
 * archived projects and topics that are not tracked run nothing; markets the
 * topic no longer has are left out.
 */
function topicBatchRows(
  batch: TopicBatchInput,
  pages: readonly ScheduledPageInput[],
  projects: ReadonlyMap<string, ScheduledProjectInput>,
  app: AppSchedule,
  nowMs: number,
  timeZone: string
): PageRow[] {
  const project = projects.get(batch.projectId)
  if (project === undefined || project.archived || project.paused) return []
  const page = pages.find(
    (item) => item.pageId === batch.pageId && item.projectId === batch.projectId
  )
  if (page === undefined || page.status !== 'tracked' || batch.promptIds.length === 0) return []
  const marketIds = batch.marketIds.filter((id) =>
    page.markets.some((market) => market.marketId === id)
  )
  if (marketIds.length === 0) return []
  const gated = gate(parseInstant(batch.dueAt, 'dueAt'), project, app, nowMs, timeZone)
  if (localDateKey(gated.at, timeZone) > localDateKey(nowMs, timeZone)) return []
  return [
    {
      page,
      project,
      reason: 'scheduled',
      marketIds: [...marketIds].sort(),
      dueMs: gated.at,
      promptIds: batch.promptIds,
      followUpId: null,
      topicBatchId: batch.id
    }
  ]
}

function compareDue(a: DuePage, b: DuePage): number {
  if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1
  if (a.projectId !== b.projectId) return a.projectId < b.projectId ? -1 : 1
  if (a.pageId !== b.pageId) return a.pageId < b.pageId ? -1 : 1
  if (a.reason !== b.reason) return a.reason < b.reason ? -1 : 1
  return 0
}

function compareRows(a: PageRow, b: PageRow): number {
  if (a.dueMs !== b.dueMs) return a.dueMs - b.dueMs
  if (a.page.pageId !== b.page.pageId) return a.page.pageId < b.page.pageId ? -1 : 1
  if (a.reason !== b.reason) return a.reason < b.reason ? -1 : 1
  return 0
}

function indexProjects(
  projects: readonly ScheduledProjectInput[]
): Map<string, ScheduledProjectInput> {
  const map = new Map<string, ScheduledProjectInput>()
  for (const project of projects) {
    validateProject(project)
    if (map.has(project.projectId))
      throw new ScheduleError(`Duplicate project schedule: ${project.projectId}`)
    map.set(project.projectId, project)
  }
  return map
}

function validatePages(
  pages: readonly ScheduledPageInput[],
  projects: ReadonlyMap<string, ScheduledProjectInput>
): readonly ScheduledPageInput[] {
  const seen = new Set<string>()
  for (const page of pages) {
    if (page.pageId.length === 0 || page.projectId.length === 0) {
      throw new ScheduleError('Page id and project id are required')
    }
    const key = `${page.projectId}\0${page.pageId}`
    if (seen.has(key)) throw new ScheduleError(`Duplicate page ${page.pageId}`)
    seen.add(key)
    if (!projects.has(page.projectId))
      throw new ScheduleError(`No schedule for project ${page.projectId}`)
    if (!isPageStatus(page.status)) throw new ScheduleError('Invalid page status')
    if (
      page.promptSetVersion !== null &&
      (!Number.isInteger(page.promptSetVersion) || page.promptSetVersion < 1)
    ) {
      throw new ScheduleError('Invalid prompt set version')
    }
    if (!isIntervalDays(page.intervalDays)) throw new ScheduleError('Invalid page interval')
    if (page.url !== null && page.url.length === 0) throw new ScheduleError('Page URL is empty')
    const markets = new Set<string>()
    for (const market of page.markets) {
      if (market.marketId.length === 0) throw new ScheduleError('Market id is empty')
      if (markets.has(market.marketId)) {
        throw new ScheduleError(`Duplicate market ${market.marketId} on ${page.pageId}`)
      }
      markets.add(market.marketId)
      if (market.lastCheckedAt !== null) parseInstant(market.lastCheckedAt, 'last check')
      if (market.firstCheckNotBefore !== null)
        parseInstant(market.firstCheckNotBefore, 'first check')
    }
  }
  return pages
}

function validateProject(project: ScheduledProjectInput): void {
  if (project.projectId.length === 0) throw new ScheduleError('Project id is empty')
  if (typeof project.archived !== 'boolean') throw new ScheduleError('archived must be a boolean')
  if (!isIntervalDays(project.defaultIntervalDays)) {
    throw new ScheduleError('Invalid project default interval')
  }
  parseClockTime(project.dailyCheckTime, 'daily check time')
  if ((project.quietFrom === null) !== (project.quietUntil === null)) {
    throw new ScheduleError('Quiet hours need both a start and an end, or neither')
  }
  if (project.quietFrom !== null && project.quietUntil !== null) {
    parseClockTime(project.quietFrom, 'quiet hours start')
    parseClockTime(project.quietUntil, 'quiet hours end')
  }
  if (!Number.isInteger(project.pagesDueToday) || project.pagesDueToday < 0) {
    throw new ScheduleError('pagesDueToday must be a non-negative integer')
  }
}

function validateApp(app: AppSchedule): void {
  parseClockTime(app.dailyCheckTime, 'app daily check time')
}

function validateFix(fix: FixFollowUpInput): void {
  if (fix.id.length === 0) throw new ScheduleError('Follow-up id is empty')
  if (!FIX_RECHECK_RULES.some((rule) => rule === fix.rule)) {
    throw new ScheduleError('Invalid follow-up rule')
  }
  parseInstant(fix.goLiveAt, 'go-live')
  if (fix.promptIds.length === 0) throw new ScheduleError('A follow-up needs at least one prompt')
  if (fix.marketIds.length === 0) throw new ScheduleError('A follow-up needs at least one market')
  const seen = new Set<string>()
  for (const marketId of fix.marketIds) {
    if (marketId.length === 0) throw new ScheduleError('Follow-up market id is empty')
    if (seen.has(marketId)) throw new ScheduleError(`Duplicate follow-up market ${marketId}`)
    seen.add(marketId)
  }
  for (const promptId of fix.promptIds) {
    if (promptId.length === 0) throw new ScheduleError('Follow-up prompt id is empty')
  }
}

function assertNow(nowMs: number): void {
  if (!Number.isFinite(nowMs)) throw new ScheduleError('Clock time must be a finite number')
}
