/** The shared importer (deep audit crosscut §5): paste, CSV, TSV or Excel, checked, added as one batch. */

import type { IpcHandlersFor, importerChannels } from '@shared/ipc'
import {
  parseCommit,
  parsePickFile,
  parsePreview,
  parseRead,
  parseTemplate,
  parseUndo,
  parseValidate
} from '../import/parse'
import {
  clearQuestionsDraft,
  parseDraftRequest,
  parseSaveDraft,
  readQuestionsDraft,
  writeQuestionsDraft
} from '../import/draft'
import { createImportService } from '../import/service'
import { IpcRequestError } from '../ipc-request'
import { getProject } from '../storage/records'
import { guard, type EngineContext } from './context'

/** A draft belongs to a project CiteFox has; anything else is refused. */
function known(ctx: EngineContext, projectId: string, channel: string): string {
  if (getProject(ctx.storage.db, projectId) === null)
    throw new IpcRequestError(channel, 'That project was not found')
  return projectId
}

export function importerHandlers(ctx: EngineContext): IpcHandlersFor<typeof importerChannels> {
  const service = createImportService(ctx)
  return {
    'import:pickFile': (request) =>
      guard('import:pickFile', ctx, () => service.pickFile(parsePickFile(request))),
    'import:read': (request) => guard('import:read', ctx, () => service.read(parseRead(request))),
    'import:preview': (request) =>
      guard('import:preview', ctx, () => service.preview(parsePreview(request))),
    'import:validate': (request) =>
      guard('import:validate', ctx, () => service.validate(parseValidate(request))),
    'import:commit': (request) =>
      guard('import:commit', ctx, () => service.commit(parseCommit(request))),
    'import:undo': (request) => guard('import:undo', ctx, () => service.undo(parseUndo(request))),
    'import:template': (request) =>
      guard('import:template', ctx, () => service.template(parseTemplate(request))),
    // Add questions' unsaved rows (W3I-C4): kept in main until added or discarded.
    'import:getDraft': (request) =>
      guard('import:getDraft', ctx, () => {
        const { projectId } = parseDraftRequest(request, 'import:getDraft')
        return readQuestionsDraft(ctx.storage.paths.root, known(ctx, projectId, 'import:getDraft'))
      }),
    'import:saveDraft': (request) =>
      guard('import:saveDraft', ctx, () => {
        const draft = parseSaveDraft(request)
        known(ctx, draft.projectId, 'import:saveDraft')
        writeQuestionsDraft(ctx.storage.paths.root, draft, ctx.now())
        return { saved: true }
      }),
    'import:clearDraft': (request) =>
      guard('import:clearDraft', ctx, () => {
        const { projectId } = parseDraftRequest(request, 'import:clearDraft')
        return {
          cleared: clearQuestionsDraft(
            ctx.storage.paths.root,
            known(ctx, projectId, 'import:clearDraft')
          )
        }
      })
  }
}
