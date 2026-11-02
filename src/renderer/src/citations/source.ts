import type { CitedPagesData } from '@shared/ipc'
import type { CompetitorsSource } from '../competitors/source'
import type { ProjectFixesSource } from '../fixes/source'

/**
 * The channels the project-wide Citations screen uses: every search of the
 * project for the Pages view (`fixes:searches`), the cited pages for the List
 * (`allpages:citedPages`) and "Add as competitor" with its Undo (the same
 * `competitors:save` / `competitors:restore` the Competitors screen uses).
 * Production uses the preload allow-list; tests pass a fake.
 */
export interface CitationsSource
  extends
    Pick<CompetitorsSource, 'competitors:save' | 'competitors:restore'>,
    Pick<ProjectFixesSource, 'fixes:searches'> {
  'allpages:citedPages'(request: { projectId: string }): Promise<CitedPagesData>
}

export function createCitationsSource(): CitationsSource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'allpages:citedPages': async (request) => requireApi()['allpages:citedPages'](request),
    'fixes:searches': async (request) => requireApi()['fixes:searches'](request),
    'competitors:save': async (request) => requireApi()['competitors:save'](request),
    'competitors:restore': async (request) => requireApi()['competitors:restore'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
