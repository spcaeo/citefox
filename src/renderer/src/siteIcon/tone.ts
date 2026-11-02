/** How many letter-tile colours there are (siteIcon.css `.site-icon-tone-N`, tokens only). */
export const SITE_TONES = 6

/**
 * A stable colour for a domain's letter tile: the same site always gets the
 * same tile, on every screen and every run, so a list of rivals stays easy to scan.
 */
export function siteTone(key: string): number {
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % SITE_TONES
}
