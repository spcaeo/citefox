import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

/** The report holds this many log lines. */
export const LOG_TAIL_LINES = 300

/** A single log line is cut here, so one huge line cannot fill the report. */
export const LOG_LINE_MAX = 2_000

/** Read at most this much from the end of a file. */
const READ_LIMIT_BYTES = 1024 * 1024

/** The last bytes of a file as text. A missing or unreadable file is empty. */
function readEnd(file: string): string {
  let fd: number
  try {
    fd = openSync(file, 'r')
  } catch {
    return ''
  }
  try {
    const size = fstatSync(fd).size
    const length = Math.min(size, READ_LIMIT_BYTES)
    if (length === 0) return ''
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)
    const text = buffer.toString('utf8')
    // A read that starts mid-file starts mid-line: drop the cut first line.
    return size > length ? text.slice(text.indexOf('\n') + 1) : text
  } catch {
    return ''
  } finally {
    closeSync(fd)
  }
}

function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * The last `count` lines of the log, oldest first. When the active file is shorter than
 * that, the end of the rotated file (`.1`) fills the rest. Each line is cut at
 * {@link LOG_LINE_MAX} characters.
 */
export function tailLogLines(file: string, count: number = LOG_TAIL_LINES): string[] {
  const wanted = Math.max(0, Math.floor(count))
  if (wanted === 0) return []
  let lines = linesOf(readEnd(file))
  if (lines.length < wanted) lines = [...linesOf(readEnd(`${file}.1`)), ...lines]
  return lines
    .slice(-wanted)
    .map((line) => (line.length > LOG_LINE_MAX ? `${line.slice(0, LOG_LINE_MAX)}…` : line))
}
