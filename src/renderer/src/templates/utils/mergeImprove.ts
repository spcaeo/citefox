/**
 * Applies "Improve this template with Claude" line proposals to a draft (FR-26.7).
 * An added line goes after the line it follows when its detail names one, else
 * at the end. A removed line is deleted by exact match (surrounding spaces and a
 * leading "- " bullet are ignored). A line already in the draft is not added twice.
 */

export interface ImproveLine {
  text: string
  detail: string | null
  sign: 'add' | 'remove' | null
}

export function mergeImproveLines(body: string, items: readonly ImproveLine[]): string {
  const trailingNewline = body.endsWith('\n')
  const lines = body.length === 0 ? [] : (trailingNewline ? body.slice(0, -1) : body).split('\n')
  for (const item of items) {
    if (item.sign === 'remove') removeLine(lines, item.text)
  }
  /** Lines already inserted after each anchor, so several additions keep their order. */
  const inserted = new Set<string>()
  for (const item of items) {
    if (item.sign === 'remove') continue
    const text = item.text.trim()
    if (text.length === 0 || lines.some((line) => sameLine(line, text))) continue
    const anchor = anchorIndex(lines, item.detail)
    if (anchor === -1) {
      lines.push(text)
      continue
    }
    let at = anchor + 1
    while (at < lines.length && inserted.has(lines[at] ?? '')) at += 1
    lines.splice(at, 0, text)
    inserted.add(text)
  }
  const merged = lines.join('\n')
  return trailingNewline || (body.length === 0 && merged.length > 0) ? `${merged}\n` : merged
}

function removeLine(lines: string[], text: string): void {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (sameLine(lines[index] ?? '', text)) lines.splice(index, 1)
  }
}

function sameLine(line: string, text: string): boolean {
  return normalize(line) === normalize(text) && normalize(text).length > 0
}

function normalize(text: string): string {
  return text
    .trim()
    .replace(/^[-*]\s+/, '')
    .trim()
}

/**
 * The line an addition follows. The detail may be the line itself, "After: <line>",
 * or a sentence that quotes the line or its start ("Add after the line that starts
 * \"- Write it in full sentences\""). Falls back to a line the detail contains in
 * full. -1 when it names no line in the draft.
 */
function anchorIndex(lines: readonly string[], detail: string | null): number {
  if (detail === null) return -1
  const named = detail
    .trim()
    .replace(/^(add\s+)?(after|follows|below)(\s+the\s+line)?\s*:?\s*/i, '')
    .replace(/^["'“‘]|["'”’.]+$/g, '')
    .trim()
  if (named.length > 0) {
    const exact = lines.findIndex((line) => sameLine(line, named))
    if (exact !== -1) return exact
  }
  for (const match of detail.matchAll(/["“]([^"”]{3,})["”]/g)) {
    const quoted = (match[1] ?? '').trim()
    const exact = lines.findIndex((line) => sameLine(line, quoted))
    if (exact !== -1) return exact
    const start = lines.findIndex(
      (line) => line.trim().startsWith(quoted) || normalize(line).startsWith(normalize(quoted))
    )
    if (start !== -1) return start
  }
  return lines.findIndex((line) => {
    const text = normalize(line)
    return text.length >= 12 && detail.includes(text)
  })
}
