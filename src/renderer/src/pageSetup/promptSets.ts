import type { PromptSetRef, PromptSetView } from '@shared/domain'
import type {
  CiteFoxApi,
  PageIdRequest,
  PromptSetList,
  SetActivePromptSetRequest
} from '@shared/ipc'
import type { ClientMode } from '../onboarding/flags'
import type { ShellClient } from '../projects/client'
import { formatReadStamp } from './model'

/** `prompts:listSets` and `prompts:setActive`: the page's saved prompt-set versions. */
export interface PromptSetsClient {
  listSets(request: PageIdRequest): Promise<PromptSetList>
  setActive(request: SetActivePromptSetRequest): Promise<PromptSetView>
}

/** The mock is allowed only in dev and in an e2e build. */
function mocksEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1'
}

export function createPromptSetsClient(mode: ClientMode, shell: ShellClient): PromptSetsClient {
  if (mode === 'mock' && mocksEnabled()) return createShellPromptSetsClient(shell)
  return {
    listSets: (request) => requireApi()['prompts:listSets'](request),
    setActive: (request) => requireApi()['prompts:setActive'](request)
  }
}

/**
 * Stand-in for the mock shell, which keeps one set per page: the active set is the only version.
 */
export function createShellPromptSetsClient(shell: ShellClient): PromptSetsClient {
  return {
    async listSets(request) {
      const view = await shell.listPrompts(request)
      if (view.promptSetId === null || view.savedAt === null) {
        return { pageId: request.pageId, sets: [] }
      }
      return {
        pageId: request.pageId,
        sets: [
          {
            id: view.promptSetId,
            createdAt: view.savedAt,
            templateId: view.templateId,
            templateName: view.templateName,
            promptCount: view.prompts.length,
            isActive: true
          }
        ]
      }
    },
    setActive: (request) =>
      shell.listPrompts({ projectId: request.projectId, pageId: request.pageId })
  }
}

/** Newest first, as `prompts:listSets` returns them. */
export function promptSetLabel(set: PromptSetRef): string {
  const template = set.templateName ?? 'Written by hand'
  const count = `${set.promptCount} ${set.promptCount === 1 ? 'question' : 'questions'}`
  const active = set.isActive ? ' (in use)' : ''
  return `${formatReadStamp(set.createdAt)} · ${template} · ${count}${active}`
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
