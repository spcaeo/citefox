import type { ProjectSchedule, ProjectScoreList, ProjectUsageRow } from '@shared/domain'
import type { PopoverRow } from '../components/DrillPopover'
import { focusWhenReady } from './goTo'
import { capCell, shareCell } from './usageCopy'

function n(value: number): string {
  return value.toLocaleString('en-US')
}

/** One page's score, for the Avg score and Change popovers. */
export interface PageScoreRow {
  pageId: string
  label: string
  score: number | null
  change: number | null
}

/** Switches project, then opens a hash and focuses an element. Shared by every Projects drill. */
export function goToProject(
  open: (projectId: string) => Promise<void>,
  projectId: string,
  hash: string,
  focusId?: string
): void {
  void open(projectId).then(() => {
    window.location.hash = hash
    if (focusId) focusWhenReady(focusId)
  })
}

/** Scored pages lowest first (score), or changed pages biggest loss first (change). */
export function pageScoreList(
  rows: readonly PageScoreRow[],
  mode: 'score' | 'change'
): PageScoreRow[] {
  const pick = (row: PageScoreRow): number | null => (mode === 'score' ? row.score : row.change)
  return rows
    .filter((row) => pick(row) !== null)
    .sort((a, b) => (pick(a) ?? 0) - (pick(b) ?? 0) || a.label.localeCompare(b.label))
}

/** Nearest-integer mean, as the engine rounds the project average. Null for no values. */
export function meanOf(values: readonly (number | null)[]): number | null {
  const kept = values.filter((value): value is number => value !== null)
  if (kept.length === 0) return null
  return Math.round(kept.reduce((sum, value) => sum + value, 0) / kept.length)
}

/** The popover rows. Shared plus own-key searches add up to `used` when the report agrees. */
export function searchRows(
  used: number,
  cap: number | null,
  usage: ProjectUsageRow | undefined
): PopoverRow[] {
  const rows: PopoverRow[] = [{ id: 'used', label: 'Searches this month', value: n(used) }]
  if (usage) {
    rows.push(
      { id: 'shared', label: 'On shared keys', value: n(usage.sharedSearches) },
      {
        id: 'own',
        label: 'On its own key',
        value: n(Math.max(0, usage.searches - usage.sharedSearches))
      },
      { id: 'cap', label: 'Monthly cap', value: capCell(usage) },
      { id: 'share', label: 'Share of shared keys', value: shareCell(usage) },
      {
        id: 'claude',
        label: 'AI calls',
        value: n(usage.claudeCalls),
        detail: usage.claudeLabel
      }
    )
  } else {
    rows.push({ id: 'cap', label: 'Monthly cap', value: cap === null ? 'No cap' : n(cap) })
  }
  return rows
}

/** The project whose check comes next, as `glanceNext` names it. */
export function nextProjectId(
  list: ProjectScoreList,
  schedules: readonly ProjectSchedule[]
): string | null {
  if (list.nextCheckAt === null) return null
  const matches = schedules.filter((schedule) => schedule.nextCheckAt === list.nextCheckAt)
  return (matches.find((schedule) => !schedule.paused) ?? matches[0])?.projectId ?? null
}
