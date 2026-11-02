import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import type { OpenDataFolderResult, RevealPathResult } from '@shared/ipc'

/** Electron `shell.showItemInFolder`, or a test double. */
export type DataFolderReveal = (folderPath: string) => void

let reveal: DataFolderReveal | null = null

/** Production passes Electron's `shell.showItemInFolder`. Tests pass a fake or null. */
export function configureDataFolderReveal(next: DataFolderReveal | null): void {
  reveal = next
}

/**
 * `settings:openDataFolder`: shows the app data folder in Finder, Explorer or the
 * file manager. Main passes the folder; the renderer never sends a path.
 */
export function openDataFolder(root: string): OpenDataFolderResult {
  let isFolder: boolean
  try {
    isFolder = statSync(root).isDirectory()
  } catch {
    isFolder = false
  }
  if (!isFolder) {
    return {
      ok: false,
      reason: 'The data folder is not where CiteFox expects it.',
      nextStep: 'Restart CiteFox, then try again.'
    }
  }
  if (reveal === null) {
    return {
      ok: false,
      reason: 'Could not open the folder.',
      nextStep: 'Open it from your file manager.'
    }
  }
  reveal(root)
  return { ok: true }
}

const OUTSIDE: RevealPathResult = {
  ok: false,
  reason: 'CiteFox can only show its own files.',
  nextStep: 'Open the data folder from Settings instead.'
}

/**
 * `settings:revealPath`: shows one file or folder inside the app data folder
 * (a project database, say). Anything outside it, a link that leads outside
 * it, or a path that is gone is refused; the file manager is never pointed
 * anywhere else.
 */
export function revealAppPath(root: string, request: unknown): RevealPathResult {
  const asked =
    typeof request === 'object' && request !== null && 'path' in request
      ? (request as { path: unknown }).path
      : null
  if (typeof asked !== 'string' || asked.length === 0 || !isAbsolute(asked)) return OUTSIDE
  let real: string
  let realRoot: string
  try {
    real = realpathSync(asked)
    realRoot = realpathSync(root)
  } catch {
    return {
      ok: false,
      reason: 'That file is no longer where CiteFox keeps it.',
      nextStep: 'Open the data folder from Settings instead.'
    }
  }
  const inside = relative(realRoot, real)
  if (inside === '') return openDataFolder(root)
  if (isAbsolute(inside) || inside.split(sep)[0] === '..') return OUTSIDE
  if (reveal === null) {
    return {
      ok: false,
      reason: 'Could not open the folder.',
      nextStep: 'Open it from your file manager.'
    }
  }
  reveal(real)
  return { ok: true }
}
