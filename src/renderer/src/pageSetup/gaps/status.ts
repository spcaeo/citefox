import type { GapStatus } from '@shared/ipc'
import type { ChipTone } from '../../ui'

export const GAP_STATUS_LABEL: Readonly<Record<GapStatus, string>> = {
  open: 'Open',
  published: 'Published',
  verified: 'Verified'
}

export const GAP_STATUS_TONE: Readonly<Record<GapStatus, ChipTone>> = {
  open: 'neutral',
  published: 'info',
  verified: 'ok'
}

/** One line on what a status means, for the drawer. */
export const GAP_STATUS_HINT: Readonly<Record<GapStatus, string>> = {
  open: 'The change is not on the page yet.',
  published: 'The change is live on the page. The next check shows if Google cites it.',
  verified: 'A check showed the page cited for this question.'
}

/** "Mark published" style menu verbs for moving a row to `status`. */
export function statusVerb(status: GapStatus): string {
  return status === 'open' ? 'Reopen' : `Mark ${GAP_STATUS_LABEL[status].toLowerCase()}`
}

/** A section URL as typed: null when empty, else an http(s) URL or an error. */
export function readSectionUrl(text: string): { url: string | null; error: string | null } {
  const trimmed = text.trim()
  if (!trimmed) return { url: null, error: null }
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { url: null, error: 'Use a web address that starts with https://' }
    }
    return { url: url.href, error: null }
  } catch {
    return { url: null, error: 'Use a full web address, such as https://example.com/pricing#faq' }
  }
}
