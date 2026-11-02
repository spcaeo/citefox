/** `https://www.example.com/blog/x?y` → `example.com/blog/x`. */
export function sourceLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/u, '')
    return `${parsed.hostname.replace(/^www\./u, '')}${path}`
  } catch {
    return url
  }
}
