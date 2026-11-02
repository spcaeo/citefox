import type {
  CreateTopicsRequest,
  CreateTopicsResult,
  HelpFillEstimate,
  HelpFillPrompt,
  HelpFillResult,
  HelpFillSetupPromptRequest,
  HelpFillSetupReadRequest
} from '@shared/ipc'

/**
 * The channels New project's setup helper uses: the "Read my website" cost, the
 * one multi-section prompt and reading its answer (`helpfill:setup*`, no project
 * yet), and creating the ticked questions as topics once the project exists.
 * Production passes the preload bridge; tests a fake.
 */
export interface SetupHelpSource {
  'helpfill:setupEstimate'(): Promise<HelpFillEstimate>
  'helpfill:setupPrompt'(request: HelpFillSetupPromptRequest): Promise<HelpFillPrompt>
  'helpfill:setupRead'(request: HelpFillSetupReadRequest): Promise<HelpFillResult>
  'topics:createTopics'(request: CreateTopicsRequest): Promise<CreateTopicsResult>
}

/** Async so a missing bridge rejects the call instead of throwing during render. */
export function createSetupHelpSource(): SetupHelpSource {
  return {
    'helpfill:setupEstimate': async () => requireApi()['helpfill:setupEstimate'](),
    'helpfill:setupPrompt': async (request) => requireApi()['helpfill:setupPrompt'](request),
    'helpfill:setupRead': async (request) => requireApi()['helpfill:setupRead'](request),
    'topics:createTopics': async (request) => requireApi()['topics:createTopics'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
