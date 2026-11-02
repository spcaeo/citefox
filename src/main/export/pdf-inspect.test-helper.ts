import { inflateSync } from 'node:zlib'

interface PdfObject {
  id: number
  offset: number
  dict: string
  streamText: string | null
}

/** Pull the drawn strings out of a PDFKit file. Embedded fonts use ToUnicode; standard fonts use WinAnsi. */
export function extractPdfText(pdf: Buffer): string {
  const objects = readObjects(pdf)
  const cmaps = new Map<number, Map<number, string>>()
  for (const object of objects.values()) {
    if (object.streamText === null) continue
    if (!object.streamText.includes('beginbfrange') && !object.streamText.includes('beginbfchar'))
      continue
    cmaps.set(object.id, parseToUnicode(object.streamText))
  }

  const fontCmaps = new Map<string, Map<number, string>>()
  for (const object of objects.values()) {
    const fontAt = object.dict.indexOf('/Font')
    if (fontAt < 0) continue
    const dictStart = object.dict.indexOf('<<', fontAt)
    if (dictStart < 0) continue
    const dictEnd = object.dict.indexOf('>>', dictStart)
    if (dictEnd < 0) continue
    const body = object.dict.slice(dictStart, dictEnd)
    for (const ref of body.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
      const fontObject = objects.get(Number(ref[2] ?? '0'))
      const toUnicode = fontObject ? /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(fontObject.dict) : null
      const cmap = toUnicode ? cmaps.get(Number(toUnicode[1] ?? '0')) : undefined
      const name = ref[1]
      if (cmap !== undefined && name !== undefined) fontCmaps.set(name, cmap)
    }
  }

  const ordered = [...objects.values()].sort((left, right) => left.offset - right.offset)
  let text = ''
  for (const object of ordered) {
    const stream = object.streamText
    if (
      stream === null ||
      !stream.includes('Tf') ||
      (!stream.includes('TJ') && !stream.includes('Tj'))
    )
      continue
    let cmap: Map<number, string> | undefined
    const tokens = /\/(F\d+)\s+[-\d.]+\s+Tf|\[([^\]]*)\]\s*TJ|<([0-9A-Fa-f]+)>\s*Tj/g
    let token: RegExpExecArray | null
    while ((token = tokens.exec(stream)) !== null) {
      if (token[1] !== undefined) {
        cmap = fontCmaps.get(token[1])
        continue
      }
      if (token[2] !== undefined) {
        const hexes = token[2].matchAll(/<([0-9A-Fa-f]+)>/g)
        for (const hex of hexes) text += decodeShow(hex[1] ?? '', cmap)
        continue
      }
      text += decodeShow(token[3] ?? '', cmap)
    }
  }
  return text
}

export function pdfEmbeddedFontNames(pdf: Buffer): string[] {
  const names: string[] = []
  for (const match of pdf.toString('latin1').matchAll(/\/BaseFont\s*\/([^\s/[\]<>()]+)/g)) {
    const name = match[1]
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}

export function pdfHasEmbeddedFontFile(pdf: Buffer): boolean {
  const latin = pdf.toString('latin1')
  return latin.includes('/FontFile2') || latin.includes('/FontFile3')
}

export function pdfPageCount(pdf: Buffer): number {
  const latin = pdf.toString('latin1')
  const values = [
    ...latin.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,120}?\/Count\s+(\d+)/g),
    ...latin.matchAll(/\/Count\s+(\d+)[\s\S]{0,120}?\/Type\s*\/Pages\b/g)
  ].map((match) => Number(match[1]))
  return values.length === 0 ? 0 : Math.max(...values)
}

export function pdfMediaBox(pdf: Buffer): { width: number; height: number } {
  const match = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'))
  return { width: Number(match?.[1] ?? 0), height: Number(match?.[2] ?? 0) }
}

function readObjects(pdf: Buffer): Map<number, PdfObject> {
  const latin = pdf.toString('latin1')
  const objects = new Map<number, PdfObject>()
  for (const [id, offset] of xrefOffsets(latin)) {
    const object = readObject(pdf, latin, id, offset)
    if (object !== null) objects.set(id, object)
  }
  return objects
}

