import type {
  DeliveryRecord,
  DueList,
  EmailSettings,
  ProjectUsageReport,
  QueueStatus
} from '@shared/domain'
import type {
  ActiveJobsRequest,
  AppSettingsSnapshot,
  CheckJob,
  ConnectionsOverview,
  DueListRequest,
  ProjectList,
  ListDeliveriesRequest,
  QueuePauseRequest,
  StatusCapsule
} from '@shared/ipc'

/**
 * The existing channels the Status screen reads (FR-24.1–24.5). The capsule
 * and the overview are the same payloads the sidebar capsule uses, so the
 * searches-left number matches it. The jobs, due pages, usage and projects
 * feed the drill-downs. Tests pass another `StatusSource`.
 */
export interface StatusSource {
  'status:getCapsule'(): Promise<StatusCapsule>
  'connections:getOverview'(): Promise<ConnectionsOverview>
  'settings:get'(): Promise<AppSettingsSnapshot>
  'queue:getStatus'(): Promise<QueueStatus>
  'queue:pause'(request: QueuePauseRequest): Promise<QueueStatus>
  'queue:resume'(): Promise<QueueStatus>
  'queue:status'(listener: (payload: QueueStatus) => void): () => void
  'email:getSettings'(): Promise<EmailSettings>
  'deliveries:list'(request: ListDeliveriesRequest): Promise<readonly DeliveryRecord[]>
  'checks:listActive'(request: ActiveJobsRequest): Promise<readonly CheckJob[]>
  'schedule:listDue'(request: DueListRequest): Promise<DueList>
  'projectSettings:usage'(): Promise<ProjectUsageReport>
  'projects:list'(): Promise<ProjectList>
}

export function createStatusSource(): StatusSource {
  return {
    'status:getCapsule': () => requireApi()['status:getCapsule'](),
    'connections:getOverview': () => requireApi()['connections:getOverview'](),
    'settings:get': () => requireApi()['settings:get'](),
    'queue:getStatus': () => requireApi()['queue:getStatus'](),
    'queue:pause': (request) => requireApi()['queue:pause'](request),
    'queue:resume': () => requireApi()['queue:resume'](),
    'queue:status': (listener) => requireApi()['queue:status'](listener),
    'email:getSettings': () => requireApi()['email:getSettings'](),
    'deliveries:list': (request) => requireApi()['deliveries:list'](request),
    'checks:listActive': (request) => requireApi()['checks:listActive'](request),
    'schedule:listDue': (request) => requireApi()['schedule:listDue'](request),
    'projectSettings:usage': () => requireApi()['projectSettings:usage'](),
    'projects:list': () => requireApi()['projects:list']()
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
