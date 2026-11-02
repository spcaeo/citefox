/** Project settings, duplicate, delete, usage, and competitor finding (FR-10.4–10.9, FR-11.4, FR-11.7). */

import type {
  CompetitorFindings,
  Market,
  ProjectClaudeSettings,
  ProjectSearchSettings,
  ProjectTemplateOverride,
  ProjectUsageReport,
  SampleCount
} from '../domain'
import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'
import type {
  AddProjectMarketRequest,
  AddProjectMarketResult,
  ProjectMarketsView,
  RemoveProjectMarketRequest,
  RemoveProjectMarketResult,
  RestoreProjectMarketRequest,
  SetDefaultProjectMarketRequest,
  SetDefaultProjectMarketResult
} from './projectMarkets'
import type { ProjectDetail, ProjectIdRequest } from './projects'

export * from './projectMarkets'

/** The project database file, for the Data section (FR-10.8). */
export interface ProjectDatabaseInfo {
  /** Absolute path of `projects/<slug>.sqlite`. */
  path: string
  bytes: number
  pageCount: number
  /** Runs stored (one per page, market, and check). */
  checkCount: number
}

/** Searches this month for the Searches & cost section (FR-11.4). */
export interface ProjectSearchUsage {
  /** Searches this month across every key. */
  used: number
  /** Cap plus the `allow_10` extra. Null without a cap. */
  allowance: number | null
  /** Straight-line pace to the end of the month. Null before any search this month. */
  projectedMonthEnd: number | null
  /** ISO date (YYYY-MM-DD) of the first day of next month, when the cap resets. */
  resetsOn: string
}

/** `projectSettings:get`. Everything the Project settings screen edits, except schedule and notifications. */
export interface ProjectSettingsView {
  project: ProjectDetail
  /** Every market in the project; the profile's default is first. */
  markets: readonly Market[]
  search: ProjectSearchSettings
  usage: ProjectSearchUsage
  claude: ProjectClaudeSettings
  /** Samples per prompt for new pages in this project (FR-1.5). */
  defaultSamples: SampleCount
  templateOverrides: readonly ProjectTemplateOverride[]
  /** Start a new page's first check by itself once its setup is ready. Default off. */
  checkWhenReady: boolean
  database: ProjectDatabaseInfo
}

/** `projectSettings:update`. Omitted fields stay as they are. */
export interface UpdateProjectSettingsRequest {
  projectId: string
  search?: ProjectSearchSettings
  claude?: ProjectClaudeSettings
  defaultSamples?: SampleCount
  /** Replaces the list. An empty list uses the app defaults for every kind. */
  templateOverrides?: readonly ProjectTemplateOverride[]
  checkWhenReady?: boolean
}

/** `projectSettings:delete`. `confirmName` must equal the project name exactly (FR-10.8). */
export interface DeleteProjectRequest {
  projectId: string
  confirmName: string
}

export interface DeleteProjectResult {
  projectId: string
  /** The project that is active now, or null when no project is left. */
  activeProjectId: string | null
}

/** Invoke channels for this area. Each one is declared here only. */
export const projectSettingsChannels = {
  'projectSettings:get': invokeWith<ProjectIdRequest, ProjectSettingsView>(),
  'projectSettings:update': invokeWith<UpdateProjectSettingsRequest, ProjectSettingsView>(),
  'projectSettings:duplicate': invokeWith<ProjectIdRequest, ProjectDetail>(),
  'projectSettings:delete': invokeWith<DeleteProjectRequest, DeleteProjectResult>(),
  'projectSettings:findCompetitors': invokeWith<ProjectIdRequest, CompetitorFindings>(),
  'projectSettings:usage': invoke<ProjectUsageReport>(),
  'projectSettings:markets': invokeWith<ProjectIdRequest, ProjectMarketsView>(),
  'projectSettings:addMarket': invokeWith<AddProjectMarketRequest, AddProjectMarketResult>(),
  'projectSettings:removeMarket': invokeWith<
    RemoveProjectMarketRequest,
    RemoveProjectMarketResult
  >(),
  'projectSettings:restoreMarket': invokeWith<RestoreProjectMarketRequest, ProjectMarketsView>(),
  'projectSettings:setDefaultMarket': invokeWith<
    SetDefaultProjectMarketRequest,
    SetDefaultProjectMarketResult
  >()
} as const satisfies InvokeChannelSpecs
