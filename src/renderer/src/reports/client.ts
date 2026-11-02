import type { AutoExport, ExportPreview, ExportStartResult } from '@shared/domain'
import type {
  AutoExportScopeRequest,
  AutoExportUnavailable,
  CiteFoxApi,
  ExportProgress,
  RevealExportResult,
  SetAutoExportRequest
} from '@shared/ipc'
import type { ExportRequest } from '@shared/ipc'
import { errorText } from '../components/errorText'

/**
 * Export adapter.
 * The sample engine runs in the Vite dev harness and in tests. A production
 * build calls `exports:*` only. A thrown error becomes a plain reason with
 * Electron's invoke wrapper removed. `ok: false` from a handler is shown as the handler wrote it.
 */
export interface ReportsClient {
  previewExport(request: ExportRequest): Promise<ExportPreview>
  startExport(request: ExportRequest): Promise<ExportStartResult>
  getAutoExport(request: AutoExportScopeRequest): Promise<AutoExport | AutoExportUnavailable>
  setAutoExport(request: SetAutoExportRequest): Promise<AutoExport | AutoExportUnavailable>
  /** `exports:chooseAutoFolder`: main opens the folder dialog. The renderer never sends a path. */
  chooseAutoExportFolder(
    request: AutoExportScopeRequest
  ): Promise<AutoExport | AutoExportUnavailable>
  onExportProgress(listener: (progress: ExportProgress) => void): () => void
  /** `exports:reveal`: shows a file this run exported in Finder (Explorer, the file manager). */
  revealExport(filePath: string): Promise<RevealExportResult>
}

export interface ReportsClientOptions {
  paceMs?: number
  /** Next writable export returns `{ ok: false, reason: 'Export cancelled' }`. */
  cancelled?: boolean
}

export function blockedExportPreview(
  reason: string,
  nextStep: string | null = null
): ExportPreview {
  return {
    blocked: true,
    reason,
    nextStep,
    pageCount: 0,
    marketCount: 0,
    checkCount: 0,
    sections: [],
    estimatedBytes: 0,
    preview: ''
  }
}

export function createLiveReportsClient(): ReportsClient {
  return {
    async previewExport(request) {
      try {
        return await requireApi()['exports:preview'](request)
      } catch (error) {
        const explained = explainExportError(error)
        return blockedExportPreview(explained.reason, explained.nextStep)
      }
    },
    async startExport(request) {
      try {
        return await requireApi()['exports:start'](request)
      } catch (error) {
        const explained = explainExportError(error)
        return { ok: false, reason: explained.reason, nextStep: explained.nextStep }
      }
    },
    async getAutoExport(request): Promise<AutoExport | AutoExportUnavailable> {
      try {
        const result = await requireApi()['exports:getAuto'](request)
        if ('code' in result) return result
        return result
      } catch (error) {
        throw exportCallError(error)
      }
    },
    async setAutoExport(request): Promise<AutoExport | AutoExportUnavailable> {
      try {
        const result = await requireApi()['exports:setAuto'](request)
        if ('code' in result) return result
        return result
      } catch (error) {
        throw exportCallError(error)
      }
    },
    async chooseAutoExportFolder(request): Promise<AutoExport | AutoExportUnavailable> {
      try {
        return await requireApi()['exports:chooseAutoFolder'](request)
      } catch (error) {
        throw exportCallError(error)
      }
    },
    onExportProgress(listener) {
      if (typeof window === 'undefined' || !window.citefox) return () => undefined
      return window.citefox['exports:progress'](listener)
    },
    async revealExport(filePath) {
      try {
        return await requireApi()['exports:reveal']({ filePath })
      } catch (error) {
        const explained = explainExportError(error)
        return { ok: false, reason: explained.reason, nextStep: explained.nextStep ?? '' }
      }
    }
  }
}

/** True when an auto-export call resolved with a fixed problem instead of an `AutoExport`. */
export function isAutoExportUnavailable(
  result: AutoExport | AutoExportUnavailable
): result is AutoExportUnavailable {
  return 'code' in result
}

export class ExportCallError extends Error {
  readonly nextStep: string | null
  constructor(reason: string, nextStep: string | null) {
    super(reason)
    this.name = 'ExportCallError'
    this.nextStep = nextStep
  }
}

function exportCallError(error: unknown): ExportCallError {
  const explained = explainExportError(error)
  return new ExportCallError(explained.reason, explained.nextStep)
}

/** Plain text for a thrown export call. Strips Electron's invoke wrapper. */
export function explainExportError(error: unknown): { reason: string; nextStep: string | null } {
  return { reason: errorText(error, 'Could not export.'), nextStep: null }
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
