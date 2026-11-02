import type { GridViewState, SavedGridView } from '@shared/domain'
import type { AllPageRow, AllPagesData, BulkEstimate } from '@shared/ipc'
import { estimateRange } from './utils/format'
import type { ShellClient } from '../projects/client'
import type { AllPagesSource } from './source'
import { pluralize } from '@shared/pluralize'

/**
 * All pages from the shell client's channels, for the mock build and the Vite
 * harness. Rows are the working pages `pages:list` returns with their
 * `scores:listPages` numbers. Citation review is empty; bulk actions only
 * report their estimate. Saved views live in memory for the session.
 */
export function createShellAllPagesSource(client: ShellClient): AllPagesSource {
  const views: SavedGridView[] = []
  let sequence = 0
  return {
    async list(projectId) {
      const [project, pages, scores] = await Promise.all([
        client.getProject({ projectId }),
        client.listPages({ projectId }),
        client.listPageScores({ projectId })
      ])
      const byId = new Map(scores.pages.map((page) => [page.pageId, page]))
      const rows: AllPageRow[] = pages.pages.map((page) => {
        const score = byId.get(page.id)
        return {
          id: page.id,
          // pages:list holds pages only; topics have their own list.
          url: page.url ?? '',
          title: page.title,
          label: page.label,
          folder: page.folder,
          status: page.status,
          setupStep: page.setupStep,
          pinned: page.pinned,
          intervalDays: page.intervalDays,
          samples: page.samples,
          promptCount: page.promptCount,
          defaultMarketId: page.defaultMarketId,
          marketIds: page.defaultMarketId === null ? [] : [page.defaultMarketId],
          score: page.score,
          change: score?.change ?? null,
          pageCited: null,
          aioPrompts: null,
          citations: null,
          lastCheckedAt: score?.lastCheckedAt ?? null,
          nextCheckAt: score?.nextCheckAt ?? null,
          clusters: null,
          groups: null
        }
      })
      const data: AllPagesData = {
        projectId,
        domain: project.domain,
        foundPageCount: project.foundPageCount,
        trackedPageCount: project.trackedPageCount,
        markets: project.defaultMarket ? [project.defaultMarket] : [],
        defaultMarketId: project.defaultMarket?.id ?? null,
        summary: scores.summary,
        searchesLeft:
          scores.summary.searchCap === null
            ? null
            : Math.max(0, scores.summary.searchCap - scores.summary.searchesUsed),
        groups: null,
        rows
      }
      return data
    },
    citations: async () => ({ wrongPage: [], wrongPagePages: 0, untracked: [] }),
    async estimate(request) {
      const pages = await client.listPages({ projectId: request.projectId })
      const chosen = pages.pages.filter((page) => request.pageIds.includes(page.id))
      const units = chosen.reduce((sum, page) => sum + page.promptCount * page.samples, 0)
      const estimate: BulkEstimate = {
        action: request.action,
        selected: request.pageIds.length,
        eligible: chosen.length,
        skipped: [],
        minSearches: request.action === 'check' ? units : 0,
        maxSearches: request.action === 'check' ? units * 2 : 0,
        timing: request.action === 'check' ? 'now' : 'none',
        searchesLeft: null,
        summary:
          request.action === 'check'
            ? `Checking ${pluralize(chosen.length, 'page')} now uses about ${estimateRange(units, units * 2)} searches.`
            : 'This sample does not change pages.'
      }
      return estimate
    },
    run: async (request) => ({
      action: request.action,
      changed: 0,
      skipped: request.pageIds.length,
      message: 'This sample does not change pages.',
      jobId: null
    }),
    pointHere: async () => ({
      ok: false,
      message: 'This sample has no citation data.',
      nextStep: 'Open a real project.'
    }),
    undoPoint: async (request) => request,
    merge: async () => {
      throw new Error('This sample has no citation data.')
    },
    undoMerge: async (request) => ({ fixId: request.fixId }),
    trackUrl: async () => {
      throw new Error('This sample has no citation data.')
    },
    undoTrack: async (request) => ({ pageId: request.pageId }),
    updatePage: (request) => client.updatePage(request),
    removePage: (request) => client.removePage(request),
    ignoreUrl: async (request) => ({ normalizedUrl: request.url, ignored: request.ignored }),
    results: async () => {
      throw new Error('This sample has no check data.')
    },
    due: async () => {
      // No scheduler here: the Due today tile keeps the summary number.
      throw new Error('This sample has no schedule.')
    },
    clusters: async () => ({ clusters: [], totalClusters: 0 }),
    views: (_projectId, grid) => ({
      list: async () => views.filter((view) => view.grid === grid),
      save: async (id, name, state: GridViewState) => {
        sequence += 1
        const at = new Date().toISOString()
        const view: SavedGridView = {
          id: id ?? `view-${sequence}`,
          grid,
          name,
          state,
          createdAt: at,
          updatedAt: at
        }
        const index = views.findIndex((item) => item.id === view.id)
        if (index >= 0) views[index] = view
        else views.push(view)
        return view
      },
      remove: async (id) => {
        const index = views.findIndex((item) => item.id === id)
        if (index >= 0) views.splice(index, 1)
      }
    }),
    exportCsv: async (request) => ({
      ok: true,
      rowCount: request.rows.length,
      columnCount: request.header.length,
      fileName: request.fileName
    })
  }
}
