import type { PageSummary } from '@shared/domain'
import type { OverviewFirstReport, OverviewFix, OverviewSource } from '@shared/ipc'
import type { SqliteDatabase } from '../../storage/database'
import { listStoredCheckRuns } from '../../storage/check-records'
import { listFixFollowUps } from '../../storage/fix-follow-ups'
import { loadStartPlan } from '../../start/store'
import { filterFor, runPromptRows, trackedPageMap } from '../checks/results'
import { normalizeUrl } from '../checks/url'

/** Where a question or fix comes from, as the Overview shows it. */
export function sourceOf(page: PageSummary | undefined): OverviewSource {
  if (page === undefined) return { kind: 'topic', name: 'Removed page' }
  if (page.kind === 'topic' || page.url === null) {
    return { kind: 'topic', name: page.title ?? page.label ?? 'Topic' }
  }
  return { kind: 'page', url: page.url, path: pathOf(page.url) }
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}

/** The first line of a fix description as plain text: no Markdown marks. */
export function fixTitle(description: string): string {
  const line =
    description
      .split('\n')
      .map((item) => item.trim())
      .find((item) => item.length > 0) ?? ''
  return line
    .replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/u, '')
    .replace(/(\*\*|__|`)/gu, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .trim()
}

/**
 * Fixes whose follow-up has not run yet, soonest go-live first, on pages and
 * topics that still exist. The same rows Progress lists per page.
 */
export function openFixes(
  db: SqliteDatabase,
  pages: ReadonlyMap<string, PageSummary>,
  limit = 3
): { fixes: OverviewFix[]; total: number } {
  const open = listFixFollowUps(db)
    .filter((fix) => fix.status === 'planned')
    .filter((fix) => {
      const page = pages.get(fix.pageId)
      return page !== undefined && page.status !== 'removed'
    })
    .sort(
      (left, right) =>
        left.goLiveAt.localeCompare(right.goLiveAt) ||
        left.pageId.localeCompare(right.pageId) ||
        left.number - right.number
    )
  return {
    total: open.length,
    fixes: open.slice(0, limit).map((fix) => ({
      fixId: fix.id,
      pageId: fix.pageId,
      number: fix.number,
      title: fixTitle(fix.description) || `Fix ${fix.number}`,
      source: sourceOf(pages.get(fix.pageId)),
      questions: fix.promptIds.length,
      goLiveAt: fix.goLiveAt
    }))
  }
}

/**
 * The first check started from the "Your site" plan: its earliest finished
 * run (and the batches of the same job), the questions searched, and the
 * pages the plan suggested. Null before that first check.
 */
export function firstReport(
  db: SqliteDatabase,
  projectId: string,
  pages: readonly PageSummary[]
): OverviewFirstReport | null {
  const plan = loadStartPlan(db)
  if (plan === null || (plan.topicId === null && plan.firstCheckAt === null)) return null
  const runs =
    plan.topicId === null
      ? []
      : listStoredCheckRuns(db, filterFor(projectId, plan.topicId, null))
          .filter((run) => run.pageId === plan.topicId)
          .filter((run) => run.status === 'finished' && run.finishedAt !== null)
          .sort((left, right) => (left.finishedAt ?? '').localeCompare(right.finishedAt ?? ''))
  const first = runs[0]
  const checkedAt = first?.finishedAt ?? plan.firstCheckAt
  if (checkedAt === null || checkedAt === undefined) return null
  const searched = new Set<string>()
  if (first !== undefined) {
    for (const run of runs.filter((item) => item.jobId === first.jobId)) {
      for (const row of runPromptRows(db, projectId, run)) searched.add(row.promptId)
    }
  }
  const tracked = trackedPageMap(pages)
  const untracked = plan.recommendedUrls.filter((url) => {
    const normalized = normalizeUrl(url)
    return normalized === null || !tracked.has(normalized)
  })
  return {
    checkedAt,
    topicId: plan.topicId,
    topics: plan.topicId === null ? 0 : 1,
    questions: first === undefined ? plan.questions.length : searched.size,
    suggestedPages: plan.recommendedUrls.length,
    untrackedSuggested: untracked.length
  }
}
