/**
 * The shared importer (deep audit crosscut §5): paste, CSV, TSV or Excel in, columns
 * matched, every row checked, then added as one batch that can be undone. Files are
 * chosen through the native open dialog in main; no path ever crosses IPC (a token
 * stands for the picked file). Every check is a dry run: nothing is saved before
 * `import:commit`, and nothing is searched by an import.
 */

import type { TopicStage } from '../domain'
import type { ImportEntity, ImportStageWords } from '../import-fields'
import { invokeWith, type InvokeChannelSpecs } from './contract'

export type { ImportEntity, ImportStageWords } from '../import-fields'

/** Largest file the open dialog accepts. */
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024
/** Largest pasted text. */
export const IMPORT_MAX_PASTE_CHARS = 2 * 1024 * 1024
/** Rows read from one file or paste (after the header). Later rows are left out with a warning. */
export const IMPORT_MAX_ROWS = 5000
/** Columns read; later ones are left out with a warning. */
export const IMPORT_MAX_COLUMNS = 50
/** Characters kept per cell; longer cells are cut with a warning. */
export const IMPORT_MAX_CELL = 500

export type ImportFileKind = 'csv' | 'tsv' | 'xlsx' | 'txt'

export interface ImportPickFileRequest {
  entity: ImportEntity
}

/** `import:pickFile`: the picked file stands for a token; the path stays in main. */
export type ImportPickFileResult =
  | { cancelled: true }
  | {
      cancelled: false
      token: string
      name: string
      bytes: number
      kind: ImportFileKind
    }

/**
 * Where rows come from: pasted text, a file picked through the open dialog (a
 * token), or a file dropped on the drawer (its bytes as base64; never a path).
 */
export type ImportSource =
  | { kind: 'paste'; text: string }
  | { kind: 'file'; token: string; sheet: string | null }
  | { kind: 'dropped'; name: string; data: string; sheet: string | null }

/** Longest base64 text a dropped file may send (10 MB of bytes). */
export const IMPORT_MAX_DROPPED_CHARS = Math.ceil((10 * 1024 * 1024) / 3) * 4

export interface ImportReadRequest {
  projectId: string
  entity: ImportEntity
  source: ImportSource
  /** Null: detect it. */
  hasHeader: boolean | null
}

export interface ImportColumn {
  index: number
  /** "A", "B"… */
  letter: string
  /** The header cell, or "" when the file has no header row. */
  header: string
  /** The first values under it (at most three, empty cells left out). */
  samples: readonly string[]
}

/** One column per entry: the CiteFox field it fills, or null (don't import). */
export type ImportMapping = readonly (string | null)[]

/** `import:read`: the table found, its columns and the column match guessed or saved. */
export interface ImportReadResult {
  sourceId: string
  /** The file name, or "Pasted rows". */
  name: string
  kind: ImportFileKind | 'paste'
  /** Visible sheets of an Excel file, in order. Empty otherwise. */
  sheets: readonly string[]
  sheet: string | null
  /** Data rows (the header row not counted). */
  rowCount: number
  hasHeader: boolean
  columns: readonly ImportColumn[]
  mapping: ImportMapping
  /** True when the mapping is a saved column match for files with these headers. */
  mappingSaved: boolean
  /** Saved meanings of stage words ("awareness" → problem). */
  stageWords: ImportStageWords
  /** Rows, columns or cells left out or cut, in plain words. */
  warnings: readonly string[]
}

/** Values that apply to rows that leave a column empty. */
export interface ImportDefaults {
  stage: TopicStage | null
  /** A page URL or path. */
  page: string | null
  /** A market id of the project. */
  market: string | null
}

/** Checks the expert options change. */
export interface ImportRules {
  /** Short phrases with no question shape are tracked as keywords (topics only). Default true. */
  keywords: boolean
}

export interface ImportPreviewRequest {
  projectId: string
  entity: ImportEntity
  sourceId: string
  mapping: ImportMapping
  stageWords: ImportStageWords
  defaults: ImportDefaults
  rules: ImportRules
  /** The page or topic the rows go to. Null for lists that are not added to one. */
  targetId: string | null
  /** Save this column match (and the stage words) for files with the same headers. */
  saveMapping: boolean
}

/** What a row will do: be added (as a question or a keyword), wait for a choice, be skipped, or wait for a fix. */
export const IMPORT_RESULTS = ['new', 'keyword', 'similar', 'duplicate', 'fix'] as const
export type ImportResult = (typeof IMPORT_RESULTS)[number]

/** Which one-click fix a "Needs a fix" row can take. */
export type ImportFixKind =
  'empty' | 'stage' | 'market' | 'page' | 'topic' | 'brand' | 'long' | 'short' | 'invalid' | 'limit'

/** The tracked item a duplicate or similar row matches. */
export interface ImportMatch {
  text: string
  sourceId: string
  sourceName: string
  /** True when it is in the page or topic the rows go to. */
  sameTarget: boolean
}

/**
 * Field id → value. A stage holds a stage id once translated. Besides the fields a
 * row may carry `stageRaw` / `marketRaw` (words not understood), `createTopic: '1'`
 * (create the topic its Topic cell names) and `addMarket: '1'` (add its market to
 * the page or topic it goes to).
 */
export type ImportValues = Readonly<Record<string, string>>

