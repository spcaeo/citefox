import {
  DEFAULT_CLAUDE_CONCURRENCY,
  type IntervalDays,
  type ProjectStatus,
  type QueueState
} from '@shared/domain'
import type {
  CheckDueResult,
  PageScoreList,
  PageScoreSummary,
  ProjectSchedule,
  ProjectScoreList,
  ProjectScoreSummary,
  QueueKeyUsage,
  QueueProjectUsage,
  QueueStatus
} from '@shared/domain'
import type { ProjectRecord } from './catalog'

/** Shared SerpApi plan on the Projects mock-up. Not a project cap. */
export const SHARED_PLAN_CAP = 5250
export const ACME_KEY_ID = 'acme-key'

interface ScoreFacts {
  averageScore: number
  change: number
  searchesUsed: number
  searchCap: number
  intervalDays: IntervalDays
  dailyCheckTime: string
  dueWhenActive: number
  dedicatedKeyId: string | null
  nextAt: (now: Date) => string
}

const FACTS: Readonly<Record<string, ScoreFacts>> = {
  textbolt: {
    averageScore: 41,
    change: 6,
    searchesUsed: 1240,
    searchCap: 3000,
    intervalDays: 14,
    dailyCheckTime: '09:00',
    dueWhenActive: 14,
    dedicatedKeyId: null,
    nextAt: (now) => todayAt('09:00', now)
  },
  acme: {
    averageScore: 28,
    change: 3,
    searchesUsed: 312,
    searchCap: 1000,
    intervalDays: 30,
    dailyCheckTime: '06:00',
    dueWhenActive: 0,
    dedicatedKeyId: ACME_KEY_ID,
    nextAt: (now) => daysAheadAt(8, '06:00', now)
  },
  fieldpro: {
    averageScore: 35,
    change: -2,
    searchesUsed: 18,
    searchCap: 500,
    intervalDays: 14,
    dailyCheckTime: '09:00',
    dueWhenActive: 12,
    dedicatedKeyId: null,
    nextAt: (now) => todayAt('09:00', now)
  }
}

/**
 * SCH-9 and FR-10.8.
 * Paused keeps `nextCheckAt` and forces `pagesDueToday` to 0.
 * Archived is never due: both the time and the count are cleared.
 */
export function scheduleFor(record: ProjectRecord, now = new Date()): ProjectSchedule {
  const facts = FACTS[record.detail.id]
  const status = record.detail.status
  return {
    projectId: record.detail.id,
    defaultIntervalDays: facts?.intervalDays ?? 14,
    dailyCheckTime: facts?.dailyCheckTime ?? '09:00',
    quietFrom: null,
    quietUntil: null,
    spreadAcrossDay: false,
    catchUp: true,
    paused: status === 'paused',
    nextCheckAt: nextCheckAt(status, facts, now),
    pagesDueToday: pagesDue(status, facts)
  }
}

export function scoreFor(record: ProjectRecord, now = new Date()): ProjectScoreSummary {
  const facts = FACTS[record.detail.id]
  const schedule = scheduleFor(record, now)
  return {
    projectId: record.detail.id,
    averageScore: facts?.averageScore ?? null,
    change: facts ? facts.change : null,
    nextCheckAt: schedule.nextCheckAt,
    searchesUsed: facts?.searchesUsed ?? 0,
    searchCap: facts?.searchCap ?? null,
    pagesDueToday: schedule.pagesDueToday
  }
}

export function projectScoreList(
  records: readonly ProjectRecord[],
  now = new Date()
): ProjectScoreList {
  const projects = records.map((record) => scoreFor(record, now))
  const times = projects
    .map((project) => project.nextCheckAt)
    .filter((time): time is string => time !== null)
    .sort()
  return {
    projects,
    searchesUsed: projects.reduce((sum, project) => sum + project.searchesUsed, 0),
    nextCheckAt: times[0] ?? null
  }
}

export function pageScoreList(record: ProjectRecord, now = new Date()): PageScoreList {
  const schedule = scheduleFor(record, now)
  const pages: PageScoreSummary[] = record.pages.map((page) => ({
    pageId: page.summary.id,
    score: page.summary.score,
    change: null,
    nextCheckAt:
      record.detail.status === 'archived' || page.summary.status !== 'tracked'
        ? null
        : schedule.nextCheckAt,
    lastCheckedAt: null,
    intervalDays: page.summary.intervalDays
  }))
  return { projectId: record.detail.id, summary: scoreFor(record, now), pages }
}

