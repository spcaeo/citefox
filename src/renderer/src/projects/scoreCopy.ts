import {
  intervalLabel,
  type CheckDueResult,
  type ProjectSchedule,
  type ProjectScoreList,
  type QueueProjectUsage,
  type QueueState,
  type QueueStatus
} from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { formatClock, formatMoment } from '../utils/dates'

export function searchesLine(used: number, cap: number | null): string {
  const usedLabel = used.toLocaleString('en-US')
  if (cap === null) return `${usedLabel} · no cap`
  return `${usedLabel} of ${cap.toLocaleString('en-US')}`
}

export function usedPercent(used: number, cap: number | null): number {
  if (cap === null || cap <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((used / cap) * 100)))
}

export function changeLine(change: number | null): string {
  if (change === null) return 'No previous check'
  if (change < 0) return `−${Math.abs(change)} since the last check`
  return `+${change} since the last check`
}

/**
 * Colour class for a score change.
 * Negative uses the mockup danger red. Positive uses the mockup blue.
 * Zero and a missing previous check stay grey.
 */
export function changeTone(change: number | null): 'chg-down' | 'chg-up' | 'chg-flat' {
  if (change === null || change === 0) return 'chg-flat'
  return change < 0 ? 'chg-down' : 'chg-up'
}

export function scoreLine(score: number | null): string {
  return score === null ? '—' : score.toLocaleString('en-US')
}

/** Rounded score as a percent of 100. The bar fill uses this width. */
export function scoreMeterPercent(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}

/** Accessible name for the average-score meter. The value is the rounded score. */
export function scoreMeterLabel(score: number): string {
  return `Average score ${scoreMeterPercent(score).toLocaleString('en-US')} of 100`
}

/** Shared-key total, then each project that has a key of its own. */
export function glanceSearchLine(queue: QueueStatus): string {
  const dedicated = new Set(
    queue.projects.flatMap((project) =>
      project.dedicatedKeyId === null ? [] : [project.dedicatedKeyId]
    )
  )
  const shared = queue.keys.filter((key) => key.provider === 'serpapi' && !dedicated.has(key.keyId))
  const parts: string[] = []
  if (shared.length > 0) {
    const used = shared.reduce((sum, key) => sum + key.used, 0)
    const capped = shared.every((key) => key.cap !== null)
    const cap = capped ? shared.reduce((sum, key) => sum + (key.cap ?? 0), 0) : null
    const limit = cap === null ? 'no cap' : `caps total ${cap.toLocaleString('en-US')}`
    parts.push(`${used.toLocaleString('en-US')} used by CiteFox · ${limit} on shared keys`)
  }
  for (const project of queue.projects) {
    if (project.dedicatedKeyId === null) continue
    const first = project.name.split(' ')[0] ?? project.name
    parts.push(`${searchesLine(project.used, project.cap)} on ${first}'s own key`)
  }
  if (parts.length > 0) return parts.join(' · ')
  const used = queue.projects.reduce((sum, project) => sum + project.used, 0)
  return searchesLine(used, null)
}

export function sharedKeyUsage(queue: QueueStatus): { used: number; cap: number | null } {
  const dedicated = new Set(
    queue.projects.flatMap((project) =>
      project.dedicatedKeyId === null ? [] : [project.dedicatedKeyId]
    )
  )
  const shared = queue.keys.filter((key) => key.provider === 'serpapi' && !dedicated.has(key.keyId))
  if (shared.length === 0) {
    const used = queue.projects
      .filter((project) => project.dedicatedKeyId === null)
      .reduce((sum, project) => sum + project.used, 0)
    return { used, cap: null }
  }
  const used = shared.reduce((sum, key) => sum + key.used, 0)
  const capped = shared.every((key) => key.cap !== null)
  const cap = capped ? shared.reduce((sum, key) => sum + (key.cap ?? 0), 0) : null
  return { used, cap }
}

export function capNote(dedicatedKeyId: string | null): string {
  return dedicatedKeyId === null
    ? 'Cap drawn from shared keys'
    : "Client's own search plan, used only here"
}

/** "Today 9:00 AM" or "Oct 28, 6:00 AM", in the computer's own zone and clock style. */
export function clockLabel(iso: string, now = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  if (sameLocalDay(date, now)) return `Today ${formatClock(iso)}`
  return formatMoment(iso, { now })
}

/**
 * The glance names the soonest check, including a paused project.
 * A tie prefers a project that is not paused. The detail counts pages due today.
 */
