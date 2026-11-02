import { REPORT_SECTIONS } from '@shared/domain'
import type {
  ApiKeyMetadata,
  CompetitorFindings,
  ConnectionActivity,
  ConnectionActivityLog,
  ExportStartResult,
  ProjectClaudeRow,
  ProjectUsageReport
} from '@shared/domain'
import type {
  CiteFoxApi,
  DeleteProjectRequest,
  DeleteProjectResult,
  ExportRequest,
  ProjectDetail,
  ProjectIdRequest,
  ProjectSettingsView,
  ReorderKeysRequest,
  UpdateKeyRequest,
  UpdateProjectSettingsRequest
} from '@shared/ipc'

/**
 * Project settings, usage, and multi-key Connections (FR-10.4–10.9, FR-11.1–11.10).
 * Method names are local. Argument and result types are the IPC contract.
 */
export interface AdminClient {
  getProjectSettings(request: ProjectIdRequest): Promise<ProjectSettingsView>
  updateProjectSettings(request: UpdateProjectSettingsRequest): Promise<ProjectSettingsView>
  duplicateProject(request: ProjectIdRequest): Promise<ProjectDetail>
  deleteProject(request: DeleteProjectRequest): Promise<DeleteProjectResult>
  findCompetitors(request: ProjectIdRequest): Promise<CompetitorFindings>
  projectUsage(): Promise<ProjectUsageReport>
  connectionActivity(): Promise<ConnectionActivity>
  /** FR-11.10 drill-down rows. Optional so older fakes still type-check. */
  connectionActivityLog?(): Promise<ConnectionActivityLog>
  projectClaude(): Promise<readonly ProjectClaudeRow[]>
  listKeys(): Promise<ApiKeyMetadata[]>
  updateKey(request: UpdateKeyRequest): Promise<ApiKeyMetadata>
  reorderKeys(request: ReorderKeysRequest): Promise<ApiKeyMetadata[]>
  /** FR-10.8 Export project: `exports:start` with the project scope and JSON format. */
  exportProject(request: ExportRequest): Promise<ExportStartResult>
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

export function createLiveAdminClient(): AdminClient {
  return {
    getProjectSettings: (request) => requireApi()['projectSettings:get'](request),
    updateProjectSettings: (request) => requireApi()['projectSettings:update'](request),
    duplicateProject: (request) => requireApi()['projectSettings:duplicate'](request),
    deleteProject: (request) => requireApi()['projectSettings:delete'](request),
    findCompetitors: (request) => requireApi()['projectSettings:findCompetitors'](request),
    projectUsage: () => requireApi()['projectSettings:usage'](),
    connectionActivity: () => requireApi()['connections:activity'](),
    connectionActivityLog: () => requireApi()['connections:activityLog'](),
    projectClaude: () => requireApi()['connections:projectClaude'](),
    listKeys: () => requireApi()['keys:list'](),
    updateKey: (request) => requireApi()['keys:update'](request),
    reorderKeys: (request) => requireApi()['keys:reorder'](request),
    exportProject: (request) => requireApi()['exports:start'](request)
  }
}

/**
 * The JSON export of a whole project (FR-10.8, section 9.2): every check, every section
 * including raw SerpApi data, in every project market, in the shared export schema.
 * Never secrets.
 */
export function projectExportRequest(
  projectId: string,
  marketIds: readonly string[],
  timeZone: string
): ExportRequest {
  return {
    projectId,
    scope: 'project',
    pageIds: [],
    viewId: null,
    marketIds,
    checks: 'all',
    from: null,
    to: null,
    sections: [...REPORT_SECTIONS, 'raw'],
    format: 'json',
    pdf: null,
    xlsx: null,
    csv: null,
    filenamePattern: '{project}-{date}.{ext}',
    timeZone,
    logoBase64: null
  }
}
