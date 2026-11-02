/**
 * Line-by-line diff for "Compare with default" (FR-26.5, TPL-5).
 * A longest-common-subsequence table over lines, so unchanged lines pair up and
 * every other line is an addition or a removal. Bodies are a few hundred lines at
 * most, so the quadratic table stays small.
 */

export type DiffKind = 'same' | 'add' | 'remove'

export interface DiffLine {
  kind: DiffKind
  text: string
}

export interface DiffSummary {
  added: number
  removed: number
}

/** `before` is the shipped default, `after` the current draft. Lines keep their order. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const left = splitLines(before)
  const right = splitLines(after)
  const rows = left.length
  const cols = right.length
  const width = cols + 1
  // table[i * width + j] = LCS length of left[i..] and right[j..].
  const table = new Uint32Array((rows + 1) * width)
  const cell = (i: number, j: number): number => table[i * width + j] ?? 0
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        left[i] === right[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1))
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    const removed = left[i] ?? ''
    const added = right[j] ?? ''
    if (removed === added) {
      lines.push({ kind: 'same', text: removed })
      i += 1
      j += 1
    } else if (cell(i + 1, j) >= cell(i, j + 1)) {
      lines.push({ kind: 'remove', text: removed })
      i += 1
    } else {
      lines.push({ kind: 'add', text: added })
      j += 1
    }
  }
  for (const text of left.slice(i)) lines.push({ kind: 'remove', text })
  for (const text of right.slice(j)) lines.push({ kind: 'add', text })
  return lines
}

/** Only the added and removed lines, in order. */
export function changedLines(lines: readonly DiffLine[]): DiffLine[] {
  return lines.filter((line) => line.kind !== 'same')
}

export function diffSummary(lines: readonly DiffLine[]): DiffSummary {
  return {
    added: lines.filter((line) => line.kind === 'add').length,
    removed: lines.filter((line) => line.kind === 'remove').length
  }
}

/** "2 lines added, 1 removed". Empty string when nothing changed. */
export function diffSummaryText(summary: DiffSummary): string {
  const parts: string[] = []
  if (summary.added > 0) {
    parts.push(summary.added === 1 ? '1 line added' : `${summary.added} lines added`)
  }
  if (summary.removed > 0) {
    parts.push(
      summary.removed === 1
        ? parts.length > 0
          ? '1 removed'
          : '1 line removed'
        : parts.length > 0
          ? `${summary.removed} removed`
          : `${summary.removed} lines removed`
    )
  }
  return parts.join(', ')
}

/** A trailing newline does not make an extra empty line, so "a\n" and "a" compare equal. */
function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return trimmed.length === 0 ? [] : trimmed.split('\n')
}
