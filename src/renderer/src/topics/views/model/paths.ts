/** The path of an own-site URL ("/blog/nagios-setup/"); anything unreadable comes back as is. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}
