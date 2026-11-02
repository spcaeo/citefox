import type { GenerationTemplate, Market } from '@shared/domain'
import type {
  CiteFoxApi,
  CreateTemplateRequest,
  LlmCallList,
  LlmCallsRequest,
  ListTemplatesRequest,
  PageIdRequest,
  PageList,
  ProjectIdRequest,
  SaveTemplateOverrideRequest,
  TemplateIdRequest,
  TemplateKindRequest,
  TemplateStep,
  TemplateStepsRequest,
  TemplateUsage,
  TemplateUsageDetail,
  TemplateUsageRequest,
  TemplateVersionEntry,
  TemplateVersionsRequest,
  TryTemplateRequest,
  TryTemplateResult,
  UpdateTemplateRequest,
  UpdateTemplateResult
} from '@shared/ipc'
import { type ClientMode } from '../onboarding/flags'

/**
 * The template channels.
 * Argument and result types are the IPC contract. The mock is for dev and e2e builds only.
 * Reset still calls the deprecated `templates:reset` alias.
 */
export interface TemplatesClient {
  list(request?: ListTemplatesRequest): Promise<readonly GenerationTemplate[]>
  get(request: TemplateIdRequest): Promise<GenerationTemplate>
  create(request: CreateTemplateRequest): Promise<GenerationTemplate>
  update(request: UpdateTemplateRequest): Promise<UpdateTemplateResult>
  reset(request: TemplateIdRequest): Promise<GenerationTemplate>
  delete(request: TemplateIdRequest): Promise<GenerationTemplate>
  restore(request: TemplateIdRequest): Promise<GenerationTemplate>
  setDefault(request: TemplateIdRequest): Promise<GenerationTemplate>
  usage(request: TemplateUsageRequest): Promise<TemplateUsage>
  /** The saved artifacts behind `usage`, for its drill-down. */
  usageDetail(request: TemplateUsageRequest): Promise<TemplateUsageDetail>
  /** The logged Claude calls of one step (`llm:calls`), behind "Last run". */
  calls(request: LlmCallsRequest): Promise<LlmCallList>
  /** FR-26.1. Every Claude step in run order, with its status for the open project. */
  steps(request: TemplateStepsRequest): Promise<readonly TemplateStep[]>
  saveOverride(request: SaveTemplateOverrideRequest): Promise<TemplateStep>
  resetOverride(request: TemplateKindRequest): Promise<TemplateStep>
  resetToShipped(request: TemplateIdRequest): Promise<UpdateTemplateResult>
  versions(request: TemplateVersionsRequest): Promise<readonly TemplateVersionEntry[]>
  try(request: TryTemplateRequest): Promise<TryTemplateResult>
  /** Try it's page list: the open project's working pages (`pages:list`). */
  pages(request: ProjectIdRequest): Promise<PageList>
  /** Try it's market list: the page's markets (`pages:get`). */
  pageMarkets(request: PageIdRequest): Promise<readonly Market[]>
}

export function createTemplatesClient(mode: ClientMode): TemplatesClient {
  // The guard is written inline (see `mocksAllowed`) so a release build drops the mock chunk.
  if (mode === 'mock' && (import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1')) {
    return createMockTemplatesClient()
  }
  return createIpcTemplatesClient()
}

/** The mock module loads on first use, so it stays out of the main bundle. */
export function createMockTemplatesClient(): TemplatesClient {
  const mock = async (): Promise<typeof import('../mocks/m2/templates')> =>
    import('../mocks/m2/templates')
  const steps = async (): Promise<typeof import('../mocks/m2/templateSteps')> =>
    import('../mocks/m2/templateSteps')
  const drills = async (): Promise<typeof import('./mockDrill')> => import('./mockDrill')
  return {
    list: async (request = {}) => (await mock()).listTemplates(request),
    get: async (request) => (await mock()).getTemplate(request),
    create: async (request) => (await mock()).createTemplate(request),
    update: async (request) => (await mock()).updateTemplate(request),
    reset: async (request) => (await mock()).resetTemplate(request),
    delete: async (request) => (await mock()).deleteTemplate(request),
    restore: async (request) => (await mock()).restoreTemplate(request),
    setDefault: async (request) => (await mock()).setDefaultTemplate(request),
    usage: async (request) => (await mock()).templateUsage(request),
    usageDetail: async (request) => (await drills()).mockUsageDetail(request),
    calls: async (request) => (await drills()).mockStepCalls(request),
    steps: async (request) => (await steps()).listTemplateSteps(request),
    saveOverride: async (request) => (await steps()).saveTemplateOverride(request),
    resetOverride: async (request) => (await steps()).resetTemplateOverride(request),
    resetToShipped: async (request) => (await mock()).resetTemplateToShipped(request),
    versions: async (request) => (await steps()).listTemplateVersions(request),
    try: async (request) => (await steps()).tryTemplate(request),
    pages: async (request) => (await steps()).listTryPages(request),
    pageMarkets: async (request) => (await steps()).listTryMarkets(request)
  }
}

function createIpcTemplatesClient(): TemplatesClient {
  return {
    list: (request = {}) => requireApi()['templates:list'](request),
    get: (request) => requireApi()['templates:get'](request),
    create: (request) => requireApi()['templates:create'](request),
    update: (request) => requireApi()['templates:update'](request),
    reset: (request) => requireApi()['templates:reset'](request),
    delete: (request) => requireApi()['templates:delete'](request),
    restore: (request) => requireApi()['templates:restore'](request),
    setDefault: (request) => requireApi()['templates:setDefault'](request),
    usage: (request) => requireApi()['templates:usage'](request),
    usageDetail: (request) => requireApi()['templates:usageDetail'](request),
    calls: (request) => requireApi()['llm:calls'](request),
    steps: (request) => requireApi()['templates:steps'](request),
    saveOverride: (request) => requireApi()['templates:saveOverride'](request),
    resetOverride: (request) => requireApi()['templates:resetOverride'](request),
    resetToShipped: (request) => requireApi()['templates:resetToShipped'](request),
    versions: (request) => requireApi()['templates:versions'](request),
    try: (request) => requireApi()['templates:try'](request),
    pages: (request) => requireApi()['pages:list'](request),
    pageMarkets: async (request) => (await requireApi()['pages:get'](request)).markets
  }
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
