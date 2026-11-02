import { writeFile } from 'node:fs/promises'
import type { SavePageEditHtmlRequest, SavePageEditHtmlResult } from '@shared/ipc'
import type { ExportSaveDialog } from '../../export/ipc'
import { IpcRequestError } from '../../ipc-request'

const CHANNEL = 'fixes:savePageEditHtml'

/**
 * `fixes:savePageEditHtml`: the page with its edits, as one HTML file for a content
 * writer, saved where the person picks in the save dialog. The renderer never sends
 * a path, and the HTML is never logged.
 */

/** A file name safe on every system: no folders, no reserved characters, ends in .html (or .md). */
export function safeHtmlFileName(fileName: string, format: 'html' | 'md' = 'html'): string {
  const printable = Array.from(fileName, (char) => (char.charCodeAt(0) < 32 ? '-' : char)).join('')
  const base = printable
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 120)
    .replace(/\.(html?|md)$/i, '')
  return `${base.length > 0 ? base : 'page-edits'}.${format}`
}

export async function savePageEditHtml(
  request: SavePageEditHtmlRequest,
  deps: {
    dialog: ExportSaveDialog | null
    write?: (filePath: string, text: string) => Promise<void>
  }
): Promise<SavePageEditHtmlResult> {
  if (deps.dialog === null) {
    throw new IpcRequestError(CHANNEL, 'Could not open the save dialog. Try again.')
  }
  const picked = await deps.dialog({
    title: 'Save the page edits',
    defaultPath: safeHtmlFileName(request.fileName, request.format),
    filters: [
      request.format === 'md'
        ? { name: 'Markdown', extensions: ['md'] }
        : { name: 'HTML', extensions: ['html'] }
    ]
  })
  if (picked.canceled || picked.filePath === undefined || picked.filePath.length === 0) {
    return { saved: false }
  }
  const write =
    deps.write ?? ((filePath: string, text: string) => writeFile(filePath, text, 'utf8'))
  try {
    await write(picked.filePath, request.html)
  } catch {
    throw new IpcRequestError(
      CHANNEL,
      'Could not save the file. Choose another folder and try again.'
    )
  }
  return { saved: true }
}
