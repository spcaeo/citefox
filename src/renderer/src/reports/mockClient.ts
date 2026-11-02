import {
  type AutoExportScopeRequest,
  type ExportProgress,
  type ExportRequest,
  type SetAutoExportRequest
} from '@shared/ipc'
import { createExportEngine, type ExportEngine } from './engine'
import type { ReportsClient, ReportsClientOptions } from './client'

/** Sample adapter for the Vite dev harness and unit tests. Not used by the production build. */
export function createMockReportsClient(options?: ReportsClientOptions): ReportsClient {
  return bindMock(engineFrom(options))
}

function engineFrom(options?: ReportsClientOptions): ExportEngine {
  return createExportEngine({
    paceMs: options?.paceMs ?? readPace(0),
    cancelled: options?.cancelled
  })
}

function bindMock(engine: ExportEngine): ReportsClient {
  return {
    previewExport: (request: ExportRequest) => engine.preview(request),
    startExport: (request: ExportRequest) => engine.start(request),
    getAutoExport: (request: AutoExportScopeRequest) => engine.getAuto(request),
    setAutoExport: (request: SetAutoExportRequest) => engine.setAuto(request),
    chooseAutoExportFolder: (request: AutoExportScopeRequest) => engine.chooseAutoFolder(request),
    onExportProgress: (listener: (progress: ExportProgress) => void) => engine.onProgress(listener),
    // The sample engine writes no file, so there is nothing to show.
    revealExport: () => Promise.resolve({ ok: true as const })
  }
}

function readPace(fallback: number): number {
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem('citefox.mock.pace')
  if (raw === null || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}
