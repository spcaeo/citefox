import { PLAYGROUND_MEMORY_RUNS, type GenerationTemplate } from '@shared/domain'
import type {
  CiteFoxApi,
  ListTemplatesRequest,
  PlaygroundAioRequest,
  PlaygroundAioResult,
  PlaygroundRunRequest,
  PlaygroundRunResult,
  SavePlaygroundRunRequest,
  SavePlaygroundRunResult
} from '@shared/ipc'
import type { ClientMode } from '../onboarding/flags'

/**
 * Playground channels plus the in-memory run list.
 * `listRuns` is not an IPC channel. The engine keeps the latest 20 until quit, and this client mirrors that list.
 */
export interface PlaygroundClient {
  listTemplates(request?: ListTemplatesRequest): Promise<readonly GenerationTemplate[]>
  run(request: PlaygroundRunRequest): Promise<readonly PlaygroundRunResult[]>
  checkAio(request: PlaygroundAioRequest): Promise<PlaygroundAioResult>
  saveToProject(request: SavePlaygroundRunRequest): Promise<SavePlaygroundRunResult>
  listRuns(): Promise<readonly PlaygroundRunResult[]>
}

export function createPlaygroundClient(mode: ClientMode): PlaygroundClient {
  // The guard is written inline (see `mocksAllowed`) so a release build drops the mock chunk.
  if (mode === 'mock' && (import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1')) {
    return createMockPlaygroundClient()
  }
  return createIpcPlaygroundClient()
}

/** The mock modules load on first use, so they stay out of the main bundle. */
export function createMockPlaygroundClient(): PlaygroundClient {
  const playground = async (): Promise<typeof import('../mocks/m2/playground')> =>
    import('../mocks/m2/playground')
  const templates = async (): Promise<typeof import('../mocks/m2/templates')> =>
    import('../mocks/m2/templates')
  return {
    listTemplates: async (request = {}) => (await templates()).listTemplates(request),
    run: async (request) => (await playground()).runPlayground(request),
    checkAio: async (request) => (await playground()).checkPlaygroundAio(request),
    saveToProject: async (request) => (await playground()).savePlaygroundRun(request),
    listRuns: async () => (await playground()).listPlaygroundRuns()
  }
}

function createIpcPlaygroundClient(): PlaygroundClient {
  const runs: PlaygroundRunResult[] = []
  return {
    listTemplates: (request = {}) => requireApi()['templates:list'](request),
    run: async (request) => {
      const results = await requireApi()['playground:run'](request)
      for (const result of results) runs.push(result)
      if (runs.length > PLAYGROUND_MEMORY_RUNS) {
        runs.splice(0, runs.length - PLAYGROUND_MEMORY_RUNS)
      }
      return results
    },
    checkAio: (request) => requireApi()['playground:checkAio'](request),
    saveToProject: (request) => requireApi()['playground:saveToProject'](request),
    // A copy each time. Returning the same mutated array makes React skip the update.
    listRuns: () => Promise.resolve([...runs])
  }
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
