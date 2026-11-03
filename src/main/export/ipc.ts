import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  autoExportProblem,
  type AutoExportUnavailable,
  type ExportProgress,
  type ExportRequest,
  type IpcHandlerMap,
  type IpcInvokeChannel,
  type RevealExportResult
} from '@shared/ipc'
import type { Logger } from '../logging/logger'
import type { AppStorage } from '../storage/app-storage'
import { bindAutoExportHandlers } from './auto/ipc'
import { storageReportBuilders } from './report-builders'
import { previewExport, startExport } from './service'
import { createStorageExportSource } from './source'

/** The `unavailable` result: a build that cannot store automatic exports. */
export function autoExportUnavailable(): AutoExportUnavailable {
  return autoExportProblem('unavailable')
}

type ExportChannel =
  | 'exports:preview'
  | 'exports:start'
  | 'exports:getAuto'
  | 'exports:setAuto'
  | 'exports:chooseAutoFolder'
  | 'exports:reveal'

export interface ExportSaveDialogOptions {
  title: string
  defaultPath: string
  filters: { name: string; extensions: string[] }[]
}

/** Electron `dialog.showSaveDialog`, or a test double. The renderer never sends a path. */
export type ExportSaveDialog = (
  options: ExportSaveDialogOptions
) => Promise<{ canceled: boolean; filePath?: string }>

export interface ExportIpcDeps {
  storage: AppStorage
  emitProgress: (event: ExportProgress) => void
  now: () => Date
  createId: () => string
  knownSecrets: () => readonly string[]
  logger?: Logger
}

let saveDialog: ExportSaveDialog | null = null

/** Electron `shell.showItemInFolder`, or a test double. */
export type ExportReveal = (filePath: string) => void

let reveal: ExportReveal | null = null

/** Files `exports:start` wrote in this run. `exports:reveal` shows only these. */
const writtenFiles = new Set<string>()

/** Production passes Electron's `shell.showItemInFolder`. Tests pass a fake. */
export function configureExportReveal(next: ExportReveal | null): void {
  reveal = next
}

/** Tests only: forget the files earlier exports wrote. */
export function resetWrittenExports(): void {
  writtenFiles.clear()
}

const REVEAL_GONE: RevealExportResult = {
  ok: false,
  reason: 'That file is no longer where CiteFox saved it.',
  nextStep: 'Export it again.'
}

/** `exports:reveal`: a file this run wrote and that is still a file. */
export function revealExport(request: unknown): RevealExportResult {
  const filePath =
    typeof request === 'object' && request !== null && 'filePath' in request
      ? (request as { filePath: unknown }).filePath
      : null
  if (typeof filePath !== 'string' || !writtenFiles.has(filePath)) {
    return {
      ok: false,
      reason: 'CiteFox can only show files it exported.',
      nextStep: 'Export the report, then choose Show in Finder.'
    }
  }
  try {
    if (!statSync(filePath).isFile()) return REVEAL_GONE
  } catch {
    return REVEAL_GONE
  }
  if (reveal === null) {
    return { ok: false, reason: 'Could not open the folder.', nextStep: 'Open it from Finder.' }
  }
  reveal(filePath)
  return { ok: true }
}

/** Production passes Electron's save dialog. Tests pass a fake. */
export function configureExportSaveDialog(dialog: ExportSaveDialog): void {
  saveDialog = dialog
}

export function resetExportSaveDialog(): void {
  saveDialog = null
}

/** The configured save dialog, for other "save a file" actions (FR-18.5). Null when none. */
export function currentExportSaveDialog(): ExportSaveDialog | null {
  return saveDialog
}

/**
 * `exports:preview` and `exports:start` read the project file and write PDF, CSV, XLSX,
 * HTML, or JSON.
 * `exports:getAuto`, `exports:setAuto` and `exports:chooseAutoFolder` store the
 * automatic export spec and its dialog-chosen folder (FR-22.6, `auto/ipc.ts`);
 * `auto/run.ts` repeats it after scheduled checks.
 */
export function bindExportIpcHandlers(
  deps: ExportIpcDeps,
  guard: <T>(channel: IpcInvokeChannel, run: () => Promise<T> | T) => Promise<T>
): Pick<IpcHandlerMap, ExportChannel> {
  const source = createStorageExportSource({
    app: deps.storage.db,
    projectsDirectory: deps.storage.paths.projectsDirectory,
    now: deps.now
  })
  // Reputation, sources, groups and verdicts come from the features that own them.
  const builders = (projectId: string): ReturnType<typeof storageReportBuilders> =>
    storageReportBuilders(
      {
        app: deps.storage.db,
        projectsDirectory: deps.storage.paths.projectsDirectory,
        now: deps.now,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {})
      },
      projectId
    )
  return {
    'exports:preview': (request) =>
      guard('exports:preview', () =>
        previewExport({
          request,
          source,
          secrets: deps.knownSecrets(),
          now: deps.now,
          builders: builders(request.projectId)
        })
      ),
    'exports:start': (request) =>
      guard('exports:start', async () => {
        if (saveDialog === null) {
          return {
            ok: false as const,
            reason: 'Could not open the save dialog.',
            nextStep: 'Try the export again.'
          }
        }
        const dialog = saveDialog
        const result = await startExport({
          request,
          source,
          // directory is unused once chooseOutputPath is set, so exports never land in temp folder.
          directory: tmpdir(),
          secrets: deps.knownSecrets(),
          now: deps.now,
          builders: builders(request.projectId),
          ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
          createId: deps.createId,
          onProgress: deps.emitProgress,
          chooseOutputPath: async (filename) => {
            const picked = await dialog({
              title: 'Export',
              defaultPath: filename,
              filters: saveFilters(request)
            })
            if (picked.canceled || picked.filePath === undefined || picked.filePath.length === 0) {
              return null
            }
            return picked.filePath
          }
        })
        if (result.ok) writtenFiles.add(result.filePath)
        return result
      }),
    ...bindAutoExportHandlers({ storage: deps.storage, now: deps.now }, guard),
    'exports:reveal': (request) => guard('exports:reveal', () => revealExport(request))
  }
}

function saveFilters(request: ExportRequest): { name: string; extensions: string[] }[] {
  const format = request.format
  if (format === 'csv') return [{ name: 'CSV zip', extensions: ['zip'] }]
  if (format === 'pdf') return [{ name: 'PDF report', extensions: ['pdf'] }]
  if (format === 'html') {
    return request.html?.packaging === 'file'
      ? [{ name: 'HTML report', extensions: ['html'] }]
      : [{ name: 'HTML report folder (zip)', extensions: ['zip'] }]
  }
  if (format === 'json') return [{ name: 'JSON data', extensions: ['json'] }]
  return [{ name: 'Excel workbook', extensions: ['xlsx'] }]
}
