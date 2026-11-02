import type { GridCsvExport, GridViewsAdapter } from './types'

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

/** FR-21.2. Saved views for one grid in one project, through `grid:*` IPC. */
export function createGridViewsAdapter(projectId: string, grid: string): GridViewsAdapter {
  return {
    list: async () => (await requireApi()['grid:listViews']({ projectId, grid })).views,
    save: async (id, name, state) =>
      requireApi()['grid:saveView']({ projectId, grid, id, name, state }),
    remove: async (viewId) => {
      await requireApi()['grid:deleteView']({ projectId, viewId })
    }
  }
}

/** FR-21.1, FR-21.8. Export CSV through `grid:exportCsv`. */
export function createGridCsvExport(): GridCsvExport {
  return async (request) => requireApi()['grid:exportCsv'](request)
}