export function queueFor(
  records: readonly ProjectRecord[],
  state: QueueState,
  now = new Date()
): QueueStatus {
  const schedules = records.map((record) => scheduleFor(record, now))
  const projects: QueueProjectUsage[] = records.map((record) => {
    const facts = FACTS[record.detail.id]
    return {
      projectId: record.detail.id,
      name: record.detail.name,
      used: facts?.searchesUsed ?? 0,
      cap: facts?.searchCap ?? null,
      capRule: 'pause',
      dedicatedKeyId: facts?.dedicatedKeyId ?? null,
      paused: record.detail.status === 'paused'
    }
  })
  const pagesDue = schedules.reduce((sum, schedule) => sum + schedule.pagesDueToday, 0)
  const times = schedules
    .map((schedule) => schedule.nextCheckAt)
    .filter((time): time is string => time !== null)
    .sort()
  return {
    state,
    running: 0,
    waiting: pagesDue,
    claudeConcurrency: DEFAULT_CLAUDE_CONCURRENCY,
    claudeInFlight: 0,
    trayRunning: false,
    headlessJob: false,
    nextRunAt: state === 'running' ? (times[0] ?? null) : null,
    pagesDue,
    keys: queueKeys(projects),
    projects
  }
}

/**
 * A paused project does not make this return `started: false`.
 * The whole queue does: `paused_all` and `paused_today` wait.
 * A second pass on the same local day also waits (SCH-2).
 */
export function checkDueFor(input: {
  records: readonly ProjectRecord[]
  state: QueueState
  alreadyRan: CheckDueResult | null
  now?: Date
}): CheckDueResult {
  if (input.state !== 'running') return { started: false, jobIds: [], pages: 0 }
  if (input.alreadyRan) {
    return { started: false, jobIds: input.alreadyRan.jobIds, pages: input.alreadyRan.pages }
  }
  const now = input.now ?? new Date()
  const due = input.records.filter((record) => {
    if (record.detail.status === 'paused' || record.detail.status === 'archived') return false
    return scheduleFor(record, now).pagesDueToday > 0
  })
  return {
    started: true,
    jobIds: due.map((record) => `check-${record.detail.id}`),
    pages: due.reduce((sum, record) => sum + scheduleFor(record, now).pagesDueToday, 0)
  }
}

function nextCheckAt(
  status: ProjectStatus,
  facts: ScoreFacts | undefined,
  now: Date
): string | null {
  if (status === 'archived' || !facts) return null
  return facts.nextAt(now)
}

function pagesDue(status: ProjectStatus, facts: ScoreFacts | undefined): number {
  if (status === 'archived' || status === 'paused' || !facts) return 0
  return facts.dueWhenActive
}

function queueKeys(projects: readonly QueueProjectUsage[]): QueueKeyUsage[] {
  const sharedUsed = projects
    .filter((project) => project.dedicatedKeyId === null)
    .reduce((sum, project) => sum + project.used, 0)
  const keys: QueueKeyUsage[] = []
  if (projects.some((project) => project.dedicatedKeyId === null)) {
    keys.push({
      keyId: 'shared-plan',
      name: 'My plan',
      provider: 'serpapi',
      used: sharedUsed,
      cap: SHARED_PLAN_CAP,
      planLimit: SHARED_PLAN_CAP,
      state: 'ok'
    })
  }
  for (const project of projects) {
    if (project.dedicatedKeyId === null) continue
    keys.push({
      keyId: project.dedicatedKeyId,
      name: `${project.name} (client)`,
      provider: 'serpapi',
      used: project.used,
      cap: project.cap,
      planLimit: project.cap,
      state: 'ok'
    })
  }
  return keys
}

export function localInstant(year: number, month: number, day: number, hhmm: string): string {
  const [hour, minute] = hhmm.split(':').map((part) => Number(part))
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString()
}

export function todayAt(hhmm: string, now: Date): string {
  return localInstant(now.getFullYear(), now.getMonth() + 1, now.getDate(), hhmm)
}

/** `days` after today at `hhmm`, so a later check never slides into the past. */
export function daysAheadAt(days: number, hhmm: string, now: Date): string {
  return localInstant(now.getFullYear(), now.getMonth() + 1, now.getDate() + days, hhmm)
}

export function localDay(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
