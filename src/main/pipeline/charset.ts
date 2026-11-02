/**
 * Page bytes to text. The content fingerprint is computed on this text, so
 * the same page served as windows-1252 or UTF-8 hashes the same.
 *
 * Order (as browsers do, simplified): a byte-order mark, then the
 * Content-Type `charset`, then `<meta charset>` or `<meta http-equiv>` in
 * the first 4 KB, then UTF-8. An unknown label decodes as UTF-8.
 */
export function decodePageBytes(bytes: Uint8Array, contentType: string | null): string {
  const bom = bomEncoding(bytes)
  if (bom !== null) return decodeWith(bom.label, bytes.subarray(bom.length))
  const label = charsetFromContentType(contentType) ?? sniffMetaCharset(bytes) ?? 'utf-8'
  return decodeWith(label, bytes)
}

/**
 * Direct page reads accept HTML, XHTML, XML, and plain text. A missing
 * header is accepted and left to the extractor.
 */
export function isReadablePageContentType(contentType: string | null): boolean {
  if (contentType === null) return true
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (mime.length === 0) return true
  if (mime.startsWith('text/')) return true
  return mime === 'application/xhtml+xml' || mime === 'application/xml'
}

export function charsetFromContentType(contentType: string | null): string | null {
  if (contentType === null) return null
  const match = /;\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;]+))/i.exec(contentType)
  const label = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
  return label.length > 0 ? label : null
}

const META_PRESCAN_BYTES = 4096

function sniffMetaCharset(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.subarray(0, META_PRESCAN_BYTES)).toString('latin1')
  const direct = /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)/i.exec(head)
  if (direct?.[1] !== undefined) return direct[1]
  return null
}

function bomEncoding(bytes: Uint8Array): { label: string; length: number } | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { label: 'utf-8', length: 3 }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { label: 'utf-16be', length: 2 }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { label: 'utf-16le', length: 2 }
  return null
}

function decodeWith(label: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder(label, { fatal: false, ignoreBOM: true }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(bytes)
  }
}
