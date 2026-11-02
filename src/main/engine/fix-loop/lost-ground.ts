import type { PageSummary, PromptCheckRow } from '@shared/domain'
import { isCited } from '@shared/fix-loop'
import type { LostBucket, LostGroundView, PageReadStamp, RecoveryPlan } from '@shared/ipc'
import { diffOutline } from '@shared/outline-diff'
import type { StoredCheckRun } from '../../storage/check-records'
import { getStoredSnapshot } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { listFixFollowUps } from '../../storage/fix-follow-ups'
import {
  getPageAiText,
  listSnapshotStamps,
  type SnapshotStamp
} from '../../storage/fix-loop-records'
import { getPage, listPages } from '../../storage/pages'
import type { ProjectRecord } from '../../storage/records'
import { CheckInputError, trackedPageMap } from '../checks/results'
import { normalizeUrl } from '../checks/url'
import { changeCheck, endOf, fullRunsOf, isOpenPage, promptRowCache } from './runs'

/**
 * `fixes:lostGround`: where each question that cited a page in an older full check
 * stands in the latest one, the change logged between them, and the page's outline
 * then and now. Read from stored checks and page reads only. The recovery-plan assist
 * reads the same facts through {@link readLostGround}, so the plan and the screen agree.
 */

export const TWO_CHECKS_NEEDED = 'Lost ground needs two full checks of this page.'

/** The facts the screen and the recovery plan share, with the scored rows of both checks. */
export interface LostGroundFacts {
  page: PageSummary & { url: string }
  beforeRun: StoredCheckRun
  nowRun: StoredCheckRun
  beforeRows: readonly PromptCheckRow[]
  nowRows: readonly PromptCheckRow[]
  view: LostGroundView
}

/** The key a recovery plan is cached under: the two checks it compares. */
export function recoveryInputKey(beforeRunId: string, nowRunId: string): string {
  return `${beforeRunId}|${nowRunId}`
}

export function readLostGround(
  db: SqliteDatabase,
  project: ProjectRecord,
  pageId: string,
  vsRunId: string | null
): LostGroundFacts {
  const page = getPage(db, pageId, project.id)
  if (page === null || !isOpenPage(page))
    throw new CheckInputError('That page is not in this project')
  if (page.defaultMarketId === null) throw new CheckInputError(TWO_CHECKS_NEEDED)
  const runs = fullRunsOf(db, project.id, page.id, page.defaultMarketId)
  const nowRun = runs.at(-1)
  if (runs.length < 2 || nowRun === undefined) throw new CheckInputError(TWO_CHECKS_NEEDED)
  const beforeRun =
    vsRunId === null ? runs.at(-2) : runs.find((run) => run.id === vsRunId && run !== nowRun)
  if (beforeRun === undefined || beforeRun.startedAt > nowRun.startedAt) {
    throw new CheckInputError('Pick an older full check of this page to compare with.')
  }
  const rowsOf = promptRowCache(db, project.id)
  const beforeRows = rowsOf(beforeRun)
  const nowRows = rowsOf(nowRun)
  const moved = bucketsOf(page.id, beforeRows, nowRows, trackedPageMap(listPages(db, project.id)))
  const stamps = listSnapshotStamps(db, page.id)
  const beforeRead = readAtOrBefore(stamps, endOf(beforeRun))
  const nowRead = stamps.at(-1) ?? null
  const view: LostGroundView = {
    pageId: page.id,
    url: page.url,
    title: page.label ?? page.title,
    before: changeCheck(beforeRun, beforeRows),
    now: changeCheck(nowRun, nowRows),
    checks: [...runs].reverse().map((run) => ({
      runId: run.id,
      checkedAt: endOf(run),
      cited: rowsOf(run).filter(isCited).length
    })),
    ...moved,
    change: changeBetween(db, page.id, endOf(beforeRun), nowRun.startedAt),
    beforeRead: stampOf(beforeRead),
    nowRead: stampOf(nowRead),
    outline: outlineBetween(db, beforeRead, nowRead),
    plan: cachedPlan(db, page.id, recoveryInputKey(beforeRun.id, nowRun.id))
  }
  return { page, beforeRun, nowRun, beforeRows, nowRows, view }
}

