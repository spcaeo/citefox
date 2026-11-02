import type { PageSummary } from '@shared/domain'
import { changeStatus, daysLive, isCited, lostQuestions } from '@shared/fix-loop'
import { fixVerdict, workingNote } from '@shared/fix-verdict'
import { GOOGLE_UPDATES } from '@shared/google-updates'
import { sameTargetPage, targetPagePath } from '@shared/target-page'
import type { ChangeCheck, ChangeLedger, ChangeRow, IndexCheck, PageDates } from '@shared/ipc'
import { listStoredCheckRuns, type StoredCheckRun } from '../../storage/check-records'
import { getLatestSnapshot } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import {
  listFixFollowUps,
  setFixWorkedNoted,
  type FixFollowUpRecord
} from '../../storage/fix-follow-ups'
import {
  latestIndexChecks,
  listPageAiTexts,
  readLoopOwners,
  type IndexCheckRecord
} from '../../storage/fix-loop-records'
import { listPages } from '../../storage/pages'
import { listMarkets, readProjectProfile } from '../../storage/project-profile'
import { readProjectSchedule } from '../../storage/project-schedule'
import type { ProjectRecord } from '../../storage/records'
import { filterFor, isFullRun } from '../checks/results'
import { fixMeasureReader } from './measure'
import { changeCheck, endOf, fullRunsOf, isOpenPage, promptRowCache } from './runs'

/**
 * `fixes:ledger`: one row per logged change with a page address (a page, or a topic
 * fix that names the page it is about), measured in the page's default market from
 * stored full checks only (no searches). "Before" is the last full check that finished
 * before go-live, "now" the latest full check; the status comes from `changeStatus`,
 * the one rule the renderer also uses. `measure` holds the fix's own searches from
 * whichever page or topic asks them, for the verdict (`fixVerdict`).
 */
export function buildLedger(
  db: SqliteDatabase,
  project: ProjectRecord,
  builtAt: string
): ChangeLedger {
  const pages = listPages(db, project.id)
  const open = new Map(pages.filter(isOpenPage).map((page) => [page.id, page]))
  const subjects = new Map(
    pages.filter((page) => page.status !== 'removed').map((page) => [page.id, page])
  )
  const measures = fixMeasureReader(db, project.id)
  const rowsOf = promptRowCache(db, project.id)
  const runsByPage = new Map<string, StoredCheckRun[]>()
  const fullRuns = (page: PageSummary): StoredCheckRun[] => {
    const cached = runsByPage.get(page.id)
    if (cached !== undefined) return cached
    const runs =
      page.defaultMarketId === null ? [] : fullRunsOf(db, project.id, page.id, page.defaultMarketId)
    runsByPage.set(page.id, runs)
    return runs
  }
  const indexChecks = latestIndexChecks(db)
  const fixes = listFixFollowUps(db).filter(
    (fix) => open.has(fix.pageId) || (fix.url !== null && subjects.has(fix.pageId))
  )
  const newest = newestPerPage(fixes)
  const rows: ChangeRow[] = []
  for (const fix of fixes) {
    const page = subjects.get(fix.pageId)
    const url = measures.urlOf(fix)
    if (page === undefined || url === null) continue
    // A fix that names its own page (a topic's, or another address): that page's name when tracked.
    const named = page.kind === 'topic' || fix.url !== null ? namedPage(open, url) : page
    const runs = fullRuns(page)
    const beforeRun = runs.filter((run) => endOf(run) < fix.goLiveAt).at(-1) ?? null
    const nowRun = runs.at(-1) ?? null
    const before = beforeRun === null ? null : changeCheck(beforeRun, rowsOf(beforeRun))
    const now = nowRun === null ? null : changeCheck(nowRun, rowsOf(nowRun))
    const measuredSinceLive = nowRun !== null && nowRun.startedAt >= fix.goLiveAt
    const days = daysLive(fix.goLiveAt, builtAt)
    rows.push({
      fixId: fix.id,
      pageId: page.id,
      number: fix.number,
      kind: fix.kind,
      description: fix.description,
      url,
      title: named === null ? null : (named.label ?? named.title),
      liveSince: fix.goLiveAt,
      daysLive: days,
      pageDates: pageDates(db, page.id),
      before,
      now,
      measuredSinceLive,
      status: statusOf(before, now, days, measuredSinceLive),
      index: indexOf(indexChecks.get(named?.id ?? page.id)),
      latestOnPage: newest.get(page.id) === fix.id,
      measure: measures.measure(fix)
    })
  }
  rows.sort(
    (left, right) =>
      right.liveSince.localeCompare(left.liveSince) ||
      right.number - left.number ||
      left.pageId.localeCompare(right.pageId)
  )
  const schedule = readProjectSchedule(db, project.id)
  return {
    projectId: project.id,
    builtAt,
    domain: project.domain,
    brand: readProjectProfile(db)?.brandNames[0] ?? project.name,
    markets: listMarkets(db),
    rows,
    workingNotes: noteWorkingFixes(db, fixes, rows, builtAt),
    trackedPages: pages.filter((page) => page.status === 'tracked' && page.kind !== 'topic').length,
    schedule: {
      intervalDays: schedule.defaultIntervalDays,
      nextCheckAt: schedule.nextCheckAt,
      lastCheckAt: lastFullCheck(db, project.id),
      paused: schedule.paused
    },
    owners: readLoopOwners(db),
    anchors: listPageAiTexts(db, 'anchor').map((text) => ({
      pageId: text.pageId,
      text: text.text,
      savedAt: text.savedAt
    }))
  }
}

