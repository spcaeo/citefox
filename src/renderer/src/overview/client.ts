import type {
  ChangeLedger,
  EngineSpendRequest,
  EngineSpendView,
  EngineSummaryRequest,
  EngineSummaryView,
  MetricsRequest,
  MetricsResult,
  StatusCapsule,
  VisibilityOverview,
  VisibilityOverviewRequest,
  ProjectIdRequest
} from '@shared/ipc'
import type { ProjectSearches } from '@shared/page-fixes'

/**
 * The channels the Overview reads: the overview, and each engine's counts for the engine
 * filter. Production uses the preload allow-list (`window.citefox`); tests pass a fake.
 * The widgets' channels are optional: a widget whose channel is absent says so quietly.
 */
export interface OverviewClient {
  'visibility:overview'(request: VisibilityOverviewRequest): Promise<VisibilityOverview>
  /** Absent: Google AI Overview only, no engine filter. */
  'engines:summary'?: (request: EngineSummaryRequest) => Promise<EngineSummaryView>
  /** The searches What to fix rolls up: Next fixes shows its top page fixes. Absent: none. */
  'fixes:searches'?: (request: ProjectIdRequest) => Promise<ProjectSearches>
  /** The shared metrics layer (the same numbers as Reports), per widget engine and scope. */
  'reports:metrics'?: (request: MetricsRequest) => Promise<MetricsResult>
  /** Logged fixes with what each did (Fixes working). */
  'fixes:ledger'?: (request: ProjectIdRequest) => Promise<ChangeLedger>
  /** Searches left (Searches and credits). */
  'status:getCapsule'?: () => Promise<StatusCapsule>
  /** This month's checks and credits (Searches and credits). */
  'engines:spend'?: (request: EngineSpendRequest) => Promise<EngineSpendView>
}

export function createOverviewClient(): OverviewClient {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'visibility:overview': async (request) => requireApi()['visibility:overview'](request),
    'engines:summary': async (request) => requireApi()['engines:summary'](request),
    'fixes:searches': async (request) => requireApi()['fixes:searches'](request),
    'reports:metrics': async (request) => requireApi()['reports:metrics'](request),
    'fixes:ledger': async (request) => requireApi()['fixes:ledger'](request),
    'status:getCapsule': async () => requireApi()['status:getCapsule'](),
    'engines:spend': async (request) => requireApi()['engines:spend'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
