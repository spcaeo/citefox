import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import {
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_PASTE_CHARS,
  IMPORT_MAX_ROWS,
  IMPORT_RESULTS,
  type ImportCommitRequest,
  type ImportCommitResult,
  type ImportCounts,
  type ImportEntity,
  type ImportFileKind,
  type ImportMapping,
  type ImportPickFileRequest,
  type ImportPickFileResult,
  type ImportPreview,
  type ImportPreviewRequest,
  type ImportReadRequest,
  type ImportReadResult,
  type ImportRow,
  type ImportRowCheck,
  type ImportStageWord,
  type ImportTemplateRequest,
  type ImportTemplateResult,
  type ImportUndoRequest,
  type ImportUndoResult,
  type ImportValidateRequest,
  type ImportValidateResult
} from '@shared/ipc'
import {
  BUILT_IN_STAGE_WORDS,
  foldWord,
  IMPORT_NOUN,
  translateStage,
  type ImportStageWords
} from '@shared/import-fields'
import type { EngineHost } from '../engine/host'
import { withProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import { updateQuestions } from '../questions/update'
import { checkListRows } from './check-lists'
import { checkQuestionRows } from './check-questions'
import { commitList, commitQuestions } from './commit'
import { readProjectFacts, type ImportDestination, type ProjectFacts } from './context'
import { decodeText, parseRows, type Delimiter } from './csv'
import { createImportSession, type ImportSession } from './session'
import {
  getBatch,
  insertBatch,
  markBatchUndone,
  readMapping,
  readStageWords,
  saveMapping
} from './store'
import { buildTable, columnsOf, guessMapping, headerSignature, looksLikeHeader } from './table'
import { templateBytes, templateFileName } from './template'
import { planQuestionUndo, undoOtherItems } from './undo'
import { checkPageUrl, marketCode, resolveValues, rowValues } from './values'
import { readXlsx } from './xlsx'

/**
 * The importer's main side (crosscut §5): the native open and save dialogs, reading
 * and matching tables, the dry-run checks, the batch commit and its Undo. The
 * renderer never sends a path: the open dialog gives a token for the picked file.
 */

export interface ImportOpenDialogOptions {
  title: string
  buttonLabel: string
  properties: 'openFile'[]
  filters: { name: string; extensions: string[] }[]
}

export interface ImportSaveDialogOptions {
  title: string
  defaultPath: string
  filters: { name: string; extensions: string[] }[]
}

export interface ImportDialogs {
  open: (options: ImportOpenDialogOptions) => Promise<{ canceled: boolean; filePaths: string[] }>
  save: (options: ImportSaveDialogOptions) => Promise<{ canceled: boolean; filePath?: string }>
}

let dialogs: ImportDialogs | null = null

/** Production passes Electron's dialogs; tests pass fakes. Unset: picking a file is refused. */
export function configureImportDialogs(next: ImportDialogs | null): void {
  dialogs = next
}

const FILE_KINDS: Readonly<Record<string, ImportFileKind>> = {
  '.csv': 'csv',
  '.tsv': 'tsv',
  '.tab': 'tsv',
  '.txt': 'txt',
  '.xlsx': 'xlsx'
}

interface ReadRows {
  rows: string[][]
  name: string
  kind: ImportFileKind | 'paste'
  sheets: string[]
  sheet: string | null
}

function tooBig(bytes: number): string {
  return `That file is ${(bytes / (1024 * 1024)).toFixed(1)} MB. The limit is 10 MB.`
}

/** The file kind by its extension; an old .xls is refused with what to do. */
function fileKindOf(name: string, channel: string): ImportFileKind {
  const extension = extname(name).toLowerCase()
  if (extension === '.xls') {
    throw new IpcRequestError(
      channel,
      'CiteFox reads .xlsx, not the old .xls format. Save it as .xlsx or CSV, then choose it again.'
    )
  }
  return FILE_KINDS[extension] ?? 'csv'
}

export interface ImportService {
  pickFile: (request: ImportPickFileRequest) => Promise<ImportPickFileResult>
  read: (request: ImportReadRequest) => Promise<ImportReadResult>
  preview: (request: ImportPreviewRequest) => Promise<ImportPreview>
  validate: (request: ImportValidateRequest) => Promise<ImportValidateResult>
  commit: (request: ImportCommitRequest) => Promise<ImportCommitResult>
  undo: (request: ImportUndoRequest) => Promise<ImportUndoResult>
  template: (request: ImportTemplateRequest) => Promise<ImportTemplateResult>
}

function plural(count: number, entity: ImportEntity): string {
  const [one, many] = IMPORT_NOUN[entity]
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

export function countResults(checks: readonly ImportRowCheck[]): ImportCounts {
  const counts = Object.fromEntries(IMPORT_RESULTS.map((result) => [result, 0])) as Record<
    (typeof IMPORT_RESULTS)[number],
    number
  >
  let merged = 0
  for (const check of checks) {
    counts[check.result] += 1
    if (check.merged === true) merged += 1
  }
  return { ...counts, total: checks.length, merged }
}

function destinationOf(facts: ProjectFacts, targetId: string | null): ImportDestination | null {
  return targetId === null ? null : (facts.destinations.get(targetId) ?? null)
}

function checkRows(
  entity: ImportEntity,
  rows: readonly { values: Record<string, string>; keep: boolean }[],
  facts: ProjectFacts,
  target: ImportDestination | null,
  rules: ImportPreviewRequest['rules']
): ImportRowCheck[] {
  if (entity === 'questions' || entity === 'keywords') {
    return checkQuestionRows({ rows, facts, target, entity, rules })
  }
  return checkListRows(
    entity,
    rows.map((row) => row.values),
    facts
  )
}

/** The mapping fitted to a table's width (a saved one may be shorter or longer). */
function fitMapping(mapping: ImportMapping, width: number): (string | null)[] {
  return Array.from({ length: width }, (_, index) => mapping[index] ?? null)
}

export function createImportService(host: EngineHost, session?: ImportSession): ImportService {
  const memory = session ?? createImportSession({ now: host.now, createId: host.createId })

  async function readRows(request: ImportReadRequest): Promise<ReadRows> {
    const source = request.source
    if (source.kind === 'paste') {
      if (source.text.length > IMPORT_MAX_PASTE_CHARS) {
        throw new IpcRequestError(
          'import:read',
          'That paste is over 2 MB. Save it as a file and import the file.'
        )
      }
      // A sheet paste is TSV; anything else is one value per line.
      return {
        rows: parseRows(source.text, { candidates: ['\t'] }),
        name: 'Pasted rows',
        kind: 'paste',
        sheets: [],
        sheet: null
      }
    }
    if (source.kind === 'dropped') {
      const bytes = new Uint8Array(Buffer.from(source.data, 'base64'))
      const kind = fileKindOf(source.name, 'import:read')
      if (bytes.byteLength > IMPORT_MAX_FILE_BYTES) {
        throw new IpcRequestError('import:read', tooBig(bytes.byteLength))
      }
      return rowsOf(bytes, basename(source.name), kind, source.sheet)
    }
    const file = memory.file(source.token)
    if (file === null) {
      throw new IpcRequestError('import:read', 'That file is no longer open. Choose it again.')
    }
    return rowsOf(new Uint8Array(await readFile(file.path)), file.name, file.kind, source.sheet)
  }

  async function rowsOf(
    bytes: Uint8Array,
    name: string,
    kind: ImportFileKind,
    sheet: string | null
  ): Promise<ReadRows> {
    if (kind === 'xlsx') {
      let book: Awaited<ReturnType<typeof readXlsx>>
      try {
        book = await readXlsx(bytes, { rows: IMPORT_MAX_ROWS, columns: 60 })
      } catch {
        throw new IpcRequestError(
          'import:read',
          'That file could not be read as an Excel workbook. Save it again as .xlsx or CSV.'
        )
      }
      if (book.sheets.length === 0) {
        throw new IpcRequestError('import:read', 'That workbook has no visible sheet.')
      }
      const picked = book.sheets.find((item) => item.name === sheet) ?? book.sheets[0]
      return {
        rows: picked?.rows ?? [],
        name,
        kind: 'xlsx',
        sheets: book.sheets.map((item) => item.name),
        sheet: picked?.name ?? null
      }
    }
    const text = decodeText(bytes)
    const candidates: readonly Delimiter[] =
      kind === 'tsv' ? ['\t'] : kind === 'txt' ? ['\t', '|'] : [',', ';', '\t', '|']
    return { rows: parseRows(text, { candidates }), name, kind, sheets: [], sheet: null }
  }

  return {
    async pickFile(request) {
      if (dialogs === null) {
        throw new IpcRequestError(
          'import:pickFile',
          'Choosing a file is not available in this build.'
        )
      }
      const picked = await dialogs.open({
        title: `Import ${IMPORT_NOUN[request.entity][1]}`,
        buttonLabel: 'Import',
        properties: ['openFile'],
        filters: [
          { name: 'Spreadsheets and text', extensions: ['csv', 'tsv', 'txt', 'xlsx'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      const path = picked.filePaths[0]
      if (picked.canceled || path === undefined) return { cancelled: true }
      const kind = fileKindOf(path, 'import:pickFile')
      const info = await stat(path)
      if (!info.isFile())
        throw new IpcRequestError('import:pickFile', 'Choose a file, not a folder.')
      if (info.size > IMPORT_MAX_FILE_BYTES) {
        throw new IpcRequestError('import:pickFile', tooBig(info.size))
      }
      const name = basename(path)
      const token = memory.addFile({ path, name, bytes: info.size, kind, entity: request.entity })
      return { cancelled: false, token, name, bytes: info.size, kind }
    },

    async read(request) {
      const read = await readRows(request)
      const hasHeader = request.hasHeader ?? looksLikeHeader(read.rows, request.entity)
      const table = buildTable(read.rows, hasHeader)
      if (table.rows.length === 0) {
        throw new IpcRequestError(
          'import:read',
          read.rows.length === 0
            ? 'Nothing to import: the file is empty.'
            : 'Only a header row: there are no rows under it.'
        )
      }
      const signature = headerSignature(table.header, table.width)
      return withProject(host, request.projectId, 'import:read', ({ db }) => {
        const saved = table.header === null ? null : readMapping(db, request.entity, signature)
        const mapping = fitMapping(
          saved?.mapping ?? guessMapping(table, request.entity),
          table.width
        )
        const sourceId = memory.addSource({
          projectId: request.projectId,
          entity: request.entity,
          name: read.name,
          table,
          signature
        })
        return {
          sourceId,
          name: read.name,
          kind: read.kind,
          sheets: read.sheets,
          sheet: read.sheet,
          rowCount: table.rows.length,
          hasHeader,
          columns: columnsOf(table),
          mapping,
          mappingSaved: saved !== null,
          stageWords: { ...readStageWords(db, request.entity), ...(saved?.stageWords ?? {}) },
          warnings: table.warnings
        }
      })
    },

    async preview(request) {
      const source = memory.source(request.sourceId)
      if (
        source === null ||
        source.projectId !== request.projectId ||
        source.entity !== request.entity
      ) {
        throw new IpcRequestError('import:preview', 'That file is no longer open. Choose it again.')
      }
      return withProject(host, request.projectId, 'import:preview', ({ db, project }) => {
        const facts = readProjectFacts(db, project)
        const target = destinationOf(facts, request.targetId)
        const mapping = fitMapping(request.mapping, source.table.width)
        const values = source.table.rows.map((cells) =>
          rowValues({
            entity: request.entity,
            cells,
            mapping,
            stageWords: request.stageWords,
            defaults: request.defaults,
            markets: facts.markets
          })
        )
        const checks = checkRows(
          request.entity,
          values.map((item) => ({ values: item, keep: false })),
          facts,
          target,
          request.rules
        )
        const rows: ImportRow[] = checks.map((check, index) => ({
          ...check,
          row: source.table.rowNumbers[index] ?? index + 1,
          values: values[index] ?? {}
        }))
        if (request.saveMapping && source.table.header !== null) {
          saveMapping(
            db,
            request.entity,
            source.signature,
            { mapping, stageWords: request.stageWords },
            host.now().toISOString()
          )
        }
        const stageColumn = mapping.indexOf('stage')
        return {
          sourceId: request.sourceId,
          entity: request.entity,
          rows,
          counts: countResults(checks),
          stageWords:
            stageColumn < 0 ? [] : stageWordsOf(source.table.rows, stageColumn, request.stageWords),
          unknownMarkets: [
            ...new Set(
              values.flatMap((item) => (item.marketRaw ? [marketCode(item.marketRaw)] : []))
            )
          ],
          newPages: newPagesOf(values, facts)
        }
      })
    },

    async validate(request) {
      return withProject(host, request.projectId, 'import:validate', ({ db, project }) => {
        const facts = readProjectFacts(db, project)
        const target = destinationOf(facts, request.targetId)
        const rows = request.rows.map((row) => ({
          values: resolveValues(
            request.entity,
            row.values,
            {},
            { stage: null, page: null, market: null },
            facts.markets
          ),
          keep: row.keep === true
        }))
        const checks = checkRows(request.entity, rows, facts, target, request.rules)
        return {
          rows: checks.map((check, index) => ({
            ...check,
            key: request.rows[index]?.key ?? String(index)
          })),
          counts: countResults(checks)
        }
      })
    },

    async commit(request) {
      if (request.entity === 'pages') {
        throw new IpcRequestError(
          'import:commit',
          'Pages are added on Import pages, where you choose how they are tracked.'
        )
      }
      return withProject(host, request.projectId, 'import:commit', (opened) => {
        const facts = readProjectFacts(opened.db, opened.project)
        const target = destinationOf(facts, request.targetId)
        const resolved = {
          ...request,
          rows: request.rows.map((row) => ({
            keep: row.keep,
            values: resolveValues(
              request.entity,
              row.values,
              {},
              { stage: null, page: null, market: null },
              facts.markets
            )
          }))
        }
        const outcome =
          request.entity === 'questions' || request.entity === 'keywords'
            ? commitQuestions(host, opened, resolved, facts, target)
            : commitList(host, opened, resolved, facts)
        let batchId: string | null = null
        if (outcome.items.length > 0) {
          batchId = `batch-${host.createId()}`
          insertBatch(opened.db, {
            id: batchId,
            entity: request.entity,
            createdAt: host.now().toISOString(),
            items: outcome.items,
            added: outcome.added
          })
        }
        const skipped = outcome.skipped.length
        const message =
          outcome.added === 0
            ? `Nothing was added${skipped > 0 ? `: ${plural(skipped, request.entity)} skipped` : ''}.`
            : `Added ${plural(outcome.added, request.entity)}${skipped > 0 ? ` · ${skipped.toLocaleString('en-US')} skipped` : ''}.`
        return {
          batchId,
          added: outcome.added,
          skipped: outcome.skipped,
          promptIds: outcome.promptIds,
          message
        }
      })
    },

    async undo(request) {
      const plan = await withProject(host, request.projectId, 'import:undo', ({ db }) => {
        const batch = getBatch(db, request.batchId)
        if (batch === null) throw new IpcRequestError('import:undo', 'That import was not found.')
        if (batch.undoneAt !== null)
          throw new IpcRequestError('import:undo', 'That import was already undone.')
        return { batch, questions: planQuestionUndo(db, request.projectId, batch) }
      })
      let removed = 0
      const notes: string[] = []
      if (plan.questions.questions.length > 0) {
        const result = await updateQuestions(host, {
          projectId: request.projectId,
          action: 'remove',
          items: plan.questions.questions
        })
        removed += result.changed
        notes.push(...result.skipped.map((item) => item.reason))
      }
      removed += await withProject(host, request.projectId, 'import:undo', ({ db }) => {
        const count = undoOtherItems(db, request.projectId, plan.batch)
        markBatchUndone(db, request.batchId, host.now().toISOString())
        return count
      })
      const gone = plan.questions.gone
      const message = [
        `Undone: removed ${plural(removed, plan.batch.entity)}.`,
        gone > 0 ? `${gone.toLocaleString('en-US')} had already been removed or moved.` : '',
        ...new Set(notes)
      ]
        .filter(Boolean)
        .join(' ')
      return { removed, message }
    },

    async template(request) {
      if (dialogs === null) {
        throw new IpcRequestError(
          'import:template',
          'Saving a file is not available in this build.'
        )
      }
      const fileName = templateFileName(request.entity, request.format)
      const chosen = await dialogs.save({
        title: 'Save the import template',
        defaultPath: fileName,
        filters:
          request.format === 'xlsx'
            ? [{ name: 'Excel workbook', extensions: ['xlsx'] }]
            : [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (chosen.canceled || chosen.filePath === undefined) return { saved: false, fileName: null }
      await writeFile(chosen.filePath, await templateBytes(request.entity, request.format))
      return { saved: true, fileName: basename(chosen.filePath) }
    }
  }
}

/** Each word in the stage column, how many rows use it and what it means now. */
function stageWordsOf(
  rows: readonly (readonly string[])[],
  column: number,
  words: ImportStageWords
): ImportStageWord[] {
  const found = new Map<string, ImportStageWord>()
  for (const row of rows) {
    const word = (row[column] ?? '').trim()
    const key = foldWord(word)
    if (key.length === 0) continue
    const known = found.get(key)
    if (known !== undefined) {
      known.rows += 1
      continue
    }
    const stage = translateStage(word, words)
    found.set(key, {
      word,
      key,
      stage: stage === 'unknown' || stage === '' ? null : stage,
      rows: 1,
      builtIn: words[key] === undefined && BUILT_IN_STAGE_WORDS[key] !== undefined
    })
  }
  return [...found.values()]
}

/** Pages rows name on the own site that are not tracked yet. */
function newPagesOf(values: readonly Record<string, string>[], facts: ProjectFacts): string[] {
  const out = new Set<string>()
  for (const item of values) {
    const cell = (item.page ?? '').trim()
    if (cell.length === 0) continue
    const checked = checkPageUrl(cell, facts.domain, facts.includeSubdomains)
    if (checked.ok && !facts.trackedUrls.has(checked.url.toLowerCase())) out.add(checked.url)
  }
  return [...out]
}
