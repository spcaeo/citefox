import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'

/**
 * Runs server/apps-script/Code.gs in a sandbox with in-memory fakes of the
 * Apps Script services it uses (Sheet, cache, properties, lock, mail), so
 * tests drive doPost/doGet and the admin functions without Google.
 */

type Cell = string | number | boolean | Date

class FakeSheet {
  rows: Cell[][] = []
  constructor(readonly name: string) {}
  getLastRow(): number {
    return this.rows.length
  }
  getRange(row: number, col: number, numRows = 1, numCols = 1): FakeRange {
    return new FakeRange(this, row, col, numRows, numCols)
  }
  appendRow(row: Cell[]): void {
    this.rows.push([...row])
  }
  deleteRow(row: number): void {
    this.rows.splice(row - 1, 1)
  }
  setFrozenRows(): undefined {
    return undefined
  }
  setColumnWidth(): undefined {
    return undefined
  }
}

class FakeRange {
  constructor(
    private sheet: FakeSheet,
    private row: number,
    private col: number,
    private numRows: number,
    private numCols: number
  ) {}
  getValues(): Cell[][] {
    const out: Cell[][] = []
    for (let r = 0; r < this.numRows; r++) {
      const source = this.sheet.rows[this.row - 1 + r] ?? []
      const line: Cell[] = []
      for (let c = 0; c < this.numCols; c++) line.push(source[this.col - 1 + c] ?? '')
      out.push(line)
    }
    return out
  }
  setValues(values: Cell[][]): FakeRange {
    values.forEach((line, r) => {
      const index = this.row - 1 + r
      while (this.sheet.rows.length <= index) this.sheet.rows.push([])
      const target = this.sheet.rows[index] as Cell[]
      line.forEach((value, c) => {
        // A sheet stores "'=x" as the text "=x" shown as text; keep what was written.
        target[this.col - 1 + c] = value
      })
    })
    return this
  }
  setValue(value: Cell): FakeRange {
    return this.setValues([[value]])
  }
}

/** The script's global functions the tests call. */
type ScriptFn =
  | 'setup'
  | 'doPost'
  | 'doGet'
  | 'activeInstalls'
  | 'sendEmailToOptedIn'
  | 'deleteUserByEmail'
  | 'deleteReportByReference'
  | 'listUsers'
  | 'validateReport'
  | 'parseBody'
  | 'safeCell'
  | 'reportsOverDailyLimit'
  | 'reportCounts'
  | 'allow'
  | 'pickRecipients'

export interface FakeDriveFile {
  id: string
  name: string
  type: string
  bytes: number[]
  trashed: boolean
  url: string
}

interface FakeFolder {
  getId(): string
  createFile(blob: { bytes: number[]; type: string; name: string }): {
    getUrl(): string
    getId(): string
  }
}

export interface ScriptWorld {
  fn: Readonly<Record<ScriptFn, (...args: unknown[]) => unknown>>
  sheets: Map<string, FakeSheet>
  properties: Map<string, string>
  cache: Map<string, string>
  mail: { to: string; subject: string; body: string; htmlBody?: string }[]
  drive: { folders: string[]; files: FakeDriveFile[] }
  /** Make Drive or mail calls throw, to test that the Sheet row still lands. */
  breakServices(which: { drive?: boolean; mail?: boolean }): void
  setQuota(n: number): void
  post(body: unknown): { ok: boolean; error?: string; reportId?: string }
  get(parameter: Record<string, string>): string
  rows(name: string): Cell[][]
}

