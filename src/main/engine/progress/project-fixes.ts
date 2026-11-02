import type { CoverageRecord, LoggedFix, PageSummary } from '@shared/domain'
import type { FixSubject, GapSuggestion, ProjectFix, ProjectFixList } from '@shared/ipc'
import { getLatestCoverage } from '../../storage/coverage-records'
import type { SqliteDatabase } from '../../storage/database'
import { listMarkets, readProjectProfile } from '../../storage/project-profile'
import { getLatestPromptSet } from '../../storage/prompt-set-records'

/**
 * `fixes:listProject` (Fixes screen). Every logged fix of the project's open pages and
 * topics, as `fixes:list` returns them per page, and each page's open content-gap rows
 * from its latest coverage matrix: the suggestions not logged as a fix yet.
 */
export function projectFixList(
  db: SqliteDatabase,
  projectId: string,
  pages: readonly PageSummary[],
  input: {
    fixes: readonly LoggedFix[]
    cost: (fix: LoggedFix, samples: number) => { searchesMin: number; searchesMax: number }
  }
): ProjectFixList {
  const order = new Map(pages.map((page, index) => [page.id, index]))
  const byId = new Map(pages.map((page) => [page.id, page]))
  const fixes: ProjectFix[] = input.fixes.map((fix) => ({
    fix,
    ...input.cost(fix, byId.get(fix.pageId)?.samples ?? 1)
  }))
  fixes.sort(
    (left, right) =>
      (order.get(left.fix.pageId) ?? 0) - (order.get(right.fix.pageId) ?? 0) ||
      left.fix.number - right.fix.number
  )
  const suggestions = gapSuggestions(db, pages)
  const used = new Set([
    ...fixes.map((item) => item.fix.pageId),
    ...suggestions.map((item) => item.pageId)
  ])
  return {
    projectId,
    markets: listMarkets(db),
    subjects: pages.filter((page) => used.has(page.id)).map(subjectOf),
    fixes,
    suggestions
  }
}

const PRIORITY = { high: 0, medium: 1, low: 2 }

/** An open gap: below strong, not marked done, with something to do (FR-4.5, FR-4.6). */
export function isOpenGap(row: CoverageRecord): boolean {
  return !row.done && row.coverage !== 'strong' && row.actions.some((action) => action !== 'none')
}

function gapSuggestions(db: SqliteDatabase, pages: readonly PageSummary[]): GapSuggestion[] {
  const brands = readProjectProfile(db)?.brandNames ?? []
  const out: GapSuggestion[] = []
  for (const page of pages) {
    const matrix = getLatestCoverage(db, page.id, null)
    if (matrix === null) continue
    const open = matrix.rows.filter(isOpenGap)
    if (open.length === 0) continue
    const prompts = getLatestPromptSet(db, page.id, brands)?.prompts ?? []
    for (const row of open) {
      const prompt = prompts.find((item) => item.id === row.promptId)
      out.push({
        id: row.id,
        pageId: page.id,
        promptId: row.promptId,
        promptLabel: prompt?.label ?? null,
        promptText: prompt?.variants[0]?.text ?? null,
        coverage: row.coverage,
        priority: row.priority,
        actions: row.actions,
        whatToUpdate: row.whatToUpdate,
        mainGap: row.mainGap
      })
    }
  }
  // Stable: page order is kept inside each priority.
  return out.sort((left, right) => PRIORITY[left.priority] - PRIORITY[right.priority])
}

function subjectOf(page: PageSummary): FixSubject {
  return {
    id: page.id,
    kind: page.kind === 'topic' ? 'topic' : 'page',
    label: page.label ?? page.title ?? page.url ?? page.id,
    url: page.url
  }
}
