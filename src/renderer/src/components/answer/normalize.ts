/**
 * Tidies an AI answer's stored markdown before it is parsed. Pure text in,
 * text out; code blocks are left exactly as they are.
 */

/** A GFM table's delimiter row, with or without the outer pipes: `---|---|---`. */
const DELIMITER_ROW = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/
/** A code fence opening or closing line. */
const FENCE = /^\s*(```|~~~)/
/** ChatGPT's copy-button caption above a code block ("text", "bash"), scraped as a line. */
const FENCE_CAPTION = /^\s*[a-z][a-z0-9+#-]{0,11}\s*$/

export function normalizeAnswer(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let inFence = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (FENCE.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    if (FENCE_CAPTION.test(line) && isCaptionAboveFence(lines, index)) continue
    // A table right under a paragraph line would be read as part of it: give it its own block.
    const next = lines[index + 1]
    if (
      next !== undefined &&
      line.includes('|') &&
      DELIMITER_ROW.test(next) &&
      out.length > 0 &&
      (out[out.length - 1] ?? '').trim() !== ''
    ) {
      out.push('')
    }
    out.push(line)
  }
  return out.join('\n').trim()
}

/** True when the next non-blank line opens a code block with no language of its own. */
function isCaptionAboveFence(lines: readonly string[], index: number): boolean {
  const before = lines[index - 1]
  if (before !== undefined && before.trim() !== '') return false
  for (let next = index + 1; next < lines.length; next += 1) {
    const line = (lines[next] ?? '').trim()
    if (line === '') continue
    return line === '```' || line === '~~~'
  }
  return false
}
