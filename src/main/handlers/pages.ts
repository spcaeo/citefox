/** Pages, pins, search, and the page read. */

import type { IpcHandlersFor, pagesChannels } from '@shared/ipc'
import { getPageRead, startPageRead } from '../engine/page-read'
import {
  addPageChannel,
  getPageChannel,
  listPagesChannel,
  pinnedPagesChannel,
  pinPageChannel,
  removePageChannel,
  searchPagesChannel,
  unpinPageChannel,
  updatePageChannel
} from '../engine/pages'
import {
  parseAddPage,
  parsePageId,
  parseProjectId,
  parseSearchPages,
  parseStartPageRead,
  parseUpdatePage
} from '../ipc-m2'
import { holdFirstCheck } from '../setup-runner/first-check'
import type { SetupRunner } from '../setup-runner/runner'
import { guard, type EngineContext } from './context'

/**
 * `runner` sets a single add up in the background (owner feedback 5): read,
 * buyer profile, prompts, content gaps. Its first check waits for the user.
 */
export function pagesHandlers(
  ctx: EngineContext,
  runner?: Pick<SetupRunner, 'startPage'>
): IpcHandlersFor<typeof pagesChannels> {
  return {
    'pages:list': (request) =>
      guard('pages:list', ctx, () =>
        listPagesChannel(ctx, parseProjectId(request, 'pages:list').projectId)
      ),
    'pages:get': (request) =>
      guard('pages:get', ctx, () => {
        const parsed = parsePageId(request, 'pages:get')
        return getPageChannel(ctx, parsed.projectId, parsed.pageId)
      }),
    'pages:add': (request) =>
      guard('pages:add', ctx, async () => {
        const { checkWhenReady, ...add } = parseAddPage(request)
        const page = await addPageChannel(ctx, add)
        holdFirstCheck(ctx, page.projectId, page.id)
        try {
          runner?.startPage(page.projectId, page.id, {
            auto: true,
            ...(checkWhenReady === true ? { checkWhenReady: true } : {})
          })
        } catch (error) {
          ctx.logger.warn('could not start page setup', {
            message: error instanceof Error ? error.message : 'failed'
          })
        }
        return page
      }),
    'pages:update': (request) =>
      guard('pages:update', ctx, () => updatePageChannel(ctx, parseUpdatePage(request))),
    'pages:remove': (request) =>
      guard('pages:remove', ctx, () => {
        const parsed = parsePageId(request, 'pages:remove')
        return removePageChannel(ctx, parsed.projectId, parsed.pageId)
      }),
    'pages:search': (request) =>
      guard('pages:search', ctx, () => {
        const parsed = parseSearchPages(request)
        return searchPagesChannel(ctx, parsed.projectId, parsed.query)
      }),
    'pages:pin': (request) =>
      guard('pages:pin', ctx, () => {
        const parsed = parsePageId(request, 'pages:pin')
        return pinPageChannel(ctx, parsed.projectId, parsed.pageId)
      }),
    'pages:unpin': (request) =>
      guard('pages:unpin', ctx, () => {
        const parsed = parsePageId(request, 'pages:unpin')
        return unpinPageChannel(ctx, parsed.projectId, parsed.pageId)
      }),
    'pages:pinned': (request) =>
      guard('pages:pinned', ctx, () =>
        pinnedPagesChannel(ctx, parseProjectId(request, 'pages:pinned').projectId)
      ),
    'pages:readStart': (request) =>
      guard('pages:readStart', ctx, () => startPageRead(ctx, parseStartPageRead(request))),
    'pages:getRead': (request) =>
      guard('pages:getRead', ctx, () => {
        const parsed = parsePageId(request, 'pages:getRead')
        return getPageRead(ctx, parsed.projectId, parsed.pageId)
      })
  }
}
