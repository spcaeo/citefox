import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { appLogFilePath, createRotatingFileSink, teeSinks } from './file-sink'
import { createLogger } from './logger'
import { REDACTED } from './redact'

const ANTHROPIC = `sk-ant-api03-${'f'.repeat(24)}`
const KEYCHAIN_SECRET = 'correct-horse-battery'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'citefox-log-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('rotating file sink', () => {
  test('puts the log in <userData>/logs/citefox.log and creates the folder', () => {
    const file = appLogFilePath(dir)
    expect(file).toBe(join(dir, 'logs', 'citefox.log'))
    createRotatingFileSink({ file })('info', 'first line')
    expect(readFileSync(file, 'utf8')).toBe('first line\n')
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(statSync(join(dir, 'logs')).mode & 0o777).toBe(0o700)
    }
  })

  test('rotates by size and keeps only maxFiles files', () => {
    const file = join(dir, 'logs', 'citefox.log')
    const sink = createRotatingFileSink({ file, maxBytes: 20, maxFiles: 3 })
    for (const line of ['line-01', 'line-02', 'line-03', 'line-04', 'line-05', 'line-06']) {
      sink('info', line)
    }
    // Each line is 8 bytes with its newline, so two fit in 20 bytes.
    expect(readFileSync(file, 'utf8')).toBe('line-05\nline-06\n')
    expect(readFileSync(`${file}.1`, 'utf8')).toBe('line-03\nline-04\n')
    expect(readFileSync(`${file}.2`, 'utf8')).toBe('line-01\nline-02\n')
    sink('info', 'line-07')
    expect(readFileSync(`${file}.2`, 'utf8')).toBe('line-03\nline-04\n')
    expect(existsSync(`${file}.3`)).toBe(false)
  })

  test('counts an existing file toward the limit after a restart', () => {
    const file = join(dir, 'citefox.log')
    writeFileSync(file, 'x'.repeat(15))
    createRotatingFileSink({ file, maxBytes: 20, maxFiles: 2 })('info', 'next-line')
    expect(readFileSync(`${file}.1`, 'utf8')).toBe('x'.repeat(15))
    expect(readFileSync(file, 'utf8')).toBe('next-line\n')
  })

  test('a line longer than the limit still lands in a file of its own', () => {
    const file = join(dir, 'citefox.log')
    const sink = createRotatingFileSink({ file, maxBytes: 10, maxFiles: 2 })
    sink('info', 'short')
    sink('info', 'a line much longer than ten bytes')
    expect(readFileSync(file, 'utf8')).toBe('a line much longer than ten bytes\n')
    expect(readFileSync(`${file}.1`, 'utf8')).toBe('short\n')
  })

  test('a write that cannot reach the disk is dropped without throwing', () => {
    const blocker = join(dir, 'not-a-folder')
    writeFileSync(blocker, '')
    const sink = createRotatingFileSink({ file: join(blocker, 'citefox.log') })
    expect(() => sink('error', 'lost')).not.toThrow()
  })

  test('teeSinks sends each line to every sink', () => {
    const left: string[] = []
    const right: string[] = []
    teeSinks(
      (_level, line) => left.push(line),
      (_level, line) => right.push(line)
    )('warn', 'both')
    expect(left).toEqual(['both'])
    expect(right).toEqual(['both'])
  })
})

describe('logger to file', () => {
  test('writes only redacted lines, including keychain secrets seeded later', () => {
    const file = appLogFilePath(dir)
    const seeded: string[] = []
    const logger = createLogger({
      write: createRotatingFileSink({ file }),
      secrets: () => seeded
    })
    seeded.push(KEYCHAIN_SECRET)
    logger.info(`login with ${KEYCHAIN_SECRET}`, { authorization: `Bearer ${ANTHROPIC}` })
    logger.error('send failed', new Error(`smtp_password=${KEYCHAIN_SECRET} key ${ANTHROPIC}`))
    const text = readFileSync(file, 'utf8')
    expect(text).not.toContain(KEYCHAIN_SECRET)
    expect(text).not.toContain(ANTHROPIC)
    expect(text).toContain(REDACTED)
    expect(text).toMatch(/ INFO login with \[REDACTED\]/)
    expect(text).toContain(' ERROR send failed ')
    expect(text.trimEnd().split('\n')).toHaveLength(2)
  })
})