type Moved = Pick<LostGroundView, 'buckets' | 'notCheckedNow' | 'movedTo' | 'movedToPage'>

/**
 * Each question cited in `before`, by where it stands in `now`: still cited, another
 * tracked page cited instead, another own page cited instead, or not cited at all.
 */
function bucketsOf(
  pageId: string,
  before: readonly PromptCheckRow[],
  now: readonly PromptCheckRow[],
  tracked: ReadonlyMap<string, string>
): Moved {
  const current = new Map(now.map((row) => [row.promptId, row]))
  const buckets: Record<LostBucket, string[]> = {
    still_cited: [],
    moved_tracked: [],
    moved_own: [],
    not_cited: []
  }
  const notCheckedNow: string[] = []
  const movedTo: Record<string, string> = {}
  const movedToPage: Record<string, string> = {}
  for (const row of before) {
    if (!isCited(row)) continue
    const later = current.get(row.promptId)
    if (later === undefined) {
      notCheckedNow.push(row.promptId)
      continue
    }
    if (isCited(later)) {
      buckets.still_cited.push(row.promptId)
      continue
    }
    if (later.status === 'other_own_page' && later.citedUrl !== null) {
      movedTo[row.promptId] = later.citedUrl
      const normalized = normalizeUrl(later.citedUrl)
      const other = normalized === null ? undefined : tracked.get(normalized)
      if (other !== undefined && other !== pageId) {
        buckets.moved_tracked.push(row.promptId)
        movedToPage[row.promptId] = other
      } else {
        buckets.moved_own.push(row.promptId)
      }
      continue
    }
    buckets.not_cited.push(row.promptId)
  }
  return { buckets, notCheckedNow, movedTo, movedToPage }
}

/** The newest change on the page that went live between the two checks. */
function changeBetween(
  db: SqliteDatabase,
  pageId: string,
  from: string,
  to: string
): LostGroundView['change'] {
  const fix = listFixFollowUps(db, pageId)
    .filter((item) => item.goLiveAt >= from && item.goLiveAt <= to)
    .sort(
      (left, right) => left.goLiveAt.localeCompare(right.goLiveAt) || left.number - right.number
    )
    .at(-1)
  if (fix === undefined) return null
  return {
    fixId: fix.id,
    kind: fix.kind,
    liveSince: fix.goLiveAt,
    description: fix.description
  }
}

/** The newest read at or before `at`, else the oldest read (the page was read later). */
function readAtOrBefore(stamps: readonly SnapshotStamp[], at: string): SnapshotStamp | null {
  return stamps.filter((stamp) => stamp.fetchedAt <= at).at(-1) ?? stamps[0] ?? null
}

function stampOf(stamp: SnapshotStamp | null): PageReadStamp | null {
  if (stamp === null) return null
  return { snapshotId: stamp.id, fetchedAt: stamp.fetchedAt, title: stamp.title }
}

function outlineBetween(
  db: SqliteDatabase,
  before: SnapshotStamp | null,
  now: SnapshotStamp | null
): LostGroundView['outline'] {
  if (before === null || now === null || before.id === now.id) return null
  const older = getStoredSnapshot(db, before.id)
  const newer = getStoredSnapshot(db, now.id)
  if (older === null || newer === null) return null
  return diffOutline(older.outline, newer.outline)
}

/** The cached plan, shown only for the same two checks it was written for. */
export function cachedPlan(
  db: SqliteDatabase,
  pageId: string,
  inputKey: string
): RecoveryPlan | null {
  const saved = getPageAiText(db, pageId, 'recovery')
  if (saved === null || saved.inputKey !== inputKey) return null
  return {
    text: saved.text,
    savedAt: saved.savedAt,
    edited: saved.edited,
    inputKey: saved.inputKey
  }
}
