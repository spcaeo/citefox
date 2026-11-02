import { createHash } from 'node:crypto'

/** SHA-256 hex of the normalized body. This is the content fingerprint (FR-2.3). */
export function contentHash(body: string): string {
  return sha256(normalizeBody(body))
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Whitespace is collapsed and the text is Unicode-normalized. Case is kept,
 * so a capitalization edit still changes the fingerprint.
 */
export function normalizeBody(text: string): string {
  // Trailing blanks are trimmed per line by hand: `/[ \t]+\n/g` backtracks
  // quadratically on a long run of spaces that does not end in a newline.
  return text
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(trimTrailingBlanks)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function trimTrailingBlanks(line: string): string {
  let end = line.length
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end -= 1
  return end === line.length ? line : line.slice(0, end)
}

export function wordCount(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

/** NFR-7. The same template, prompt, and schema reuse a stored Claude output. */
export function llmInputHash(parts: {
  templateHash: string
  prompt: string
  schema: unknown
}): string {
  return sha256(
    JSON.stringify({
      templateHash: parts.templateHash,
      prompt: parts.prompt,
      schema: parts.schema
    })
  )
}

/**
 * The stored-output key: the input hash plus the model and the connection that
 * answer it, so switching either one does not return the other's cached output.
 * A null model is the connection's default model.
 */
export function generationCacheKey(parts: {
  inputHash: string
  model: string | null
  connection: string
}): string {
  return sha256(
    JSON.stringify({ inputHash: parts.inputHash, model: parts.model, connection: parts.connection })
  )
}
