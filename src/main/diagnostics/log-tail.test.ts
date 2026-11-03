import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOG_LINE_MAX, LOG_TAIL_LINES, tailLogLines } from './log-tail'

const directories: string[] = []

function logFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-log-tail-'))
  directories.push(directory)
  return join(directory, 'citefox.log')
}

function numbered(from: number, to: number): string {
  return (
    Array.from({ length: to - from + 1 }, (_, index) => `line ${from + index}`).join('\n') + '\n'
  )
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('tailLogLines', () => {
  it('returns only the last 300 lines, oldest first', () => {
    const file = logFile()
    writeFileSync(file, numbered(1, 1000))
    const lines = tailLogLines(file)
    expect(LOG_TAIL_LINES).toBe(300)
    expect(lines).toHaveLength(300)
    expect(lines[0]).toBe('line 701')
    expect(lines[299]).toBe('line 1000')
  })

  it('fills from the rotated file when the active one is short', () => {
    const file = logFile()
    writeFileSync(`${file}.1`, numbered(1, 400))
    writeFileSync(file, numbered(401, 450))
    const lines = tailLogLines(file)
    expect(lines).toHaveLength(300)
    expect(lines[0]).toBe('line 151')
    expect(lines[299]).toBe('line 450')
  })

  it('gives an empty list for a missing or empty file, and for a count of zero', () => {
    const file = logFile()
    expect(tailLogLines(file)).toEqual([])
    writeFileSync(file, '')
    expect(tailLogLines(file)).toEqual([])
    writeFileSync(file, numbered(1, 5))
    expect(tailLogLines(file, 0)).toEqual([])
    expect(tailLogLines(file, 2)).toEqual(['line 4', 'line 5'])
  })

  it('cuts a very long line and reads a file much bigger than the read limit', () => {
    const file = logFile()
    const big = `${'x'.repeat(LOG_LINE_MAX + 500)}\n`
    writeFileSync(file, big.repeat(1500) + numbered(1, 3))
    const lines = tailLogLines(file)
    expect(lines).toHaveLength(300)
    expect(lines[299]).toBe('line 3')
    expect(lines[0]?.length).toBe(LOG_LINE_MAX + 1)
  })
})
