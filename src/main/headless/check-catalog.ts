import type { FixFollowUpInput } from '@shared/domain'
import type { QueueProjectInput } from '../queue/types'
import type { ScheduledPageInput, ScheduledProjectInput, TopicBatchInput } from '../scheduler/types'
import { topicBatchInputs } from '../topics/batches'
import type { SqliteDatabase } from '../storage/database'
import { listFirstCheckWaits } from '../storage/first-check-waits'
import { listFixFollowUps } from '../storage/fix-follow-ups'
import { readEngineSettings } from '../storage/engine-records'
import { listPageMarketSchedules, listPages } from '../storage/pages'
import { monthKey } from '../scheduler/local-time'
import { readEffectiveScheduleCap, readProjectSchedule } from '../storage/project-schedule'
import type { ProjectRecord } from '../storage/records'
import type { CheckCatalog } from './check-due'

/** Catalog and queue caps for every project. */
export interface StoredCheckCatalog {
  catalog: CheckCatalog
  queueProjects: QueueProjectInput[]
}

export interface ProjectCheckSlice {
  scheduledProject: ScheduledProjectInput
  queueProject: QueueProjectInput
  pages: ScheduledPageInput[]
  followUps: FixFollowUpInput[]
  topicBatches: TopicBatchInput[]
}

/**
 * One project's schedule, cap, pages, markets, and planned fixes.
 * A fixed number of queries per project: pages and every page market are read
 * in one query each, not one per page.
 */
export function readProjectCheckSlice(
  db: SqliteDatabase,
  project: ProjectRecord,
  month: string = currentLocalMonth()
): ProjectCheckSlice {
  const schedule = readProjectSchedule(db, project.id)
  const paused = schedule.paused || project.status === 'paused'
  // FR-11.4: a notify cap the user chose to take 10% over reads as allow_10 this month.
  const cap = readEffectiveScheduleCap(db, month)
  const markets = listPageMarketSchedules(db)
  const waits = listFirstCheckWaits(db)
  // Topics with no saved question yet (an empty topic) are left off the schedule.
  const withQuestions = new Set(
    db
      .prepare<unknown[], { page_id: string }>('SELECT DISTINCT page_id FROM prompt_sets')
      .all()
      .map((row) => row.page_id)
  )
  const pages = listPages(db, project.id).map((page) => ({
    projectId: project.id,
    pageId: page.id,
    label: page.label,
    title: page.title,
    url: page.url,
    status: page.status,
    intervalDays: page.intervalDays,
    promptSetVersion: page.promptSetVersion,
    noQuestions: page.kind === 'topic' && !withQuestions.has(page.id),
    markets: markets.get(page.id) ?? [],
    firstCheckWaits: waits.has(page.id)
  }))
  // A fix whose follow-up ran, or was started with "Run follow-up now", is not
  // planned any more. Markets later removed from the page are left out, so one
  // stale fix cannot stop the due pass for every project.
  // A fix's searches may come from its topics: the planned follow-up asks the page's
  // own ones, and the topics' regular checks measure the rest.
  const owners = promptOwners(db)
  const followUps = listFixFollowUps(db).flatMap((row) => {
    if (row.followUpRunId !== null || row.followUpJobId !== null) return []
    const onPage = new Set((markets.get(row.pageId) ?? []).map((market) => market.marketId))
    const marketIds = row.marketIds.filter((marketId) => onPage.has(marketId))
    if (marketIds.length === 0 || !pages.some((item) => item.pageId === row.pageId)) return []
    const promptIds = row.promptIds.filter((id) => (owners.get(id) ?? row.pageId) === row.pageId)
    if (promptIds.length === 0) return []
    return [
      {
        id: row.id,
        projectId: project.id,
        pageId: row.pageId,
        description: row.description,
        goLiveAt: row.goLiveAt,
        rule: row.rule,
        promptIds,
        marketIds
      }
    ]
  })
  return {
    scheduledProject: {
      ...schedule,
      paused,
      archived: project.status === 'archived'
    },
    queueProject: {
      projectId: project.id,
      name: project.name,
      cap: cap.cap,
      capRule: cap.capRule,
      dedicatedKeyId: cap.dedicatedKeyId,
      paused,
      provider: readEngineSettings(db).provider
    },
    pages,
    followUps,
    topicBatches: topicBatchInputs(db, project.id)
  }
}

/** `YYYY-MM` in the computer's timezone now. The cap rule in force can change with it. */
export function currentLocalMonth(nowMs: number = Date.now()): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return monthKey(nowMs, zone.length > 0 ? zone : 'UTC')
}

/** Which page or topic each prompt belongs to (its prompt set's page). */
function promptOwners(db: SqliteDatabase): Map<string, string> {
  const rows = db
    .prepare<unknown[], { id: string; page_id: string }>(
      `SELECT prompts.id, prompt_sets.page_id FROM prompts
       JOIN prompt_sets ON prompt_sets.id = prompts.prompt_set_id`
    )
    .all()
  return new Map(rows.map((row) => [row.id, row.page_id]))
}
