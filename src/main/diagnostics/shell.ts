import { statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DiagnosticsOpenResult } from '@shared/ipc'
import { openDataFolder, revealAppPath } from '../export/data-folder'

/** Electron `shell.openExternal`, or a test double. */
export type OpenExternal = (url: string) => Promise<void>

let openExternal: OpenExternal | null = null

/** Production passes Electron's `shell.openExternal`. Tests pass a fake or null. */
export function configureDiagnosticsShell(next: OpenExternal | null): void {
  openExternal = next
}

/**
 * Opens a `mailto:` link in the person's mail program. Only the link main built is
 * ever opened, so a renderer cannot point this at anything else.
 */
export async function openExternalUrl(url: string): Promise<DiagnosticsOpenResult> {
  if (!url.startsWith('mailto:')) {
    return {
      ok: false,
      reason: 'CiteFox only opens its own mail link.',
      nextStep: 'Copy the report instead.'
    }
  }
  if (openExternal === null) {
    return {
      ok: false,
      reason: 'Could not open your mail program.',
      nextStep: 'Copy the report and email it to us yourself.'
    }
  }
  try {
    await openExternal(url)
    return { ok: true }
  } catch {
    return {
      ok: false,
      reason: 'Could not open your mail program.',
      nextStep: 'Copy the report and email it to us yourself.'
    }
  }
}

/**
 * Shows the log file in Finder, Explorer or the file manager. When the file is not
 * there yet the logs folder opens, and failing that the data folder.
 */
export function revealLogFile(dataRoot: string, logFile: string): DiagnosticsOpenResult {
  let isFile: boolean
  try {
    isFile = statSync(logFile).isFile()
  } catch {
    isFile = false
  }
  const first = revealAppPath(dataRoot, { path: isFile ? logFile : dirname(logFile) })
  return first.ok ? first : openDataFolder(dataRoot)
}
