import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'

/** File operations the publisher uses. Tests replace `rename` or `writeFile` to fail a write. */
export interface ExportAtomicIo {
  writeFile(filePath: string, bytes: Uint8Array): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(filePath: string): Promise<void>
}

export function nodeExportIo(): ExportAtomicIo {
  return {
    writeFile: async (filePath, bytes) => {
      durableWrite(filePath, bytes)
    },
    rename: async (from, to) => {
      renameSync(from, to)
    },
    unlink: async (filePath) => {
      unlinkSync(filePath)
    }
  }
}

export function safeJoin(directory: string, filename: string): string {
  if (
    filename.length === 0 ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0')
  ) {
    throw new Error('Unsafe export filename')
  }
  const root = resolve(directory)
  const full = resolve(root, filename)
  const fromRoot = relative(root, full)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('Unsafe export filename')
  return full
}

export function temporaryPath(finalPath: string): string {
  return `${finalPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
}

/**
 * Replace `finalPath` by writing `bytes` to a temp file and renaming it.
 * A failure deletes the temp file and leaves any previous file in place.
 */
export async function publishBytes(
  directory: string,
  filename: string,
  bytes: Uint8Array,
  io: ExportAtomicIo
): Promise<string> {
  const finalPath = safeJoin(directory, filename)
  const tempPath = temporaryPath(finalPath)
  try {
    await io.writeFile(tempPath, bytes)
    await io.rename(tempPath, finalPath)
  } catch (error) {
    await removeQuietly(io, tempPath)
    throw error
  }
  return finalPath
}

/** Rename a file that was streamed to `tempPath`. Failure removes the temp file. */
export async function publishReadyFile(
  tempPath: string,
  finalPath: string,
  io: ExportAtomicIo
): Promise<void> {
  try {
    fsyncFile(tempPath)
    await io.rename(tempPath, finalPath)
  } catch (error) {
    await removeQuietly(io, tempPath)
    throw error
  }
}

export function fsyncFile(filePath: string): void {
  const fd = openSync(filePath, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

export async function removeQuietly(io: ExportAtomicIo, filePath: string): Promise<void> {
  try {
    await io.unlink(filePath)
  } catch {
    // The temp file is absent when the write itself failed.
  }
}

function durableWrite(filePath: string, bytes: Uint8Array): void {
  const fd = openSync(filePath, 'w', 0o600)
  try {
    const buffer = Buffer.from(bytes)
    let offset = 0
    while (offset < buffer.length) {
      const written = writeSync(fd, buffer, offset, buffer.length - offset)
      if (written <= 0) throw new Error('Could not write file')
      offset += written
    }
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
