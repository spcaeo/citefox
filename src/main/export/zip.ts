import { crc32 } from 'node:zlib'

export interface ZipEntry {
  name: string
  data: Buffer
}

/**
 * A stored (method 0) ZIP. CSV exports are one file per section, zipped (FR-22.2).
 * Names are UTF-8. The reader understands the files this writer produces.
 */
export function zipStore(entries: readonly ZipEntry[]): Buffer {
  const parts: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const checksum = crc32(entry.data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, name, entry.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + entry.data.length
  }

  const centralOffset = offset
  let centralSize = 0
  for (const part of centrals) {
    parts.push(part)
    centralSize += part.length
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)
  parts.push(end)
  return Buffer.concat(parts)
}

/** Read a ZIP written by {@link zipStore}. Other ZIP layouts are not supported. */
export function readStoredZip(bytes: Uint8Array): ZipEntry[] {
  const data = Buffer.from(bytes)
  const end = findEnd(data)
  const count = data.readUInt16LE(end + 10)
  let cursor = data.readUInt32LE(end + 16)
  const entries: ZipEntry[] = []

  for (let index = 0; index < count; index += 1) {
    if (data.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Export zip is missing a central directory entry')
    }
    const method = data.readUInt16LE(cursor + 10)
    if (method !== 0) throw new Error('Export zip entry is compressed')
    const nameLength = data.readUInt16LE(cursor + 28)
    const extraLength = data.readUInt16LE(cursor + 30)
    const commentLength = data.readUInt16LE(cursor + 32)
    const localOffset = data.readUInt32LE(cursor + 42)
    const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    cursor += 46 + nameLength + extraLength + commentLength

    if (data.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('Export zip is missing a local file header')
    }
    const localNameLength = data.readUInt16LE(localOffset + 26)
    const localExtraLength = data.readUInt16LE(localOffset + 28)
    const size = data.readUInt32LE(localOffset + 22)
    const start = localOffset + 30 + localNameLength + localExtraLength
    entries.push({ name, data: Buffer.from(data.subarray(start, start + size)) })
  }

  return entries
}

function findEnd(data: Buffer): number {
  const signature = 0x06054b50
  const minimum = Math.max(0, data.length - 22 - 0xffff)
  for (let offset = data.length - 22; offset >= minimum; offset -= 1) {
    if (data.readUInt32LE(offset) === signature) return offset
  }
  throw new Error('Export zip is missing an end record')
}