function xrefOffsets(latin: string): Map<number, number> {
  const offsets = new Map<number, number>()
  const marker = latin.lastIndexOf('\nxref\n')
  const at = marker >= 0 ? marker + 1 : latin.lastIndexOf('xref\n')
  if (at < 0) return offsets
  const lines = latin.slice(at + 'xref\n'.length).split('\n')
  let index = 0
  while (index < lines.length) {
    const header = /^(\d+) (\d+)\s*$/.exec(lines[index] ?? '')
    if (header === null) break
    const start = Number(header[1])
    const count = Number(header[2])
    index += 1
    for (let entry = 0; entry < count && index < lines.length; entry += 1, index += 1) {
      const parsed = /^(\d{10}) (\d{5}) ([nf])/.exec(lines[index] ?? '')
      if (parsed?.[3] === 'n') offsets.set(start + entry, Number(parsed[1]))
    }
  }
  return offsets
}

function readObject(pdf: Buffer, latin: string, id: number, offset: number): PdfObject | null {
  const marker = `${id} 0 obj`
  if (!latin.startsWith(marker, offset)) return null
  const dictStart = latin.indexOf('<<', offset + marker.length)
  if (dictStart < 0 || dictStart > offset + marker.length + 16) {
    return { id, offset, dict: '', streamText: null }
  }
  const dictEnd = findDictEnd(latin, dictStart)
  const dict = latin.slice(dictStart, dictEnd)
  let streamText: string | null = null
  if (dict.includes('/FlateDecode')) {
    const header = latin.slice(dictEnd, dictEnd + 32)
    const stream = /stream\r?\n/.exec(header)
    const length = Number(/\/Length\s+(\d+)/.exec(dict)?.[1] ?? '0')
    if (stream !== null && length > 0) {
      const start = dictEnd + stream.index + stream[0].length
      try {
        streamText = inflateSync(pdf.subarray(start, start + length)).toString('latin1')
      } catch {
        streamText = null
      }
    }
  }
  return { id, offset, dict, streamText }
}

function findDictEnd(latin: string, start: number): number {
  let depth = 0
  for (let index = start; index < latin.length - 1; index += 1) {
    const pair = latin.slice(index, index + 2)
    if (pair === '<<') {
      depth += 1
      index += 1
      continue
    }
    if (pair === '>>') {
      depth -= 1
      index += 1
      if (depth === 0) return index + 1
    }
  }
  return start
}

function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const block of cmap.matchAll(/beginbfrange\s*([\s\S]*?)\s*endbfrange/g)) {
    parseBfRange(block[1] ?? '', map)
  }
  for (const block of cmap.matchAll(/beginbfchar\s*([\s\S]*?)\s*endbfchar/g)) {
    parseBfChar(block[1] ?? '', map)
  }
  return map
}

function parseBfRange(body: string, map: Map<number, string>): void {
  const entries = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f\s]+)>|\[([\s\S]*?)\])/g
  let match: RegExpExecArray | null
  while ((match = entries.exec(body)) !== null) {
    const start = Number.parseInt(match[1] ?? '0', 16)
    const end = Number.parseInt(match[2] ?? '0', 16)
    const scalar = match[3]
    if (scalar !== undefined) {
      let dest = Number.parseInt(scalar.trim().split(/\s+/)[0] ?? '0', 16)
      for (let code = start; code <= end; code += 1) {
        map.set(code, String.fromCodePoint(dest).replaceAll('\u0000', ''))
        dest += 1
      }
      continue
    }
    const listed = [...(match[4] ?? '').matchAll(/<([0-9A-Fa-f\s]+)>/g)]
    for (let offset = 0; offset < listed.length && start + offset <= end; offset += 1) {
      map.set(start + offset, decodePdfHex(listed[offset]?.[1] ?? ''))
    }
  }
}

function parseBfChar(body: string, map: Map<number, string>): void {
  const entries = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f\s]+)>/g
  let match: RegExpExecArray | null
  while ((match = entries.exec(body)) !== null) {
    map.set(Number.parseInt(match[1] ?? '0', 16), decodePdfHex(match[2] ?? ''))
  }
}

function decodeShow(hex: string, cmap: Map<number, string> | undefined): string {
  if (cmap === undefined) return decodeWinAnsi(hex)
  let text = ''
  for (let index = 0; index + 3 < hex.length; index += 4) {
    const cid = Number.parseInt(hex.slice(index, index + 4), 16)
    text += cmap.get(cid) ?? ''
  }
  return text
}

function decodePdfHex(hex: string): string {
  const parts = hex
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
  const units: number[] = []
  for (const part of parts) {
    if (part.length <= 4) {
      units.push(Number.parseInt(part, 16))
      continue
    }
    for (let index = 0; index + 3 < part.length; index += 4) {
      units.push(Number.parseInt(part.slice(index, index + 4), 16))
    }
  }
  return String.fromCharCode(...units).replaceAll('\u0000', '')
}

function decodeWinAnsi(hex: string): string {
  const bytes = Buffer.from(hex, 'hex')
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return text
}
