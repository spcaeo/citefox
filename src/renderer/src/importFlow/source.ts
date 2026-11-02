import type {
  ImportCommitRequest,
  ImportCommitResult,
  ImportPickFileRequest,
  ImportPickFileResult,
  ImportPreview,
  ImportPreviewRequest,
  ImportReadRequest,
  ImportReadResult,
  ImportTemplateRequest,
  ImportTemplateResult,
  ImportUndoRequest,
  ImportUndoResult,
  ImportValidateRequest,
  ImportValidateResult
} from '@shared/ipc'

/**
 * The shared importer's channels (deep audit crosscut §5). A file is picked through
 * main's open dialog and comes back as a token; a dropped file sends its bytes.
 * Production reads the preload bridge; tests pass a fake.
 */
export interface ImportSource {
  'import:pickFile'(request: ImportPickFileRequest): Promise<ImportPickFileResult>
  'import:read'(request: ImportReadRequest): Promise<ImportReadResult>
  'import:preview'(request: ImportPreviewRequest): Promise<ImportPreview>
  'import:validate'(request: ImportValidateRequest): Promise<ImportValidateResult>
  'import:commit'(request: ImportCommitRequest): Promise<ImportCommitResult>
  'import:undo'(request: ImportUndoRequest): Promise<ImportUndoResult>
  'import:template'(request: ImportTemplateRequest): Promise<ImportTemplateResult>
}

export function createImportSource(): ImportSource {
  // Async so a missing bridge rejects the promise instead of throwing during render.
  return {
    'import:pickFile': async (request) => requireApi()['import:pickFile'](request),
    'import:read': async (request) => requireApi()['import:read'](request),
    'import:preview': async (request) => requireApi()['import:preview'](request),
    'import:validate': async (request) => requireApi()['import:validate'](request),
    'import:commit': async (request) => requireApi()['import:commit'](request),
    'import:undo': async (request) => requireApi()['import:undo'](request),
    'import:template': async (request) => requireApi()['import:template'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
