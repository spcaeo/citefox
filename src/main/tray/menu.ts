import type { CheckFinishedNotice } from '@shared/ipc'
import type { QueueStatus, TrayLastCheck, TrayMenu } from '@shared/domain'
import { desktopNoticeFor } from '../email/compose'
import { localParts, utcFromLocal } from '../scheduler/local-time'
import type { TrayMenuEntry } from './host'

/**
 * Renderer routes the tray can open without a new IPC channel.
 * They match `sectionHash('ask' | 'settings' | 'check')` and `pageHash(id, 'results')`.
 * Ask CiteFox (FR-24.6, FR-25.7) opens `#/ask`; the Ask screen focuses its
 * question box when it opens, and again when the window regains focus while
 * it is showing and nothing else has focus. A native menu
 * cannot hold the mock-up's in-menu text box. The status line opens Check now,
 * which lists the pages due. Opening a last check first makes its project the
 * open one (the controller's `activeProject`), because page routes read the
 * open project.
 */
export const ASK_HASH = '#/ask'
export const SETTINGS_HASH = '#/settings'
export const CHECK_HASH = '#/check'
export const STATUS_HASH = '#/status'

export function resultsHash(pageId: string): string {
  return `#/pages/${encodeURIComponent(pageId)}/results`
}

/**
 * Tray mockup title, and the mockup body when that sentence can be filled.
 * Other notices use `desktopNoticeFor`.
 */
export function trayNoticeCopy(notice: CheckFinishedNotice): { title: string; body: string } {
  return {
    title: `Check finished: ${notice.pageLabel}`,
    body: mockupNoticeBody(notice) ?? desktopNoticeFor(notice).body
  }
}

function mockupNoticeBody(notice: CheckFinishedNotice): string | null {
  if (notice.score === null || !notice.contentChanged) return null
  if (notice.pageCitedChange === null || notice.pageCitedChange <= 0) return null
  if (notice.scoreChange === null || notice.scoreChange <= 0) return null
  return `Cited in ${notice.pageCited} of ${notice.aiosShown} AI Overviews (+${notice.pageCitedChange}). Visibility score ${notice.score} (+${notice.scoreChange}). The page changed since the last check.`
}

export interface TrayMenuActions {
  open(): void
  ask(): void
  checkDue(): void
  pauseToday(): void
  resume(): void
  settings(): void
  quit(): void
  openCheck(check: TrayLastCheck): void
  /** The status line: the pages due, on Check now. */
  openDue(): void
  /** Open "ask me" notices (FR-11.4, FR-11.7): answered on Status. */
  openNotices(): void
}

/**
 * FR-24.6 and the tray mockup.
 * The running count is the scheduler's pages due today.
 * The paused count is the queue's waiting count.
 * TODO(FR-24.6): `paused_all` is not in the mockup. The line says "Paused" and
 * the action is "Resume checks", which clears a pause-all as well as pause-today.
 * TODO(FR-24.6): With no finished checks, a disabled "No finished checks" row
 * keeps the Last checks section. The SRS does not say what the empty menu shows.
 * TODO(FR-24.6): The tooltip is the status line. The SRS does not name tooltip copy.
 */
export function buildTrayMenu(input: {
  menu: TrayMenu
  status: QueueStatus
  actions: TrayMenuActions
  /** Open notices waiting for an answer. 0 hides the item. */
  decisions?: number
}): { tooltip: string; items: TrayMenuEntry[] } {
  const decisions = input.decisions ?? 0
  const tooltip = statusLine(input.menu, input.status)
  const paused = input.status.state === 'paused_all' || input.status.state === 'paused_today'
  const checks =
    input.menu.lastChecks.length === 0
      ? [item('last-empty', 'No finished checks', false)]
      : input.menu.lastChecks.map((check, index) =>
          item(`last-${index}`, lastCheckLabel(check), true, () => input.actions.openCheck(check))
        )
  const items: TrayMenuEntry[] = [
    item('brand', 'CiteFox', false),
    item('status', tooltip, true, () => input.actions.openDue()),
    ...(decisions > 0
      ? [
          item(
            'notices',
            `${decisions} ${decisions === 1 ? 'decision' : 'decisions'} waiting for you…`,
            true,
            () => input.actions.openNotices()
          )
        ]
      : []),
    separator('sep-status'),
    item('last-label', 'Last checks', false),
    ...checks,
    separator('sep-checks'),
    item('open', 'Open CiteFox', true, () => input.actions.open()),
    item('ask', 'Ask CiteFox…', true, () => input.actions.ask()),
    item('check-due', 'Check due pages now', true, () => input.actions.checkDue()),
    paused
      ? item('pause', 'Resume checks', true, () => input.actions.resume())
      : item('pause', 'Pause checks for today', true, () => input.actions.pauseToday()),
    item('settings', 'Settings…', true, () => input.actions.settings()),
    separator('sep-quit'),
    item('quit', 'Quit CiteFox', true, () => input.actions.quit())
  ]
  return { tooltip, items }
}

/** Status line from the mockup, plus the pause-all wording noted above. */
export function statusLine(menu: TrayMenu, status: QueueStatus): string {
  if (status.state === 'paused_all') return `Paused · ${pages(status.waiting, 'waiting')}`
  if (status.state === 'paused_today') {
    return `Paused for today · ${pages(status.waiting, 'waiting')}`
  }
  return `Running · ${pages(menu.pagesDueToday, 'due today')}`
}

/**
 * One Last checks row. Score wording matches `desktopNoticeFor` ("No score yet").
 * A drop uses the mockup's minus sign (U+2212). A null change is omitted.
 */
export function lastCheckLabel(check: TrayLastCheck): string {
  const score =
    check.score === null || !Number.isFinite(check.score) ? 'No score yet' : String(check.score)
  const change = formatChange(check.change)
  return change === null ? `${check.label}  ${score}` : `${check.label}  ${score}  ${change}`
}

/**
 * Milliseconds until the next local midnight, at least 1.
 * The due pass is idempotent per local day (SCH-2), so the tray waits out the rest of today.
 */
export function msUntilNextLocalDay(nowMs: number, timeZone: string): number {
  const parts = localParts(nowMs, timeZone)
  let next = midnightAfter(parts, 1, timeZone)
  if (next <= nowMs) next = midnightAfter(parts, 2, timeZone)
  return Math.max(1, next - nowMs)
}

function midnightAfter(
  parts: { year: number; month: number; day: number },
  extraDays: number,
  timeZone: string
): number {
  return utcFromLocal(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day + extraDays,
      hour: 0,
      minute: 0,
      second: 0
    },
    timeZone
  )
}

function formatChange(change: number | null): string | null {
  if (change === null || !Number.isFinite(change)) return null
  if (change > 0) return `+${change}`
  if (change < 0) return `\u2212${Math.abs(change)}`
  return '0'
}

function pages(count: number, tail: string): string {
  const noun = count === 1 ? 'page' : 'pages'
  return `${count} ${noun} ${tail}`
}

function item(id: string, label: string, enabled: boolean, click?: () => void): TrayMenuEntry {
  return click === undefined
    ? { id, type: 'normal', label, enabled }
    : { id, type: 'normal', label, enabled, click }
}

function separator(id: string): TrayMenuEntry {
  return { id, type: 'separator', label: '', enabled: false }
}
