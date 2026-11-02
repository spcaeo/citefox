import type { AppInfo } from '@shared/ipc'
import { releaseLine } from '@shared/release-line'

/**
 * Words for the build chip and its menu (owner feedback batch 2, item 1):
 * `v0.11.0 · 22 Oct · 1787acc` on the chip, "CiteFox 0.11.0" and
 * "Build 1787acc · 22 Oct 2026, 19:50" in the menu, and the text that
 * "Copy build info" puts on the clipboard. Times are local.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
] as const

function builtDate(info: AppInfo): Date | null {
  const iso = info.build?.builtAt
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** "22 Oct". */
export function shortDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

/** "22 Oct 2026, 19:50". */
export function longDateTime(date: Date): string {
  return `${shortDate(date)} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export interface ChipParts {
  /** "v0.11.0". */
  version: string
  /** "22 Oct", or null without a build time. */
  date: string | null
  /** "1787acc", or null when the build was made outside git. */
  commit: string | null
}

export function chipParts(info: AppInfo): ChipParts {
  const date = builtDate(info)
  return {
    version: `v${info.version}`,
    date: date ? shortDate(date) : null,
    commit: info.build?.commit ?? null
  }
}

/** The chip as one line: `v0.11.0 · 22 Oct · 1787acc`. */
export function chipText(info: AppInfo): string {
  const parts = chipParts(info)
  return [parts.version, parts.date, parts.commit].filter(Boolean).join(' · ')
}

/** The menu header: "CiteFox 0.11.0". */
export function menuTitle(info: AppInfo): string {
  return `${info.name} ${info.version}`
}

/** "Build 1787acc · 22 Oct 2026, 19:50"; "Built 22 Oct 2026, 19:50" without a commit; null without a build. */
export function buildLine(info: AppInfo): string | null {
  const date = builtDate(info)
  const commit = info.build?.commit ?? null
  if (commit && date) return `Build ${commit} · ${longDateTime(date)}`
  if (commit) return `Build ${commit}`
  if (date) return `Built ${longDateTime(date)}`
  return null
}

interface NavigatorLike {
  platform?: string
  userAgent?: string
}

/** "macOS · Electron 44.0.0" from the renderer's navigator. */
export function platformLabel(nav: NavigatorLike | undefined = globalThis.navigator): string {
  const platform = nav?.platform ?? ''
  const agent = nav?.userAgent ?? ''
  const os = /mac/i.test(platform)
    ? 'macOS'
    : /win/i.test(platform)
      ? 'Windows'
      : /linux/i.test(platform)
        ? 'Linux'
        : platform || 'Unknown OS'
  const electron = /Electron\/([\d.]+)/.exec(agent)?.[1]
  return electron ? `${os} · Electron ${electron}` : os
}

/** What "Copy build info" copies: one fact per line, for a bug report. */
export function buildInfoText(info: AppInfo, platform: string): string {
  const date = builtDate(info)
  return [
    menuTitle(info),
    `Commit: ${info.build?.commit ?? 'unknown'}`,
    `Built: ${date ? `${longDateTime(date)} (${date.toISOString()})` : 'unknown'}`,
    `OS: ${platform}`,
    ...(info.testProfile ? ['Window: test profile'] : [])
  ].join('\n')
}

/** The footer release line, also the ⚙ menu's version line: `v0.12.0 · build 1424 · Nov 2, 2026 8:49 AM EST`. */
export function releaseText(info: AppInfo): string {
  return releaseLine({
    version: info.version,
    number: info.build?.number ?? null,
    builtAt: info.build?.builtAt ?? null
  })
}
