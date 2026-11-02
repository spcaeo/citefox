import type { PageSummary } from '@shared/domain'
import type {
  CitationReview,
  UntrackedCitation,
  UntrackedCitationRef,
  WrongPageCase
} from '@shared/ipc'
import { listIgnoredCitations } from '../../storage/ignored-citations'
import { listPageMarketSchedules, listPages } from '../../storage/pages'
import { loadPageResults, trackedPageMap } from '../checks/results'
import { normalizeUrl } from '../checks/url'
import { enabledPromptCounts } from './rows'
import { citationNoise } from './noise'
import type { AllPagesPass } from './pass'

const WORKING = new Set(['tracked', 'setting_up', 'paused'])
const REVIEWED = new Set(['tracked', 'paused'])

/**
 * `allpages:citations` (FR-20.4, FR-20.5). The latest full check of every
 * tracked page, in every market it has. Reads the same Results the page screens
 * draw: a prompt whose status is "Other own page" is a wrong-page case, and
 * Results' cannibalizing list gives the own URLs cited next to or instead of
 * the tracked page.
 */
export function loadCitationReview(pass: AllPagesPass): CitationReview {
  const { db, project } = pass
  const pages = listPages(db, project.id)
  const tracked = trackedPageMap(pages)
  const byNormalized = new Map<string, PageSummary>()
  for (const page of pages) {
    if (page.url === null) continue
    const normalized = normalizeUrl(page.url)
    if (normalized !== null) byNormalized.set(normalized, page)
  }
  const ready = enabledPromptCounts(db)
  const markets = listPageMarketSchedules(db)
  const ignored = listIgnoredCitations(db)
  const wrongPage: WrongPageCase[] = []
  const untracked = new Map<string, { url: string; refs: UntrackedCitationRef[] }>()
  for (const page of pages) {
    if (!REVIEWED.has(page.status)) continue
    // A topic has no single page, so it has no wrong-page or untracked review here.
    if (page.url === null) continue
    const pageUrl = page.url
    for (const market of markets.get(page.id) ?? []) {
      if (market.lastCheckedAt === null) continue
      const results = loadPageResults(db, {
        projectId: project.id,
        pageId: page.id,
        marketId: market.marketId,
        runId: null,
        builtAt: pass.now.toISOString(),
        domain: project.domain,
        keyLabels: new Map(),
        trackedPages: tracked
      })
      const run = results.run
      if (run === null) continue
      const promptById = new Map(results.prompts.map((row) => [row.promptId, row]))
      for (const row of results.prompts) {
        if (!row.wrongPageCited || row.citedUrl === null) continue
        const normalized =
          row.references.find((reference) => reference.url === row.citedUrl)?.normalizedUrl ??
          normalizeUrl(row.citedUrl)
        const cited = normalized === null ? undefined : byNormalized.get(normalized)
        wrongPage.push({
          id: `${page.id}|${market.marketId}|${row.promptId}`,
          pageId: page.id,
          pageUrl,
          pageLabel: page.label ?? page.title ?? pageUrl,
          marketId: market.marketId,
          promptId: row.promptId,
          promptLabel: row.label,
          promptText: row.text,
          citedUrl: row.citedUrl,
          citedPageId: cited?.id ?? null,
          citedPageReady: cited !== undefined && (ready.get(cited.id) ?? 0) > 0,
          position: row.position,
          runId: run.runId,
          checkedAt: run.finishedAt
        })
      }
      for (const cannibal of results.cannibalizing) {
        const current = byNormalized.get(cannibal.normalizedUrl)
        if (current !== undefined && WORKING.has(current.status)) continue
        const entry = untracked.get(cannibal.normalizedUrl) ?? { url: cannibal.url, refs: [] }
        for (const hit of cannibal.prompts) {
          const prompt = promptById.get(hit.promptId)
          entry.refs.push({
            pageId: page.id,
            pageLabel: page.label ?? page.title ?? pageUrl,
            marketId: market.marketId,
            promptId: hit.promptId,
            promptLabel: prompt?.label ?? hit.promptId,
            promptPosition: prompt?.promptPosition ?? 0,
            position: hit.position,
            runId: run.runId
          })
        }
        untracked.set(cannibal.normalizedUrl, entry)
      }
    }
  }
  const untrackedList: UntrackedCitation[] = [...untracked.entries()].map(
    ([normalizedUrl, entry]) => ({
      url: entry.url,
      normalizedUrl,
      pageId: byNormalized.get(normalizedUrl)?.id ?? null,
      citations: entry.refs.length,
      citedFor: new Set(entry.refs.map((ref) => ref.pageId)).size,
      refs: entry.refs,
      noise: citationNoise(entry.url),
      ignored: ignored.has(normalizedUrl)
    })
  )
  untrackedList.sort(
    (left, right) =>
      Number(left.ignored) - Number(right.ignored) ||
      Number(left.noise !== null) - Number(right.noise !== null) ||
      right.citations - left.citations ||
      left.normalizedUrl.localeCompare(right.normalizedUrl)
  )
  return {
    wrongPage,
    wrongPagePages: new Set(wrongPage.map((item) => item.pageId)).size,
    untracked: untrackedList
  }
}