export function glanceNext(
  list: ProjectScoreList,
  schedules: readonly ProjectSchedule[],
  names: ReadonlyMap<string, string>,
  now = new Date()
): { title: string; detail: string } | null {
  if (list.nextCheckAt === null) return null
  const matches = schedules.filter((schedule) => schedule.nextCheckAt === list.nextCheckAt)
  const chosen = matches.find((schedule) => !schedule.paused) ?? matches[0]
  const when = clockLabel(list.nextCheckAt, now)
  const name = chosen ? (names.get(chosen.projectId) ?? '') : ''
  const due = schedules.reduce((sum, schedule) => sum + schedule.pagesDueToday, 0)
  const detail = chosen?.paused && due === 0 ? 'Paused' : `${pluralize(due, 'page')} due`
  return { title: name ? `${when} · ${name}` : when, detail }
}

export function cadenceLine(schedule: ProjectSchedule): string {
  return `${intervalLabel(schedule.defaultIntervalDays)} at ${schedule.dailyCheckTime}`
}

/**
 * The emphasized half of the clock row.
 * Paused reads `paused` and shows "Paused". The contract has no paused-by date.
 * Active shows the next check and the pages due.
 */
export function clockDetail(schedule: ProjectSchedule, now = new Date()): string {
  if (schedule.paused) return 'Paused'
  if (schedule.nextCheckAt === null) return 'Not scheduled'
  const when = clockLabel(schedule.nextCheckAt, now).replace(/^Today/, 'today')
  const due = `${pluralize(schedule.pagesDueToday, 'page')} due`
  return `Next: ${when} · ${due}`
}

/** Reads `paused` and shows "Paused". The computed next check stays on the resume line. */
export function scheduleSentence(schedule: ProjectSchedule, now = new Date()): string {
  return `${cadenceLine(schedule)} · ${clockDetail(schedule, now)}`
}

/**
 * Key and Claude line on a project card (FR-10.5, FR-11.7).
 * Shared keys are named from the queue. A dedicated key uses its queue name.
 * The Claude half is the project's connection label from the usage report.
 */
export function keyStatusLine(
  queue: QueueStatus | null,
  projectId: string,
  claudeLabel: string | null = null
): string {
  return `${keySourcePhrase(queue, projectId)} · ${claudeLabel ?? 'AI connection from Settings'}`
}

function keySourcePhrase(queue: QueueStatus | null, projectId: string): string {
  if (!queue) return 'Search source is not available yet'
  const project = queue.projects.find((item) => item.projectId === projectId)
  if (!project) return 'Search source is not available yet'
  if (project.dedicatedKeyId !== null) {
    const key = queue.keys.find((item) => item.keyId === project.dedicatedKeyId)
    return key ? `Own key "${key.name}"` : 'Own key, used only here'
  }
  const dedicated = new Set(
    queue.projects.flatMap((item) => (item.dedicatedKeyId === null ? [] : [item.dedicatedKeyId]))
  )
  const names = queue.keys
    .filter((key) => key.provider === 'serpapi' && !dedicated.has(key.keyId))
    .map((key) => key.name)
  if (names.length === 0) return 'Shared keys'
  return `Shared keys (${names.join(', ')})`
}

export function resumeSentence(schedule: ProjectSchedule, now = new Date()): string | null {
  if (!schedule.paused || schedule.nextCheckAt === null) return null
  const when = clockLabel(schedule.nextCheckAt, now).replace(/^Today/, 'today')
  return `Next check after resume: ${when}`
}

export function usageNext(schedule: ProjectSchedule | undefined, now = new Date()): string {
  if (!schedule) return 'Not scheduled'
  if (schedule.paused) return 'Paused'
  if (schedule.nextCheckAt === null) return 'Not scheduled'
  return clockLabel(schedule.nextCheckAt, now)
}

export function shareLabel(project: QueueProjectUsage, sharedCap: number | null): string {
  if (project.dedicatedKeyId !== null) return 'Own key, not shared'
  if (sharedCap === null || sharedCap <= 0) return '—'
  const share = (project.used / sharedCap) * 100
  if (share < 1) return 'under 1%'
  return `${Math.round(share)}%`
}

export function queueIsPaused(state: QueueState): boolean {
  return state === 'paused_all' || state === 'paused_today'
}

export function checkDueMessage(result: CheckDueResult, state: QueueState): string {
  if (result.started && result.pages === 0) return 'Nothing was due, so no check started.'
  if (result.started) {
    return `Check started for ${pluralize(result.pages, 'page')}.`
  }
  if (queueIsPaused(state)) return 'Check now waits while checks are paused.'
  return "Today's check already ran."
}

function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}
