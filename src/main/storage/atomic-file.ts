import {
  closeSync,
  fchmodSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { randomBytes } from 'node:crypto'

export interface AtomicFileIo {
  write(filePath: string, contents: string): void
  rename(from: string, to: string): void
  unlink(filePath: string): void
}

const nodeIo: AtomicFileIo = {
  write: durableWrite,
  rename: renameSync,
  unlink: unlinkSync
}

/**
 * Write `contents` by replacing `filePath` in one rename. A crash during the
 * write leaves the previous file in place. The temp file is removed if the
 * rename fails.
 */
export function atomicWriteFile(
  filePath: string,
  contents: string,
  io: AtomicFileIo = nodeIo
): void {
  const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    io.write(temporary, contents)
    io.rename(temporary, filePath)
  } catch (error) {
    try {
      io.unlink(temporary)
    } catch {
      // The temp file is absent when the write itself failed.
    }
    throw error
  }
}

/**
 * Write `bytes` by replacing `filePath` in one rename. A crash during the
 * write leaves the previous file in place. The temp file is removed if the
 * rename fails. PDF bytes use this so a binary file is not encoded as text.
 */
export function atomicWriteBytes(filePath: string, bytes: Uint8Array): void {
  const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    durableWriteBytes(temporary, bytes)
    renameSync(temporary, filePath)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {
      // The temp file is absent when the write itself failed.
    }
    throw error
  }
}

function durableWrite(filePath: string, contents: string): void {
  const fd = openSync(filePath, 'w', 0o600)
  try {
    writeFileSync(fd, contents, { encoding: 'utf8' })
    if (process.platform !== 'win32') fchmodSync(fd, 0o600)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function durableWriteBytes(filePath: string, bytes: Uint8Array): void {
  const fd = openSync(filePath, 'w', 0o600)
  try {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 0
    while (offset < buffer.length) {
      const written = writeSync(fd, buffer, offset, buffer.length - offset)
      if (written <= 0) throw new Error('Could not write file')
      offset += written
    }
    if (process.platform !== 'win32') fchmodSync(fd, 0o600)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