export function loadScript(): ScriptWorld {
  const code = readFileSync(join(process.cwd(), 'server/apps-script/Code.gs'), 'utf8')
  const sheets = new Map<string, FakeSheet>()
  const properties = new Map<string, string>()
  const cache = new Map<string, string>()
  const mail: ScriptWorld['mail'] = []
  const drive: ScriptWorld['drive'] = { folders: [], files: [] }
  const broken = { drive: false, mail: false }
  let quota = 100
  const folderFor = (id: string): FakeFolder => ({
    getId: () => id,
    createFile: (blob: { bytes: number[]; type: string; name: string }) => {
      const fileId = `file${drive.files.length + 1}`
      const file: FakeDriveFile = {
        id: fileId,
        name: blob.name,
        type: blob.type,
        bytes: blob.bytes,
        trashed: false,
        url: `https://drive.google.com/file/d/${fileId}/view`
      }
      drive.files.push(file)
      return { getUrl: () => file.url, getId: () => fileId }
    }
  })
  const sandbox: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name: string) => sheets.get(name) ?? null,
        insertSheet: (name: string) => {
          const sheet = new FakeSheet(name)
          sheets.set(name, sheet)
          return sheet
        }
      }),
      getUi: () => {
        throw new Error('no UI in tests')
      }
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key: string) => cache.get(key) ?? null,
        put: (key: string, value: string) => void cache.set(key, value)
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => properties.get(key) ?? null,
        setProperty: (key: string, value: string) => void properties.set(key, value)
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        waitLock: () => undefined,
        releaseLock: () => undefined
      })
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({
        text,
        setMimeType() {
          return this
        }
      })
    },
    HtmlService: { createHtmlOutput: (html: string) => ({ html }) },
    Utilities: {
      computeHmacSha256Signature: (value: string, key: string) => [
        ...createHmac('sha256', key).update(value).digest()
      ],
      base64EncodeWebSafe: (bytes: number[]) => Buffer.from(bytes).toString('base64url') + '=',
      getUuid: () => randomUUID(),
      base64Decode: (text: string) =>
        [...Buffer.from(text, 'base64')].map((b) => (b > 127 ? b - 256 : b)),
      newBlob: (bytes: number[], type: string, name: string) => ({ bytes, type, name })
    },
    DriveApp: {
      createFolder: (name: string) => {
        if (broken.drive) throw new Error('Drive is down')
        const id = `folder${drive.folders.length + 1}`
        drive.folders.push(name)
        return folderFor(id)
      },
      getFolderById: (id: string) => {
        if (broken.drive) throw new Error('Drive is down')
        if (!id.startsWith('folder')) throw new Error('No folder')
        return folderFor(id)
      },
      getFileById: (id: string) => {
        const file = drive.files.find((f) => f.id === id)
        if (!file) throw new Error('No file')
        return {
          setTrashed: (value: boolean) => {
            file.trashed = value
          }
        }
      }
    },
    MailApp: {
      getRemainingDailyQuota: () => quota,
      sendEmail: (...args: unknown[]) => {
        if (broken.mail) throw new Error('Mail is down')
        quota -= 1
        // Both forms: sendEmail(to, subject, body) and sendEmail({ to, subject, body, ... }).
        mail.push(
          typeof args[0] === 'string'
            ? { to: args[0], subject: String(args[1]), body: String(args[2]) }
            : (args[0] as ScriptWorld['mail'][number])
        )
      }
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/ID/exec' })
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@gmail.com' }) },
    Logger: { log: () => undefined }
  }
  const context = createContext(sandbox)
  runInContext(code, context, { filename: 'Code.gs' })
  const fn = new Proxy({} as ScriptWorld['fn'], {
    get: (_target, name: string) => sandbox[name] as (...args: unknown[]) => unknown
  })
  return {
    fn,
    sheets,
    properties,
    cache,
    mail,
    drive,
    breakServices: (which) => {
      broken.drive = which.drive ?? broken.drive
      broken.mail = which.mail ?? broken.mail
    },
    setQuota: (n) => {
      quota = n
    },
    post(body) {
      const out = fn.doPost({ postData: { contents: JSON.stringify(body) } }) as { text: string }
      return JSON.parse(out.text) as { ok: boolean; error?: string; reportId?: string }
    },
    get(parameter) {
      return (fn.doGet({ parameter }) as { html: string }).html
    },
    rows: (name) => (sheets.get(name)?.rows ?? []).slice(1)
  }
}
