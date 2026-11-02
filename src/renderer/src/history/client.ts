import type { ContentDiff, PageHistory, PageNote, PageResults } from '@shared/domain'
import type {
  AddNoteRequest,
  CheckJob,
  CheckJobIdRequest,
  CheckRunIdRequest,
  CompareContentRequest,
  DeletedCheck,
  DeletedNote,
  GetResultsRequest,
  GridCsvRequest,
  GridCsvResult,
  HistoryListRequest,
  NoteIdRequest,
  ProjectHistory,
  ProjectIdRequest,
  StartCheckRequest,
  UpdateNoteRequest
} from '@shared/ipc'

/**
 * One method per history channel. Request and result types are the shared contract.
 * Production uses the preload allow-list (`window.citefox`); tests pass a fake.
 */
export interface HistorySource {
  'history:list'(request: HistoryListRequest): Promise<PageHistory>
  'history:compare'(request: CompareContentRequest): Promise<ContentDiff>
  'history:addNote'(request: AddNoteRequest): Promise<PageNote>
  'history:updateNote'(request: UpdateNoteRequest): Promise<PageNote>
  'history:deleteNote'(request: NoteIdRequest): Promise<DeletedNote>
}

export function createHistorySource(): HistorySource {
  return {
    'history:list': (request) => requireApi()['history:list'](request),
    'history:compare': (request) => requireApi()['history:compare'](request),
    'history:addNote': (request) => requireApi()['history:addNote'](request),
    'history:updateNote': (request) => requireApi()['history:updateNote'](request),
    'history:deleteNote': (request) => requireApi()['history:deleteNote'](request)
  }
}

/** "Compare content" of two page reads: all CompareDialog needs. */
export type CompareSource = Pick<HistorySource, 'history:compare'>

/**
 * The project-level Check history screen's channels: every check of the project,
 * a check's results (Compare, the number drills), re-run and cancel, delete, CSV,
 * and "Compare content" for two checks of the same page.
 */
export interface ProjectHistorySource extends CompareSource {
  'history:listProject'(request: ProjectIdRequest): Promise<ProjectHistory>
  'history:delete'(request: CheckRunIdRequest): Promise<DeletedCheck>
  'results:get'(request: GetResultsRequest): Promise<PageResults>
  /** Resolves when the job ends: never awaited by the screen. */
  'checks:start'(request: StartCheckRequest): Promise<CheckJob>
  'checks:cancel'(request: CheckJobIdRequest): Promise<CheckJob>
  'grid:exportCsv'(request: GridCsvRequest): Promise<GridCsvResult>
}

export function createProjectHistorySource(): ProjectHistorySource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'history:listProject': async (request) => requireApi()['history:listProject'](request),
    'history:compare': async (request) => requireApi()['history:compare'](request),
    'history:delete': async (request) => requireApi()['history:delete'](request),
    'results:get': async (request) => requireApi()['results:get'](request),
    'checks:start': async (request) => requireApi()['checks:start'](request),
    'checks:cancel': async (request) => requireApi()['checks:cancel'](request),
    'grid:exportCsv': async (request) => requireApi()['grid:exportCsv'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
