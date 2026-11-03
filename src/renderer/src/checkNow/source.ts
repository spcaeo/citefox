import type { CiteFoxApi } from '@shared/ipc'
import { createScopeSource, type ScopeSource } from '../scope'

/**
 * The channels Check now, the page's Check now menu and Add a page use. The
 * scope channels load pages, groups, clusters and topics; the rest start a
 * check, list the questions not cited last time, list the checks (for the questions that failed), read one page's questions,
 * add a page and file it in a group. Production reads the preload bridge;
 * tests pass a fake.
 */
export type CheckNowSource = ScopeSource &
  Pick<
    CiteFoxApi,
    | 'checks:start'
    | 'checks:notCited'
    | 'history:listProject'
    | 'prompts:list'
    | 'pages:add'
    | 'pages:update'
    | 'pages:pin'
    | 'pages:unpin'
    | 'prompts:addQuestions'
    | 'structure:setGroupPages'
    | 'start:suggestUrls'
    | 'setup:progress'
  >

function api(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

export function createCheckNowSource(): CheckNowSource {
  // Async so a missing bridge rejects the promise instead of throwing during render.
  return {
    ...createScopeSource(),
    'checks:start': async (request) => api()['checks:start'](request),
    'checks:notCited': async (request) => api()['checks:notCited'](request),
    'history:listProject': async (request) => api()['history:listProject'](request),
    'prompts:list': async (request) => api()['prompts:list'](request),
    'pages:add': async (request) => api()['pages:add'](request),
    'pages:update': async (request) => api()['pages:update'](request),
    'pages:pin': async (request) => api()['pages:pin'](request),
    'pages:unpin': async (request) => api()['pages:unpin'](request),
    'prompts:addQuestions': async (request) => api()['prompts:addQuestions'](request),
    'structure:setGroupPages': async (request) => api()['structure:setGroupPages'](request),
    'start:suggestUrls': async (request) => api()['start:suggestUrls'](request),
    'setup:progress': (listener) => {
      try {
        return api()['setup:progress'](listener)
      } catch {
        return () => undefined
      }
    }
  }
}
