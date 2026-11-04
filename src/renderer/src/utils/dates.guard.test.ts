import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Owner rule (2026-10-29): when something happened, show the day AND the time in the
 * computer's own zone and clock (formatMoment). formatDay is for true calendar days.
 * This guard fails when formatDay is called on a name that ends in At or Time (an event
 * stamp such as checkedAt, savedAt, finishedAt) unless the call is on this reviewed
 * list or sits on the same line as formatClock (a day plus a time, written out).
 *
 * Add to the list only for a real calendar day: a date the page itself declares, a
 * future plan, a chart day or a day bucket. Everything else uses formatMoment.
 */
const REVIEWED: readonly string[] = [
  // Planned (future) days, not events that happened.
  'fixes/todo/publish.ts|goLiveAt',
  'fixes/round/model.ts|schedule.nextCheckAt',
  'status/components/SetupCard.tsx|failure.retryAt',
  // Dates a page declares about itself (calendar days).
  'pageSetup/ReadHead.tsx|result.publishedAt',
  'pageSetup/ReadHead.tsx|result.modifiedAt',
  'changes/model.ts|dates.modifiedAt',
  'changes/model.ts|dates.publishedAt',
  'pageChanges/PageChangeDrawer.tsx|shown.from.modifiedAt',
  'pageChanges/PageChangeDrawer.tsx|shown.to.modifiedAt',
  'pageChanges/PageDates.tsx|previousModifiedAt',
  'pageChanges/PageDates.tsx|dates.publishedAt',
  'pageChanges/PageDates.tsx|dates.modifiedAt',
  'pageChanges/model.ts|change.modifiedAt',
  'pageChanges/VersionsPanel.tsx|row.publishedAt',
  'pageChanges/VersionsPanel.tsx|row.modifiedAt',
  'allPages/utils/columns.tsx|row.modifiedAt',
  'allPages/utils/columns.tsx|row.publishedAt',
  // Posted or published on someone else's site (a calendar day).
  'communities/drills.ts|thread.postedAt',
  'communities/components/SourceTables.tsx|video.publishedAt',
  // Day groups, week buckets and chart days.
  'history/project/utils/csv.ts|check.startedAt',
  'history/project/components/ChecksGrid.tsx|check.startedAt',
  'overview/moreDrills.ts|week.endsAt',
  'overview/moreDrills.ts|first.endsAt',
  'overview/model.ts|first.endsAt',
  'overview/model.ts|week.endsAt',
  'sentiment/components/TrendChart.tsx|item.point.checkedAt',
  'sentiment/components/TrendChart.tsx|before.point.checkedAt',
  // Report pages print calendar days.
  'reports/review/sections/ChangedParts.tsx|row.changedAt'
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.|\.test-helper\./.test(name) ? [path] : []
  })
}

describe('event times use formatMoment, not formatDay', () => {
  it('does not call formatDay on an event stamp (a name ending in At or Time)', () => {
    const root = join(__dirname, '..')
    const offenders: string[] = []
    for (const file of sourceFiles(root)) {
      const rel = relative(root, file).split('\\').join('/')
      if (rel === 'utils/dates.ts') continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (line.includes('formatClock(')) return
          for (const match of line.matchAll(/\bformatDay\(\s*([^,()]+)/g)) {
            const arg = (match[1] ?? '').trim()
            if (!/(At|Time)$/.test(arg)) continue
            if (REVIEWED.includes(`${rel}|${arg}`)) continue
            offenders.push(`${rel}:${index + 1} formatDay(${arg})`)
          }
        })
    }
    expect(offenders).toEqual([])
  })
})

/**
 * The same rule for the whole app, main process included: a date with `toLocaleDateString`
 * or `toLocaleTimeString` is a hand-made label (often UTC or a forced clock). Events use
 * formatMoment (src/shared/moment.ts). These files print calendar days that are not events:
 * a plan's renewal day, a due day, a month name, a planned next check.
 */
const CALENDAR_DAY_FILES: readonly string[] = [
  'renderer/src/videos/utils/model.ts',
  'renderer/src/history/project/spend/model.ts',
  'renderer/src/checkNow/model.ts',
  'renderer/src/topics/wizard/steps/EstimateStep.tsx',
  'main/topics/start.ts'
]

describe('hand-made date labels', () => {
  it('only reviewed calendar-day files call toLocaleDateString or toLocaleTimeString', () => {
    const src = join(__dirname, '..', '..', '..')
    const offenders: string[] = []
    for (const file of sourceFiles(src)) {
      const rel = relative(src, file).split('\\').join('/')
      if (CALENDAR_DAY_FILES.includes(rel)) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/\.toLocale(?:Date|Time)String\(/.test(line)) offenders.push(`${rel}:${index + 1}`)
        })
    }
    expect(offenders).toEqual([])
  })
})
