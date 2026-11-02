import {
  serpKeyAllowance,
  type ApiKeyMetadata,
  type ProjectUsageReport,
  type ProjectUsageRow
} from '@shared/domain'

function n(value: number): string {
  return value.toLocaleString('en-US')
}

/** "500" plus the 10% note, or "No cap" (FR-11.4). */
export function capCell(row: Pick<ProjectUsageRow, 'cap' | 'capRule' | 'allowance'>): string {
  if (row.cap === null) return 'No cap'
  if (row.capRule === 'allow_10' && row.allowance !== null) {
    return `${n(row.cap)} (+10%: ${n(row.allowance)})`
  }
  return n(row.cap)
}

/** Share of shared keys column text. An own key is not part of the shared pool. */
export function shareCell(
  row: Pick<ProjectUsageRow, 'source' | 'sharePercent' | 'sharedSearches'>
): string {
  if (row.source === 'dedicated') return 'Own key, not shared'
  if (row.sharePercent === null) return row.sharedSearches > 0 ? 'No shared limit' : '—'
  if (row.sharePercent === 0 && row.sharedSearches > 0) return 'under 1%'
  return `${row.sharePercent}%`
}

export function sourceLabel(row: Pick<ProjectUsageRow, 'source'>): string {
  return row.source === 'dedicated' ? 'Own key' : 'Shared keys'
}

/** "1,258 of 5,250 · 24%" for the All projects row. */
export function sharedTotalCell(
  report: Pick<ProjectUsageReport, 'sharedUsed' | 'sharedCapacity'>
): string {
  if (report.sharedCapacity === null) return `${n(report.sharedUsed)} · no shared limit`
  if (report.sharedCapacity === 0) return n(report.sharedUsed)
  const percent = Math.min(100, Math.round((report.sharedUsed / report.sharedCapacity) * 100))
  return `${n(report.sharedUsed)} of ${n(report.sharedCapacity)} · ${percent}%`
}

/** All projects total searches this month (shared and own keys). */
export function totalSearches(report: Pick<ProjectUsageReport, 'projects'>): number {
  return report.projects.reduce((sum, row) => sum + row.searches, 0)
}

/** Shared SerpApi keys: on, not dedicated to a project, in rotation order. */
export function sharedSerpKeys(
  keys: readonly ApiKeyMetadata[],
  report: Pick<ProjectUsageReport, 'projects'>
): ApiKeyMetadata[] {
  const dedicated = new Set(
    report.projects.flatMap((row) => (row.dedicatedKeyId === null ? [] : [row.dedicatedKeyId]))
  )
  return keys
    .filter((key) => key.provider === 'serpapi' && key.on && !dedicated.has(key.id))
    .sort((a, b) => a.rotationOrder - b.rotationOrder)
}

function keyLimit(key: ApiKeyMetadata): number | null {
  return serpKeyAllowance(key)?.limit ?? null
}

/**
 * The line under Usage by project (FR-10.6): each shared key's use, then how much of the
 * shared capacity no project cap has promised.
 */
export function sharedKeysSentence(
  keys: readonly ApiKeyMetadata[],
  report: ProjectUsageReport
): string {
  const shared = sharedSerpKeys(keys, report)
  const keyPart =
    shared.length === 0
      ? 'No shared search keys yet.'
      : `Shared keys: ${shared
          .map((key) => {
            const used = serpKeyAllowance(key)?.used ?? key.usedThisMonth ?? 0
            const limit = keyLimit(key)
            return limit === null
              ? `${key.name} ${n(used)} · no limit`
              : `${key.name} ${n(used)} of ${n(limit)}`
          })
          .join(' · ')}.`
  return `${keyPart} ${unassignedSentence(report)}`.trim()
}

/** Plain words for `report.unassigned`, including the cases where it cannot be named. */
export function unassignedSentence(report: ProjectUsageReport): string {
  const sharedRows = report.projects.filter(
    (row) => row.source === 'shared' && row.status !== 'archived'
  )
  if (sharedRows.length === 0) return ''
  if (report.unassigned === null) {
    if (report.sharedCapacity === null) {
      return "A shared key has no monthly limit, so CiteFox can't say how much is unassigned."
    }
    return 'Some projects on shared keys have no cap, so every shared search can go to them.'
  }
  const caps = sharedRows.reduce((sum, row) => sum + (row.cap ?? 0), 0)
  if (report.unassigned < 0) {
    return `Project caps add up to ${n(caps)}, ${n(-report.unassigned)} more than the shared keys allow.`
  }
  if (report.unassigned === 0) {
    return `Project caps add up to ${n(caps)}, so every shared search is promised to a project.`
  }
  return `Project caps add up to ${n(caps)}, so ${n(report.unassigned)} shared searches a month aren't promised to any project.`
}

/** New project hint: what is still free on the shared keys. */
export function unassignedHint(report: ProjectUsageReport | null): string {
  if (!report || report.unassigned === null || report.sharedCapacity === null) {
    return 'CiteFox uses the shared keys in the order set in Connections.'
  }
  if (report.unassigned <= 0) {
    return `In the order set in Connections. All ${n(report.sharedCapacity)} shared searches a month are already promised to projects.`
  }
  return `In the order set in Connections. ${n(report.unassigned)} of ${n(report.sharedCapacity)} a month aren't assigned to a project yet.`
}

/** Glance strip fallback when the queue status is not in yet. */
export function glanceUsageLine(report: ProjectUsageReport): string {
  const shared =
    report.sharedCapacity === null
      ? `${n(report.sharedUsed)} used by CiteFox · no cap on shared keys`
      : `${n(report.sharedUsed)} used by CiteFox · caps total ${n(report.sharedCapacity)} on shared keys`
  return report.dedicatedUsed > 0 ? `${shared} · ${n(report.dedicatedUsed)} on own keys` : shared
}
