import type { TopicDraftPrompt, TopicPromptFlag, TopicStage } from '@shared/domain'
import type { CsvColumnsResult, TopicCsvMapping } from '@shared/ipc'
import { namesAny } from './text'

/** Pasted text: one question per line, list markers and quotes trimmed, blanks dropped. */
export function parsePasted(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
        .replace(/^["“']+|["”']+$/g, '')
        .trim()
    )
    .filter((line) => line.length > 0)
}

/** A CSV file (RFC 4180: quoted fields, doubled quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0))
}

function findColumn(headers: readonly string[], pattern: RegExp): number | null {
  const index = headers.findIndex((header) => pattern.test(header.trim().toLowerCase()))
  return index >= 0 ? index : null
}

const HEADER_WORDS = /question|query|prompt|text|keyword|source|channel|note|comment/

/** Columns, a sample and a best-guess mapping (the mock's `topics:readCsvColumns`). */
export function csvColumns(content: string): CsvColumnsResult {
  const rows = parseCsv(content)
  const first = rows[0] ?? []
  const hasHeader = first.some((cell) => HEADER_WORDS.test(cell.trim().toLowerCase()))
  const columns = hasHeader
    ? first.map((cell) => cell.trim())
    : first.map((_, index) => `Column ${index + 1}`)
  const body = hasHeader ? rows.slice(1) : rows
  const question = hasHeader ? (findColumn(first, /question|query|prompt|text|keyword/) ?? 0) : 0
  const source = hasHeader ? findColumn(first, /source|channel|origin/) : null
  const notes = hasHeader ? findColumn(first, /note|comment/) : null
  return {
    columns,
    sample: body.slice(0, 5),
    rows: body.length,
    guess: {
      question,
      source: source === question ? null : source,
      notes: notes === question ? null : notes,
      hasHeader
    }
  }
}

export interface RawLine {
  text: string
  source: string
}

/** The CSV's lines under a mapping. */
export function csvLines(content: string, mapping: TopicCsvMapping): RawLine[] {
  const rows = parseCsv(content)
  const body = mapping.hasHeader ? rows.slice(1) : rows
  const lines: RawLine[] = []
  for (const row of body) {
    const text = (row[mapping.question] ?? '').trim()
    if (!text) continue
    const source =
      mapping.source === null || mapping.source === undefined
        ? 'CSV'
        : (row[mapping.source] ?? '').trim() || 'CSV'
    lines.push({ text, source })
  }
  return lines
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const SHORT_WORDS = 4

/** Rule-based stage guess until Claude tags the lines (clean-up keeps the user's wording). */
export function guessStage(text: string): TopicStage {
  const t = text.toLowerCase()
  if (/\b(cost|price|pricing|pay|trial|set up|setup|switch|how fast|how quickly)\b/.test(t))
    return 'decide'
  if (/\b(vs|versus|alternative|cheaper|better than|compare|different from)\b/.test(t))
    return 'compare'
  if (/\b(legal|reliable|spam|opt in|opt-in|block|secure|10dlc|fail|stop|disturb)\b/.test(t))
    return 'doubts'
  if (
    /\b(we're a|we are a|for a|company|school|clinic|church|volunteers|enough for|location)\b/.test(
      t
    )
  )
    return 'fit'
  if (/\b(option|options|can i|should we|is there a|what replaced|do we need|zapier)\b/.test(t))
    return 'options'
  return 'problem'
}

export interface CleanupOutcome {
  prompts: TopicDraftPrompt[]
  duplicatesMerged: number
  brandFlagged: number
  shortFlagged: number
}

/**
 * The clean-up preview (spec §3): duplicates merged, brand names flagged and
 * left out, very short lines flagged but kept. Wording is never changed here.
 */
export function cleanUp(
  lines: readonly RawLine[],
  brandNames: readonly string[],
  makeId: () => string
): CleanupOutcome {
  const byKey = new Map<string, TopicDraftPrompt>()
  let duplicatesMerged = 0
  for (const line of lines) {
    const key = normalise(line.text)
    if (!key) continue
    const existing = byKey.get(key)
    if (existing) {
      duplicatesMerged += 1
      const flags: TopicPromptFlag[] = existing.flags.includes('merged')
        ? [...existing.flags]
        : [...existing.flags, 'merged']
      byKey.set(key, { ...existing, mergedFrom: [...existing.mergedFrom, line.text], flags })
      continue
    }
    const flags: TopicPromptFlag[] = []
    const brand = namesAny(line.text, brandNames)
    if (brand) flags.push('brand')
    if (key.split(' ').length < SHORT_WORDS) flags.push('short')
    byKey.set(key, {
      id: makeId(),
      kind: 'question',
      text: line.text,
      stage: guessStage(line.text),
      source: 'imported',
      sourceNote: line.source,
      included: !brand,
      kwGroup: null,
      kwGroupKind: null,
      kwFamily: null,
      intent: null,
      funnel: null,
      pageType: null,
      targetPageId: null,
      targetUrl: null,
      matchConfidence: null,
      matchReason: null,
      matchStatus: 'unmatched',
      flags,
      overlapWith: [],
      mergedFrom: [],
      previousText: null
    })
  }
  const prompts = [...byKey.values()]
  return {
    prompts,
    duplicatesMerged,
    brandFlagged: prompts.filter((p) => p.flags.includes('brand')).length,
    shortFlagged: prompts.filter((p) => p.flags.includes('short')).length
  }
}
