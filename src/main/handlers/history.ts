/** History and notes (FR-15.1 to FR-15.3, FR-7.4). */

import type { historyChannels, IpcHandlersFor } from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { buildPageHistory, compareSnapshots } from '../engine/progress/history'
import { deleteCheckRun } from '../engine/progress/delete-check'
import { buildProjectHistory } from '../engine/progress/project-history'
import {
  parseAddNote,
  parseCheckRunId,
  parseCompareContent,
  parseHistoryList,
  parseNoteId,
  parseUpdateNote
} from '../engine/progress/parse'
import { withProject } from '../engine/project-db'
import { checkCatalogCache } from '../headless/catalog-cache'
import { parseProjectId } from '../ipc-m2'
import { deleteNote, getNote, insertNote, updateNote } from '../storage/notes'
import { getPage } from '../storage/pages'
import { guard, runCheckChannel, type EngineContext } from './context'

export function historyHandlers(ctx: EngineContext): IpcHandlersFor<typeof historyChannels> {
  return {
    'history:list': (request) =>
      guard('history:list', ctx, () =>
        runCheckChannel('history:list', () => {
          const parsed = parseHistoryList(request)
          return withProject(ctx, parsed.projectId, 'history:list', ({ db, project }) =>
            buildPageHistory(db, {
              ...parsed,
              builtAt: ctx.now().toISOString(),
              domain: project.domain
            })
          )
        })
      ),
    'history:listProject': (request) =>
      guard('history:listProject', ctx, () =>
        runCheckChannel('history:listProject', () => {
          const { projectId } = parseProjectId(request, 'history:listProject')
          return withProject(ctx, projectId, 'history:listProject', ({ db }) =>
            buildProjectHistory(db, { projectId, builtAt: ctx.now().toISOString() })
          )
        })
      ),
    'history:compare': (request) =>
      guard('history:compare', ctx, () =>
        runCheckChannel('history:compare', () => {
          const parsed = parseCompareContent(request)
          return withProject(ctx, parsed.projectId, 'history:compare', ({ db }) => {
            requirePage(db, parsed.projectId, parsed.pageId, 'history:compare')
            return compareSnapshots(db, parsed.pageId, parsed.fromSnapshotId, parsed.toSnapshotId)
          })
        })
      ),
    'history:addNote': (request) =>
      guard('history:addNote', ctx, () => {
        const parsed = parseAddNote(request)
        return withProject(ctx, parsed.projectId, 'history:addNote', ({ db }) => {
          requirePage(db, parsed.projectId, parsed.pageId, 'history:addNote')
          return insertNote(db, {
            id: ctx.createId(),
            pageId: parsed.pageId,
            date: parsed.date,
            text: parsed.text,
            at: ctx.now().toISOString()
          })
        })
      }),
    'history:updateNote': (request) =>
      guard('history:updateNote', ctx, () => {
        const parsed = parseUpdateNote(request)
        return withProject(ctx, parsed.projectId, 'history:updateNote', ({ db }) => {
          if (getNote(db, parsed.noteId) === null) {
            throw new IpcRequestError('history:updateNote', 'That note was not found')
          }
          return updateNote(db, parsed.noteId, {
            date: parsed.date,
            text: parsed.text,
            at: ctx.now().toISOString()
          })
        })
      }),
    'history:deleteNote': (request) =>
      guard('history:deleteNote', ctx, () => {
        const parsed = parseNoteId(request)
        return withProject(ctx, parsed.projectId, 'history:deleteNote', ({ db }) => {
          if (!deleteNote(db, parsed.noteId)) {
            throw new IpcRequestError('history:deleteNote', 'That note was not found')
          }
          return { noteId: parsed.noteId }
        })
      }),
    'history:delete': (request) =>
      guard('history:delete', ctx, () =>
        runCheckChannel('history:delete', () => {
          const parsed = parseCheckRunId(request)
          const deleted = withProject(ctx, parsed.projectId, 'history:delete', ({ db }) =>
            deleteCheckRun(db, parsed.runId)
          )
          // A fix's follow-up may have changed: the scheduler reads it again.
          checkCatalogCache(ctx.storage).invalidate()
          return deleted
        })
      )
  }
}

function requirePage(
  db: Parameters<typeof getPage>[0],
  projectId: string,
  pageId: string,
  channel: string
): void {
  if (getPage(db, pageId, projectId) === null) {
    throw new IpcRequestError(channel, 'That page is not in this project')
  }
}
