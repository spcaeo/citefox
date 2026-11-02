/**
 * A short opaque id for a drill built from a name, a path or a URL (a site, a
 * target page, a group key), so the drill URL (`drawer=drill&drill=<id>`)
 * never carries the text itself. Stable for the same text.
 */
export function opaqueId(text: string): string {
  let hash = 5381
  for (const char of text) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0
  return hash.toString(36)
}
