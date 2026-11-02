import { appendFileSync, chmodSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LogLevel } from './logger'

/** 5 MB per file. */
export const LOG_FILE_MAX_BYTES = 5 * 1024 * 1024
/** `citefox.log` plus `citefox.log.1` and `citefox.log.2`. */
export const LOG_FILE_COUNT = 3
export const LOG_FILE_NAME = 'citefox.log'

/** `<userData>/logs/citefox.log`. Shown in startup error dialogs. */
export function appLogFilePath(userDataDir: string): string {
  return join(userDataDir, 'logs', LOG_FILE_NAME)
}

export interface RotatingFileSinkOptions {
  /** Active log file. Older files get `.1`, `.2`, … appended. */
  file: string
  maxBytes?: number
  /** Total files kept, including the active one. At least 1. */
  maxFiles?: number
}

export type LogSink = (level: LogLevel, line: string) => void

/**
 * A log sink that appends lines to `file` and rotates it by size.
 * When the next line would push the file past `maxBytes`, `file.N-1` is
 * removed, every `file.K` moves to `file.K+1`, and `file` becomes `file.1`.
 *
 * Writes are synchronous so the last lines before a crash reach the disk.
 * A failing write is dropped: logging must never take the app down.
 * The sink writes what it is given; the logger redacts before calling it.
 */
export function createRotatingFileSink(options: RotatingFileSinkOptions): LogSink {
  const maxBytes = Math.max(1, options.maxBytes ?? LOG_FILE_MAX_BYTES)
  const maxFiles = Math.max(1, Math.floor(options.maxFiles ?? LOG_FILE_COUNT))
  let size: number | undefined

  const currentSize = (): number => {
    if (size !== undefined) return size
    mkdirSync(dirname(options.file), { recursive: true, mode: 0o700 })
    try {
      size = statSync(options.file).size
    } catch {
      size = 0
    }
    return size
  }

  const rotate = (): void => {
    rmSync(rotatedName(options.file, maxFiles - 1), { force: true })
    for (let index = maxFiles - 2; index >= 1; index -= 1) {
      renameIfPresent(rotatedName(options.file, index), rotatedName(options.file, index + 1))
    }
    if (maxFiles > 1) renameIfPresent(options.file, rotatedName(options.file, 1))
    else rmSync(options.file, { force: true })
    size = 0
  }

  return (_level, line) => {
    const text = `${line}\n`
    const bytes = Buffer.byteLength(text)
    try {
      const existing = currentSize()
      if (existing > 0 && existing + bytes > maxBytes) rotate()
      const fresh = size === 0
      appendFileSync(options.file, text, { encoding: 'utf8', mode: 0o600 })
      if (fresh) restrictFile(options.file)
      size = (size ?? 0) + bytes
    } catch {
      size = undefined
    }
  }
}

/** Sends each line to every sink in order. */
export function teeSinks(...sinks: readonly LogSink[]): LogSink {
  return (level, line) => {
    for (const sink of sinks) sink(level, line)
  }
}

function rotatedName(file: string, index: number): string {
  return index === 0 ? file : `${file}.${index}`
}

function renameIfPresent(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch (error: unknown) {
    if (!isMissing(error)) throw error
  }
}

function restrictFile(file: string): void {
  if (process.platform === 'win32') return
  try {
    chmodSync(file, 0o600)
  } catch {
    // Best effort. The folder is already 0700.
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
