import type { ApiKeyMetadata, ProjectSchedule } from '@shared/domain'
import type {
  EngineEstimate,
  EngineEstimateRequest,
  EngineSpendRequest,
  EngineSpendView,
  ProjectIdRequest
} from '@shared/ipc'

/** What the "This month" box reads. Tests pass a fake. */
export interface MonthSpendSource {
  'engines:spend'(request: EngineSpendRequest): Promise<EngineSpendView>
  'engines:estimate'(request: EngineEstimateRequest): Promise<EngineEstimate>
  'keys:list'(): Promise<ApiKeyMetadata[]>
  'schedule:getProject'(request: ProjectIdRequest): Promise<ProjectSchedule>
}

/** The live channels, or null without the preload bridge (unit tests of the rest of the screen). */
export function createMonthSpendSource(): MonthSpendSource | null {
  if (typeof window === 'undefined' || !window.citefox) return null
  const api = window.citefox
  return {
    'engines:spend': async (request) => api['engines:spend'](request),
    'engines:estimate': async (request) => api['engines:estimate'](request),
    'keys:list': async () => api['keys:list'](),
    'schedule:getProject': async (request) => api['schedule:getProject'](request)
  }
}