export interface ImportRowCheck {
  result: ImportResult
  /** Plain words: "3 words: tracked as a keyword", "Already tracked in …". Null for a plain new row. */
  reason: string | null
  fix: ImportFixKind | null
  match: ImportMatch | null
  /** `question` or `keyword` for question rows; null for other lists. */
  kind: 'question' | 'keyword' | null
  /**
   * A duplicate that is the same question with only a year, an article or a plural
   * changed (`questionMergeKey`): merged into the earlier row or the tracked question.
   */
  merged?: boolean
}

export interface ImportRow extends ImportRowCheck {
  /** The row number in the file (1 is the first line, the header when there is one). */
  row: number
  values: ImportValues
}

export type ImportCounts = Readonly<Record<ImportResult, number>> & {
  total: number
  /** Of the duplicates, those merged as near duplicates ("3 similar merged"). */
  merged?: number
}

/** One word found in the stage column and what it means. */
export interface ImportStageWord {
  /** As written in the file. */
  word: string
  /** Folded, the key in `stageWords`. */
  key: string
  stage: TopicStage | null
  rows: number
  /** True for the words every import knows (TOFU, Problem…). */
  builtIn: boolean
}

/** `import:preview`: every row checked (a dry run; counts add up to the file). */
export interface ImportPreview {
  sourceId: string
  entity: ImportEntity
  rows: readonly ImportRow[]
  counts: ImportCounts
  stageWords: readonly ImportStageWord[]
  /** Market codes rows name that the project does not check in. */
  unknownMarkets: readonly string[]
  /** Pages rows name that are not tracked yet (full URLs). */
  newPages: readonly string[]
}

export interface ImportValidateRequest {
  projectId: string
  entity: ImportEntity
  targetId: string | null
  rules: ImportRules
  rows: readonly { key: string; values: ImportValues; keep?: boolean }[]
}

/** `import:validate`: the live checks of rows typed or pasted into Add questions. */
export interface ImportValidateResult {
  rows: readonly (ImportRowCheck & { key: string })[]
  counts: ImportCounts
}

export interface ImportCommitRow {
  values: ImportValues
  /** A similar row the user chose to keep next to the tracked one. */
  keep: boolean
}

export interface ImportCommitRequest {
  projectId: string
  entity: ImportEntity
  targetId: string | null
  rules: ImportRules
  rows: readonly ImportCommitRow[]
}

/**
 * `import:commit`: the rows that still check as new (or kept) are added as one
 * batch; the rest are listed in `skipped` with the reason. Nothing is searched.
 */
export interface ImportCommitResult {
  /** Null when nothing was added. */
  batchId: string | null
  added: number
  skipped: readonly { index: number; reason: string }[]
  /** Question imports: the new prompt ids, by page or topic, for "Check now". */
  promptIds: readonly { sourceId: string; promptIds: readonly string[] }[]
  message: string
}

export interface ImportUndoRequest {
  projectId: string
  batchId: string
}

export interface ImportUndoResult {
  removed: number
  message: string
}

export interface ImportTemplateRequest {
  entity: ImportEntity
  format: 'csv' | 'xlsx'
}

/** `import:template`: written through the save dialog. */
export interface ImportTemplateResult {
  saved: boolean
  fileName: string | null
}

/** Rows Add questions keeps while they are not added yet (W3I-C4). */
export const QUESTIONS_DRAFT_MAX_ROWS = 1000

/** Where a draft row came from, as Add questions shows it. */
export type QuestionsDraftOrigin = 'typed' | 'suggested' | 'imported' | 'tracked'

/** One unsaved row of Add questions. */
export interface QuestionsDraftRow {
  question: string
  /** A stage id, or '' for none. */
  stage: TopicStage | ''
  page: string
  market: string
  tags: string
  topic: string
  createTopic: boolean
  addMarket: boolean
  keep: boolean
  origin: QuestionsDraftOrigin
}

export interface ImportDraftRequest {
  projectId: string
}

/** `import:saveDraft`: the rows typed, pasted, imported or picked, before they are added. */
export interface SaveQuestionsDraftRequest {
  projectId: string
  /** The page or topic the rows were for. */
  targetId: string | null
  defaultPage: string | null
  rows: readonly QuestionsDraftRow[]
}

/**
 * `import:getDraft`: Add questions' unsaved rows for a project, kept in main until
 * they are added or discarded, so they survive a reload or a restart.
 */
export interface QuestionsDraft extends SaveQuestionsDraftRequest {
  /** ISO-8601 UTC. */
  savedAt: string
}

/** Invoke channels for this area. Each one is declared here only. */
export const importerChannels = {
  'import:pickFile': invokeWith<ImportPickFileRequest, ImportPickFileResult>(),
  'import:read': invokeWith<ImportReadRequest, ImportReadResult>(),
  'import:preview': invokeWith<ImportPreviewRequest, ImportPreview>(),
  'import:validate': invokeWith<ImportValidateRequest, ImportValidateResult>(),
  'import:commit': invokeWith<ImportCommitRequest, ImportCommitResult>(),
  'import:undo': invokeWith<ImportUndoRequest, ImportUndoResult>(),
  'import:template': invokeWith<ImportTemplateRequest, ImportTemplateResult>(),
  'import:getDraft': invokeWith<ImportDraftRequest, QuestionsDraft | null>(),
  'import:saveDraft': invokeWith<SaveQuestionsDraftRequest, { saved: boolean }>(),
  'import:clearDraft': invokeWith<ImportDraftRequest, { cleared: boolean }>()
} as const satisfies InvokeChannelSpecs
