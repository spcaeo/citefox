import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, session } from 'electron'

/** The print window's own in-memory session: the app's guard blocks every file:// page. */
const PRINT_PARTITION = 'citefox-report-print'

let guarded = false

/**
 * Only the report file being printed (and its inline data: images) may load in the print
 * session; every other request is cancelled, so printing makes no network request.
 */
function printSession(allowed: Set<string>): Electron.Session {
  const print = session.fromPartition(PRINT_PARTITION, { cache: false })
  if (!guarded) {
    guarded = true
    print.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    print.setPermissionCheckHandler(() => false)
    print.webRequest.onBeforeRequest((details, callback) => {
      const ok = details.url.startsWith('data:') || allowed.has(details.url)
      callback({ cancel: !ok })
    })
  }
  return print
}

const ALLOWED = new Set<string>()

/**
 * A ready report as a PDF: the downloaded HTML file printed by a hidden window with
 * scripts off, so every table prints in full and only the All engines view shows.
 * The window never appears; the temporary file is removed afterwards.
 */
export async function printHtmlToPdf(html: string): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-report-'))
  const file = join(dir, 'report.html')
  writeFileSync(file, html, 'utf8')
  const url = pathToFileURL(file).href
  ALLOWED.add(url)
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      session: printSession(ALLOWED)
    }
  })
  try {
    await win.loadURL(url)
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    })
  } finally {
    ALLOWED.delete(url)
    win.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
}
