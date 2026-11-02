import type { PageSummary } from '@shared/domain'
import type { PageList } from '@shared/ipc'

/** The page whose latest check the AI summary preview is written from. */
export interface SummaryPage {
  id: string
  name: string
}

/** Finds the page for a project's summary preview. Null: no checked page yet. */
export type SummaryPageLookup = (projectId: string) => Promise<SummaryPage | null>

/**
 * `report.summary` reads one page's latest check, so the preview uses the
 * project's first checked page (a score means a finished check). Topics have
 * no single page and are left out.
 */
export function pickSummaryPage(pages: readonly PageSummary[]): SummaryPage | null {
  const page = pages.find((item) => item.kind !== 'topic' && item.score !== null)
  if (!page) return null
  return { id: page.id, name: page.title ?? page.label ?? page.url ?? page.id }
}

export function summaryPageLookup(
  listPages: (request: { projectId: string }) => Promise<PageList>
): SummaryPageLookup {
  return async (projectId) => pickSummaryPage((await listPages({ projectId })).pages)
}
