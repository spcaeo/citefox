import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { TRANSFER_MAX_FILE_BYTES, type TransferFailure } from '@shared/ipc'
import { nodeExportIo, publishBytes, type ExportAtomicIo } from '../export/atomic'

/**
 * The native save and open dialogs for moving to a new Mac. Production passes
 * Electron's dialogs, looked up on each pick so an e2e stub of `dialog` applies;
 * tests pass fakes. The renderer never sends or sees a path.
 */

export interface TransferFileFilter {
  name: string
  extensions: string[]
}

export interface TransferDialogs {
  save: (options: {
    title: string
    defaultPath: string
    filters: TransferFileFilter[]
  }) => Promise<{ canceled: boolean; filePath?: string }>
  open: (options: {
    title: string
    buttonLabel: string
    properties: 'openFile'[]
    filters: TransferFileFilter[]
  }) => Promise<{ canceled: boolean; filePaths: string[] }>
}

let dialogs: TransferDialogs | null = null

export function configureTransferDialogs(next: TransferDialogs | null): void {
  dialogs = next
}

const NO_DIALOG: TransferFailure = {
  ok: false,
  cancelled: false,
  reason: 'Could not open the file dialog.',
  nextStep: 'Try again.'
}

export function cancelled(nextStep: string): TransferFailure {
  return { ok: false, cancelled: true, reason: 'Cancelled', nextStep }
}

/** Asks where to save, then writes `text` atomically. */
export async function saveText(
  options: { title: string; defaultName: string; filter: TransferFileFilter },
  text: string,
  io: ExportAtomicIo = nodeExportIo()
): Promise<{ ok: true; filename: string; bytes: number } | TransferFailure> {
  if (dialogs === null) return NO_DIALOG
  const picked = await dialogs.save({
    title: options.title,
    defaultPath: options.defaultName,
    filters: [options.filter]
  })
  if (picked.canceled || picked.filePath === undefined || picked.filePath.length === 0) {
    return cancelled('Choose a file name and save.')
  }
  const bytes = Buffer.from(text, 'utf8')
  try {
    await publishBytes(dirname(picked.filePath), basename(picked.filePath), bytes, io)
  } catch {
    return {
      ok: false,
      cancelled: false,
      reason: 'CiteFox could not write the file.',
      nextStep: 'Choose another folder with free space, then try again.'
    }
  }
  return { ok: true, filename: basename(picked.filePath), bytes: bytes.length }
}

/** Asks for a file and reads it as text. */
export async function openText(options: {
  title: string
  filter: TransferFileFilter
}): Promise<{ ok: true; filename: string; text: string } | TransferFailure> {
  if (dialogs === null) return NO_DIALOG
  const picked = await dialogs.open({
    title: options.title,
    buttonLabel: 'Import',
    properties: ['openFile'],
    filters: [options.filter, { name: 'All files', extensions: ['*'] }]
  })
  const path = picked.filePaths[0]
  if (picked.canceled || path === undefined) return cancelled('Choose a file to import.')
  const filename = basename(path)
  try {
    const info = await stat(path)
    if (!info.isFile()) {
      return {
        ok: false,
        cancelled: false,
        reason: 'That is a folder.',
        nextStep: 'Choose a file.'
      }
    }
    if (info.size > TRANSFER_MAX_FILE_BYTES) {
      return {
        ok: false,
        cancelled: false,
        reason: `${filename} is larger than ${TRANSFER_MAX_FILE_BYTES / (1024 * 1024)} MB.`,
        nextStep: 'Export the project again without stored check results.'
      }
    }
    return { ok: true, filename, text: await readFile(path, 'utf8') }
  } catch {
    return {
      ok: false,
      cancelled: false,
      reason: `CiteFox could not read ${filename}.`,
      nextStep: 'Check the file is still there, then try again.'
    }
  }
}

/** Picked files by token, for this run of the app only. */
export class TokenStore<T> {
  private readonly items = new Map<string, T>()

  add(item: T): string {
    const token = randomUUID()
    this.items.set(token, item)
    // A long session never keeps more than a few picked files.
    while (this.items.size > 8) {
      const oldest = this.items.keys().next().value
      if (oldest === undefined) break
      this.items.delete(oldest)
    }
    return token
  }

  get(token: string): T | undefined {
    return this.items.get(token)
  }
}
