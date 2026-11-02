import type {
  PageChange,
  PageChangeIdRequest,
  PageChangeList,
  PageDiffRequest,
  PageDiffResult,
  PageVersionList,
  PageVersionsRequest,
  ProjectIdRequest
} from '@shared/ipc'

/**
 * One method per page change channel. Production uses the preload allow-list
 * (`window.citefox`); tests pass a fake.
 */
export interface PageChangesSource {
  'pageChanges:list'(request: ProjectIdRequest): Promise<PageChangeList>
  'pageChanges:versions'(request: PageVersionsRequest): Promise<PageVersionList>
  'pageChanges:diff'(request: PageDiffRequest): Promise<PageDiffResult>
  'pageChanges:dismiss'(request: PageChangeIdRequest): Promise<PageChange>
  'pageChanges:restore'(request: PageChangeIdRequest): Promise<PageChange>
}

export function createPageChangesSource(): PageChangesSource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'pageChanges:list': async (request) => requireApi()['pageChanges:list'](request),
    'pageChanges:versions': async (request) => requireApi()['pageChanges:versions'](request),
    'pageChanges:diff': async (request) => requireApi()['pageChanges:diff'](request),
    'pageChanges:dismiss': async (request) => requireApi()['pageChanges:dismiss'](request),
    'pageChanges:restore': async (request) => requireApi()['pageChanges:restore'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
