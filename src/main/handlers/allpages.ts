/** All pages at scale (SRS section 4.20). */

import type { allPagesChannels, IpcHandlersFor } from '@shared/ipc'
import { estimateBulk, runBulk } from '../engine/allpages/bulk'
import { loadCitedPages } from '../engine/allpages/cited-pages'
import { loadCitationReview } from '../engine/allpages/citations'
import {
  parseBulkAction,
  parseFixId,
  parseIgnoreUrl,
  parseMerge,
  parsePointPrompt,
  parseTrackUrl,
  parseUndoPoint,
  parseUndoTrack
} from '../engine/allpages/parse'
import { withAllPages } from '../engine/allpages/pass'
import { mergePages, pointPromptHere, undoMerge, undoPointPrompt } from '../engine/allpages/point'
import { loadAllPages } from '../engine/allpages/rows'
import { ignoreCitedUrl, trackCitedUrl, undoTrackCitedUrl } from '../engine/allpages/track'
import type { CheckEngine } from '../engine/checks/engine'
import { parseProjectId } from '../ipc-m2'
import { guard, type EngineContext } from './context'

export function allPagesHandlers(
  ctx: EngineContext,
  checks: CheckEngine
): IpcHandlersFor<typeof allPagesChannels> {
  return {
    'allpages:list': (request) =>
      guard('allpages:list', ctx, () =>
        withAllPages(
          ctx,
          parseProjectId(request, 'allpages:list').projectId,
          'allpages:list',
          loadAllPages
        )
      ),
    'allpages:citations': (request) =>
      guard('allpages:citations', ctx, () =>
        withAllPages(
          ctx,
          parseProjectId(request, 'allpages:citations').projectId,
          'allpages:citations',
          loadCitationReview
        )
      ),
    'allpages:citedPages': (request) =>
      guard('allpages:citedPages', ctx, () =>
        withAllPages(
          ctx,
          parseProjectId(request, 'allpages:citedPages').projectId,
          'allpages:citedPages',
          loadCitedPages
        )
      ),
    'allpages:estimate': (request) =>
      guard('allpages:estimate', ctx, () => {
        const parsed = parseBulkAction(request, 'allpages:estimate')
        return withAllPages(ctx, parsed.projectId, 'allpages:estimate', (pass) =>
          estimateBulk(pass, parsed)
        )
      }),
    'allpages:run': (request) =>
      guard('allpages:run', ctx, () => {
        const parsed = parseBulkAction(request, 'allpages:run')
        return withAllPages(ctx, parsed.projectId, 'allpages:run', (pass) =>
          runBulk(pass, parsed, {
            createId: ctx.createId,
            startCheck: (check) => {
              checks.start(check).catch((error: unknown) => {
                ctx.logger.error('allpages:run check failed', error)
              })
            }
          })
        )
      }),
    'allpages:pointHere': (request) =>
      guard('allpages:pointHere', ctx, () => {
        const parsed = parsePointPrompt(request)
        return withAllPages(ctx, parsed.projectId, 'allpages:pointHere', (pass) =>
          pointPromptHere(ctx, pass, parsed)
        )
      }),
    'allpages:undoPoint': (request) =>
      guard('allpages:undoPoint', ctx, () => {
        const parsed = parseUndoPoint(request)
        return withAllPages(ctx, parsed.projectId, 'allpages:undoPoint', (pass) =>
          undoPointPrompt(pass, parsed)
        )
      }),
    'allpages:merge': (request) =>
      guard('allpages:merge', ctx, () => {
        const parsed = parseMerge(request)
        return withAllPages(ctx, parsed.projectId, 'allpages:merge', (pass) =>
          mergePages(ctx, pass, parsed)
        )
      }),
    'allpages:undoMerge': (request) =>
      guard('allpages:undoMerge', ctx, () => {
        const parsed = parseFixId(request)
        return withAllPages(ctx, parsed.projectId, 'allpages:undoMerge', (pass) =>
          undoMerge(pass, parsed.fixId)
        )
      }),
    'allpages:trackUrl': (request) =>
      guard('allpages:trackUrl', ctx, () => {
        const parsed = parseTrackUrl(request)
        return withAllPages(ctx, parsed.projectId, 'allpages:trackUrl', (pass) =>
          trackCitedUrl(ctx, pass, parsed)
        )
      }),
    'allpages:undoTrack': (request) =>
      guard('allpages:undoTrack', ctx, () => {
        const parsed = parseUndoTrack(request)
        return withAllPages(ctx, parsed.projectId, 'allpages:undoTrack', (pass) =>
          undoTrackCitedUrl(pass, parsed)
        )
      }),
    'allpages:ignoreUrl': (request) =>
      guard('allpages:ignoreUrl', ctx, () => {
        const parsed = parseIgnoreUrl(request)
        return withAllPages(ctx, parsed.projectId, 'allpages:ignoreUrl', (pass) =>
          ignoreCitedUrl(pass, parsed)
        )
      })
  }
}
