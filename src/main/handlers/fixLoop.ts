/** Fix → measure → repeat: the Changes ledger, index checks, owners, anchors, Lost ground. */

import type { fixLoopChannels, IpcHandlersFor, RecoveryPlan } from '@shared/ipc'
import { rollupPageFixes } from '@shared/page-fixes'
import { suggestAnchors } from '../engine/fix-loop/anchors'
import { checkIndex, indexPreview } from '../engine/fix-loop/index-check'
import { savePageEditHtml } from '../engine/fix-loop/page-edit-html'
import { buildLedger } from '../engine/fix-loop/ledger'
import { readLostGround } from '../engine/fix-loop/lost-ground'
import { loadProjectSearches } from '../engine/fix-loop/searches'
import {
  parseCheckIndex,
  parseDraftOwnerWhy,
  parseDraftPageEdit,
  parseIndexPreview,
  parseLedgerRequest,
  parseLostGround,
  parseOwnerWhy,
  parsePageEdit,
  parseSaveBrief,
  parseSavePageEditHtml,
  parseSaveRecoveryPlan,
  parseSearchesRequest,
  parseSetKind,
  parseSetOwner,
  parseSuggestAnchors
} from '../engine/fix-loop/parse'
import { isOpenPage } from '../engine/fix-loop/runs'
import { withProject } from '../engine/project-db'
import { currentExportSaveDialog } from '../export/ipc'
import { emitMainEvent } from '../ipc-events'
import { IpcRequestError } from '../ipc-request'
import { getFixFollowUp, setFixKind } from '../storage/fix-follow-ups'
import { putPageAiText, setLoopOwner } from '../storage/fix-loop-records'
import { listPageFixBriefs, putPageFixBrief } from '../storage/page-fix-briefs'
import { getOwnerWhy } from '../storage/owner-whys'
import { getPageEdit } from '../storage/page-edits'
import { getPage } from '../storage/pages'
import { TopicInputError } from '../topics/drafts'
import type { TopicEnv } from '../topics/env'
import { draftOwnerWhy } from '../topics/owner-why'
import { draftPageEdit } from '../topics/page-edit'
import { guard, runCheckChannel, type EngineContext } from './context'