function namedPage(
  open: ReadonlyMap<string, PageSummary & { url: string }>,
  url: string
): (PageSummary & { url: string }) | null {
  for (const page of open.values()) if (sameTargetPage(page.url, url)) return page
  return null
}

/**
 * Fixes whose verdict turned Worked since Activity last heard: each is noted once
 * (`worked_noted_at`), so a reload never says it again.
 */
function noteWorkingFixes(
  db: SqliteDatabase,
  fixes: readonly FixFollowUpRecord[],
  rows: readonly ChangeRow[],
  builtAt: string
): string[] {
  const notes: string[] = []
  for (const row of rows) {
    const fix = fixes.find((item) => item.id === row.fixId)
    if (fix === undefined || fix.workedNotedAt !== null) continue
    const view = fixVerdict(row.measure, {
      liveSince: row.liveSince,
      now: builtAt,
      updates: GOOGLE_UPDATES
    })
    if (view.state !== 'worked') continue
    setFixWorkedNoted(db, fix.id, builtAt)
    notes.push(workingNote(row.number, targetPagePath(row.url), view))
  }
  return notes
}

function statusOf(
  before: ChangeCheck | null,
  now: ChangeCheck | null,
  days: number | null,
  measuredSinceLive: boolean
): ChangeRow['status'] {
  const citedNow = now === null ? 0 : now.rows.filter(isCited).length
  if (before === null) {
    return changeStatus({ daysLive: days, citedBefore: 0, citedNow, lost: 0, measuredSinceLive })
  }
  return changeStatus({
    daysLive: days,
    citedBefore: before.rows.filter(isCited).length,
    citedNow,
    lost: now === null ? 0 : lostQuestions(before.rows, now.rows).length,
    measuredSinceLive
  })
}

/** The newest change of each page by go-live (a tie goes to the higher fix number). */
function newestPerPage(fixes: readonly FixFollowUpRecord[]): Map<string, string> {
  const best = new Map<string, FixFollowUpRecord>()
  for (const fix of fixes) {
    const current = best.get(fix.pageId)
    if (
      current === undefined ||
      fix.goLiveAt > current.goLiveAt ||
      (fix.goLiveAt === current.goLiveAt && fix.number > current.number)
    ) {
      best.set(fix.pageId, fix)
    }
  }
  return new Map([...best].map(([pageId, fix]) => [pageId, fix.id]))
}

function pageDates(db: SqliteDatabase, pageId: string): PageDates | null {
  const snapshot = getLatestSnapshot(db, pageId)
  if (snapshot === null) return null
  return {
    publishedAt: snapshot.publishedAt,
    modifiedAt: snapshot.modifiedAt,
    readAt: snapshot.fetchedAt
  }
}

export function indexOf(record: IndexCheckRecord | undefined): IndexCheck | null {
  if (record === undefined) return null
  return { state: record.state, checkedAt: record.checkedAt, message: record.message }
}

/** The newest finished full check of any page in the project. */
function lastFullCheck(db: SqliteDatabase, projectId: string): string | null {
  let latest: string | null = null
  for (const run of listStoredCheckRuns(db, filterFor(projectId, null, null))) {
    if (!isFullRun(run)) continue
    const at = endOf(run)
    if (latest === null || at > latest) latest = at
  }
  return latest
}
