import type {
  CiteFoxApi,
  DeleteProjectRequest,
  DeleteProjectResult,
  ExportProjectRequest,
  ExportProjectResult,
  ExportSettingsResult,
  ImportProjectRequest,
  ProjectImportPreview,
  ProjectImportResult,
  ProjectTransferSummary,
  SettingsImportPreview,
  SettingsTransferFieldResult,
  TransferMenuEvent,
  TransferPickResult
} from '@shared/ipc'

/**
 * Moving to a new Mac (export and import a project, the app settings). Main
 * opens every dialog; the renderer only ever holds a token for a picked file.
 */
export interface TransferClient {
  projectSummary(projectId: string): Promise<ProjectTransferSummary>
  exportProject(request: ExportProjectRequest): Promise<ExportProjectResult>
  pickProject(): Promise<TransferPickResult>
  projectPreview(token: string): Promise<ProjectImportPreview>
  importProject(request: ImportProjectRequest): Promise<ProjectImportResult>
  /** Undo an import as new: the same delete as Projects › Delete. */
  deleteProject(request: DeleteProjectRequest): Promise<DeleteProjectResult>
  exportSettings(): Promise<ExportSettingsResult>
  pickSettings(): Promise<TransferPickResult>
  settingsPreview(token: string): Promise<SettingsImportPreview>
  applySettings(token: string): Promise<readonly SettingsTransferFieldResult[]>
  /** File menu commands. Returns the unsubscribe. */
  onMenu(listener: (event: TransferMenuEvent) => void): () => void
}

function api(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

export function createTransferClient(): TransferClient {
  return {
    projectSummary: (projectId) => api()['transfer:projectSummary']({ projectId }),
    exportProject: (request) => api()['transfer:exportProject'](request),
    pickProject: () => api()['transfer:pickProject'](),
    projectPreview: (token) => api()['transfer:projectPreview']({ token }),
    importProject: (request) => api()['transfer:importProject'](request),
    deleteProject: (request) => api()['projectSettings:delete'](request),
    exportSettings: () => api()['transfer:exportSettings'](),
    pickSettings: () => api()['transfer:pickSettings'](),
    settingsPreview: (token) => api()['transfer:settingsPreview']({ token }),
    applySettings: (token) => api()['transfer:applySettings']({ token }),
    onMenu: (listener) => {
      if (
        typeof window === 'undefined' ||
        typeof window.citefox?.['transfer:menu'] !== 'function'
      ) {
        return () => undefined
      }
      return window.citefox['transfer:menu'](listener)
    }
  }
}

let shared: TransferClient | null = null

/** The preload client, or a test's fake set with {@link setTransferClient}. */
export function transferClient(): TransferClient {
  shared ??= createTransferClient()
  return shared
}

export function setTransferClient(client: TransferClient | null): void {
  shared = client
}