export function fixLoopHandlers(ctx: EngineContext): IpcHandlersFor<typeof fixLoopChannels> {
  const topicEnv: TopicEnv = {
    host: ctx,
    checks: null,
    emitProgress: (event) => {
      emitMainEvent('topics:progress', event)
    }
  }
  return {
    'fixes:draftPageEdit': (request) =>
      guard('fixes:draftPageEdit', ctx, () => {
        const channel = 'fixes:draftPageEdit'
        const parsed = parseDraftPageEdit(request)
        return withProject(ctx, parsed.projectId, channel, async (opened) => {
          try {
            return await draftPageEdit(topicEnv, opened, parsed)
          } catch (error) {
            if (error instanceof TopicInputError) {
              throw new IpcRequestError(channel, error.message, error.nextStep)
            }
            throw error
          }
        })
      }),
    'fixes:draftOwnerWhy': (request) =>
      guard('fixes:draftOwnerWhy', ctx, () => {
        const channel = 'fixes:draftOwnerWhy'
        const parsed = parseDraftOwnerWhy(request)
        return withProject(ctx, parsed.projectId, channel, async (opened) => {
          try {
            return await draftOwnerWhy(topicEnv, opened, parsed)
          } catch (error) {
            if (error instanceof TopicInputError) {
              throw new IpcRequestError(channel, error.message, error.nextStep)
            }
            throw error
          }
        })
      }),
    'fixes:ownerWhy': (request) =>
      guard('fixes:ownerWhy', ctx, () => {
        const parsed = parseOwnerWhy(request)
        return withProject(ctx, parsed.projectId, 'fixes:ownerWhy', ({ db }) =>
          getOwnerWhy(db, parsed.fixId)
        )
      }),
    'fixes:pageEdit': (request) =>
      guard('fixes:pageEdit', ctx, () => {
        const parsed = parsePageEdit(request)
        return withProject(ctx, parsed.projectId, 'fixes:pageEdit', ({ db }) =>
          getPageEdit(db, parsed.fixId)
        )
      }),
    'fixes:savePageEditHtml': (request) =>
      guard('fixes:savePageEditHtml', ctx, () => {
        const parsed = parseSavePageEditHtml(request)
        return withProject(ctx, parsed.projectId, 'fixes:savePageEditHtml', () =>
          savePageEditHtml(parsed, { dialog: currentExportSaveDialog() })
        )
      }),
    'fixes:searches': (request) =>
      guard('fixes:searches', ctx, () => {
        const parsed = parseSearchesRequest(request)
        return withProject(ctx, parsed.projectId, 'fixes:searches', ({ db, project }) =>
          loadProjectSearches(db, project, ctx.now().toISOString())
        )
      }),
    'fixes:pageFixCount': (request) =>
      guard('fixes:pageFixCount', ctx, () => {
        const parsed = parseSearchesRequest(request, 'fixes:pageFixCount')
        return withProject(ctx, parsed.projectId, 'fixes:pageFixCount', ({ db, project }) => {
          const rollup = rollupPageFixes(
            loadProjectSearches(db, project, ctx.now().toISOString()).searches
          )
          const topicFixes = rollup.fixes.filter((fix) =>
            fix.sources.some((source) => source.kind === 'topic')
          ).length
          return { pageFixes: rollup.fixes.length, needWork: rollup.needWork, topicFixes }
        })
      }),
    'fixes:briefs': (request) =>
      guard('fixes:briefs', ctx, () => {
        const parsed = parseSearchesRequest(request, 'fixes:briefs')
        return withProject(ctx, parsed.projectId, 'fixes:briefs', ({ db, project }) => ({
          projectId: project.id,
          briefs: listPageFixBriefs(db)
        }))
      }),
    'fixes:saveBrief': (request) =>
      guard('fixes:saveBrief', ctx, () => {
        const parsed = parseSaveBrief(request)
        return withProject(ctx, parsed.projectId, 'fixes:saveBrief', ({ db }) =>
          putPageFixBrief(db, {
            fixId: parsed.fixId,
            brief: parsed.brief,
            savedAt: ctx.now().toISOString()
          })
        )
      }),
    'fixes:ledger': (request) =>
      guard('fixes:ledger', ctx, () => {
        const parsed = parseLedgerRequest(request)
        return withProject(ctx, parsed.projectId, 'fixes:ledger', ({ db, project }) =>
          buildLedger(db, project, ctx.now().toISOString())
        )
      }),
    'fixes:setOwner': (request) =>
      guard('fixes:setOwner', ctx, () => {
        const parsed = parseSetOwner(request)
        return withProject(ctx, parsed.projectId, 'fixes:setOwner', ({ db }) =>
          setLoopOwner(db, parsed.step, parsed.label)
        )
      }),
    'fixes:setKind': (request) =>
      guard('fixes:setKind', ctx, () => {
        const channel = 'fixes:setKind'
        const parsed = parseSetKind(request)
        return withProject(ctx, parsed.projectId, channel, ({ db, project }) => {
          const fix = getFixFollowUp(db, parsed.fixId)
          const page = fix === null ? null : getPage(db, fix.pageId, project.id)
          if (fix === null || page === null || page.status === 'removed') {
            throw new IpcRequestError(channel, 'That change was not found')
          }
          const saved = setFixKind(db, fix.id, parsed.kind)
          return { fixId: saved.id, kind: saved.kind }
        })
      }),
    'fixes:indexPreview': (request) =>
      guard('fixes:indexPreview', ctx, () => {
        const parsed = parseIndexPreview(request)
        return withProject(ctx, parsed.projectId, 'fixes:indexPreview', ({ db, project }) =>
          indexPreview(ctx, db, project, parsed)
        )
      }),
    'fixes:checkIndex': (request) =>
      guard('fixes:checkIndex', ctx, () => {
        const parsed = parseCheckIndex(request)
        return withProject(ctx, parsed.projectId, 'fixes:checkIndex', ({ db, project }) =>
          checkIndex(ctx, db, project, parsed)
        )
      }),
    'fixes:suggestAnchors': (request) =>
      guard('fixes:suggestAnchors', ctx, () => suggestAnchors(ctx, parseSuggestAnchors(request))),
    'fixes:lostGround': (request) =>
      guard('fixes:lostGround', ctx, () =>
        runCheckChannel('fixes:lostGround', () => {
          const parsed = parseLostGround(request)
          return withProject(
            ctx,
            parsed.projectId,
            'fixes:lostGround',
            ({ db, project }) => readLostGround(db, project, parsed.pageId, parsed.vsRunId).view
          )
        })
      ),
    'fixes:saveRecoveryPlan': (request) =>
      guard('fixes:saveRecoveryPlan', ctx, () => {
        const channel = 'fixes:saveRecoveryPlan'
        const parsed = parseSaveRecoveryPlan(request)
        return withProject(ctx, parsed.projectId, channel, ({ db, project }): RecoveryPlan => {
          const page = getPage(db, parsed.pageId, project.id)
          if (page === null || !isOpenPage(page)) {
            throw new IpcRequestError(channel, 'That page is not in this project')
          }
          const saved = putPageAiText(db, {
            pageId: page.id,
            kind: 'recovery',
            inputKey: parsed.inputKey,
            text: parsed.text,
            edited: true,
            savedAt: ctx.now().toISOString()
          })
          return {
            text: saved.text,
            savedAt: saved.savedAt,
            edited: saved.edited,
            inputKey: saved.inputKey
          }
        })
      })
  }
}
