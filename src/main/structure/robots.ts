/** robots.txt is read up to this many characters. Real files are a few KB. */
const MAX_ROBOTS_CHARS = 512 * 1024

/**
 * FR-19.1. Sitemap URLs listed in robots.txt (`Sitemap:` lines, any case, in
 * any group). Relative values resolve against the robots.txt URL. Only http
 * and https URLs without credentials are kept, deduplicated, in file order.
 */
export function sitemapsFromRobots(text: string, robotsUrl: string, max = 50): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const body = text.length > MAX_ROBOTS_CHARS ? text.slice(0, MAX_ROBOTS_CHARS) : text
  for (const rawLine of body.split(/\r\n|\n|\r/)) {
    if (found.length >= max) break
    const hash = rawLine.indexOf('#')
    const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim()
    const colon = line.indexOf(':')
    if (colon === -1) continue
    if (line.slice(0, colon).trim().toLowerCase() !== 'sitemap') continue
    const value = line.slice(colon + 1).trim()
    if (value.length === 0 || value.length > 2000) continue
    const url = resolve(value, robotsUrl)
    if (url === null || seen.has(url)) continue
    seen.add(url)
    found.push(url)
  }
  return found
}

function resolve(value: string, base: string): string | null {
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  url.hash = ''
  return url.href
}
