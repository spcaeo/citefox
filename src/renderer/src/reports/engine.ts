import type { AutoExport, ExportPreview, ExportStartResult } from '@shared/domain'
import {
  autoExportProblem,
  type AutoExportScopeRequest,
  type AutoExportUnavailable,
  type ExportProgress,
  type ExportRequest,
  type SetAutoExportRequest
} from '@shared/ipc'
import { fileNameFor, previewForRequest } from './exportSample'

export interface ExportEngine {
  preview(request: ExportRequest): Promise<ExportPreview>
  start(request: ExportRequest): Promise<ExportStartResult>
  /** The stored scope, or a disabled one with no folder. */
  getAuto(request: AutoExportScopeRequest): Promise<AutoExport>
  setAuto(request: SetAutoExportRequest): Promise<AutoExport | AutoExportUnavailable>
  /** Stands in for main's folder dialog: always picks {@link SAMPLE_AUTO_EXPORT_FOLDER}. */
  chooseAutoFolder(request: AutoExportScopeRequest): Promise<AutoExport>
  onProgress(listener: (progress: ExportProgress) => void): () => void
}

/** The folder the sample engine "picks" in place of main's dialog. */
export const SAMPLE_AUTO_EXPORT_FOLDER = '/Users/sample/CiteFox exports'

const PHASES = [
  { phase: 'collect', detail: 'Collecting the checks', done: 1 },
  { phase: 'render', detail: 'Building the report', done: 2 },
  { phase: 'write', detail: 'Saving the file', done: 3 }
] as const

/**
 * In-memory stand-in for `exports:*`.
 * Every format pushes `exports:progress` only while the file is being written.
 * `logoBase64` is never stored. The renderer does not choose `filePath`; this
 * mock returns one the way main would after its save dialog.
 * `cancelled` models the user dismissing that dialog.
 */
export function createExportEngine(options?: {
  paceMs?: number
  cancelled?: boolean
}): ExportEngine {
  const paceMs = options?.paceMs ?? 0
  const autos = new Map<string, AutoExport>()
  const listeners = new Set<(progress: ExportProgress) => void>()
  let sequence = 0
  const storedAuto = (request: AutoExportScopeRequest): AutoExport =>
    autos.get(autoKey(request.projectId, request.pageId)) ?? {
      projectId: request.projectId,
      pageId: request.pageId,
      enabled: false,
      destination: 'folder',
      folder: null,
      emailTo: null,
      spec: null,
      runs: []
    }

  return {
    preview(request) {
      return Promise.resolve(previewForRequest(request))
    },
    async start(request) {
      const preview = previewForRequest(request)
      if (preview.blocked) {
        return {
          ok: false,
          reason: preview.reason ?? 'This export is blocked.',
          nextStep: preview.nextStep
        }
      }
      if (options?.cancelled) {
        return { ok: false, reason: 'Export cancelled', nextStep: null }
      }
      sequence += 1
      const exportId = `exp-${sequence}`
      for (const step of PHASES) {
        const progress: ExportProgress = {
          exportId,
          phase: step.phase,
          state: 'running',
          done: step.done,
          total: 3,
          detail: step.detail,
          nextStep: null
        }
        for (const listener of listeners) listener(progress)
        if (paceMs > 0) await delay(paceMs)
      }
      const filename = fileNameFor(request)
      return {
        ok: true,
        exportId,
        filePath: `CiteFox exports/${filename}`,
        filename,
        bytes: preview.estimatedBytes,
        format: request.format
      }
    },
    getAuto(request) {
      return Promise.resolve(storedAuto(request))
    },
    setAuto(request) {
      const current = storedAuto(request)
      if (request.destination === 'email') return Promise.resolve(autoExportProblem('email'))
      if (request.enabled && current.folder === null) {
        return Promise.resolve(autoExportProblem('no_folder'))
      }
      const stored: AutoExport = {
        ...current,
        enabled: request.enabled,
        spec: {
          ...request.spec,
          pageIds: [...request.spec.pageIds],
          marketIds: [...request.spec.marketIds],
          sections: [...request.spec.sections]
        }
      }
      autos.set(autoKey(request.projectId, request.pageId), stored)
      return Promise.resolve(stored)
    },
    chooseAutoFolder(request) {
      const stored: AutoExport = { ...storedAuto(request), folder: SAMPLE_AUTO_EXPORT_FOLDER }
      autos.set(autoKey(request.projectId, request.pageId), stored)
      return Promise.resolve(stored)
    },
    onProgress(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

function autoKey(projectId: string, pageId: string | null): string {
  return `${projectId}:${pageId ?? ''}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
