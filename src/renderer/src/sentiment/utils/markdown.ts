import { safeExternalUrl } from '../../drill'

/**
 * Stored text (an overview sentence, a prompt, a title) as literal Markdown,
 * for a drawer row's `detail`. Markdown characters are escaped, so the text
 * never turns into a link, emphasis or a list.
 */
export function mdText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/([\\`*_[\]{}()#+!|<>~-])/g, '\\$1')
}

/** A Markdown link to an http(s) URL, or the escaped label when the URL is not http(s). */
export function mdLink(label: string, url: string | null | undefined): string {
  const href = safeExternalUrl(url)
  return href ? `[${mdText(label)}](<${href}>)` : mdText(label)
}

/** Short display for a URL: host and path, no scheme or `www.`. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '')
}

/** The host of a URL without `www.`, or the URL itself when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return shortUrl(url)
  }
}
