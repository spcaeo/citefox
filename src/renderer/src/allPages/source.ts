import type { DueList, PageResults } from '@shared/domain'
import type {
  AllPagesData,
  ClusterSummaryList,
  GetResultsRequest,
  BulkActionRequest,
  BulkActionResult,
  BulkEstimate,
  CitationReview,
  FixIdRequest,
  IgnoreUrlRequest,
  IgnoreUrlResult,
  MergePagesRequest,
  MergePagesResult,
  PointPromptRequest,
  PointPromptResult,
  PointPromptUndo,
  TrackUrlRequest,
  TrackUrlResult,
  UndoPointRequest,
  UndoTrackRequest,
  SetPageRoleRequest,
  UpdatePageRequest
} from '@shared/ipc'
import { createGridCsvExport, createGridViewsAdapter } from '../grid'
import type { GridCsvExport, GridViewsAdapter } from '../grid'

/**
 * The channels All pages uses (SRS 4.20). Production is the preload
 * allow-list; the mock build and tests pass another source.
 */
export interface AllPagesSource {
  list(projectId: string): Promise<AllPagesData>
  citations(projectId: string): Promise<CitationReview>
  estimate(request: BulkActionRequest): Promise<BulkEstimate>
  run(request: BulkActionRequest): Promise<BulkActionResult>
  pointHere(request: PointPromptRequest): Promise<PointPromptResult>
  undoPoint(request: UndoPointRequest): Promise<PointPromptUndo>
  merge(request: MergePagesRequest): Promise<MergePagesResult>
  undoMerge(request: FixIdRequest): Promise<{ fixId: string }>
  trackUrl(request: TrackUrlRequest): Promise<TrackUrlResult>
  undoTrack(request: UndoTrackRequest): Promise<{ pageId: string }>
  /** Pause, resume or rename one page (`pages:update`). Absent: those row actions are left out. */
  updatePage?: (request: UpdatePageRequest) => Promise<unknown>
  /** Stop tracking one page (`pages:remove`; history stays). Undo is `undoTrack`. */
  removePage?: (request: { projectId: string; pageId: string }) => Promise<unknown>
  /** Pillar or supporting in the page's cluster (`structure:setPageRole`). */
  setPageRole?: (request: SetPageRoleRequest) => Promise<unknown>
  ignoreUrl(request: IgnoreUrlRequest): Promise<IgnoreUrlResult>
  /** One page's check, for the drawers behind the grid's numbers (`results:get`). */
  results(request: GetResultsRequest): Promise<PageResults>
  /** Pages due today (`schedule:listDue`), for the Due today tile. */
  due(projectId: string): Promise<DueList>
  /** The cluster table (`structure:clusterSummary`, Mockups/Home.dc.html "Clusters"). */
  clusters(projectId: string): Promise<ClusterSummaryList>
  /** Saved views for one grid in one project. Null hides saving. */
  views(projectId: string, grid: string): GridViewsAdapter | null
  exportCsv: GridCsvExport | null
}

/** Clusters the All pages table lists; "Site structure" shows the rest. */
export const CLUSTER_LIMIT = 8

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

export function createAllPagesSource(): AllPagesSource {
  return {
    list: async (projectId) => requireApi()['allpages:list']({ projectId }),
    citations: async (projectId) => requireApi()['allpages:citations']({ projectId }),
    estimate: async (request) => requireApi()['allpages:estimate'](request),
    run: async (request) => requireApi()['allpages:run'](request),
    pointHere: async (request) => requireApi()['allpages:pointHere'](request),
    undoPoint: async (request) => requireApi()['allpages:undoPoint'](request),
    merge: async (request) => requireApi()['allpages:merge'](request),
    undoMerge: async (request) => requireApi()['allpages:undoMerge'](request),
    trackUrl: async (request) => requireApi()['allpages:trackUrl'](request),
    undoTrack: async (request) => requireApi()['allpages:undoTrack'](request),
    updatePage: async (request) => requireApi()['pages:update'](request),
    removePage: async (request) => requireApi()['pages:remove'](request),
    setPageRole: async (request) => requireApi()['structure:setPageRole'](request),
    ignoreUrl: async (request) => requireApi()['allpages:ignoreUrl'](request),
    results: async (request) => requireApi()['results:get'](request),
    due: async (projectId) => requireApi()['schedule:listDue']({ projectId }),
    clusters: async (projectId) =>
      requireApi()['structure:clusterSummary']({ projectId, limit: CLUSTER_LIMIT }),
    views: (projectId, grid) => createGridViewsAdapter(projectId, grid),
    exportCsv: createGridCsvExport()
  }
}
