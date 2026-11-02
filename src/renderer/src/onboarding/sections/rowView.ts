import { cleanHost } from '@shared/competitor-hosts'
import type { SetupDraft, SetupItem, SetupRow } from '@shared/ipc'

export interface RowBadge {
  text: string
  tone: 'new' | 'tag' | 'yours' | 'ai'
}

/** The tag a row shows: "new" first, then its own tag, then "yours", then the AI mark. */
export function rowBadge(
  item: SetupItem,
  aiLabel: string | null | undefined,
  rowTag?: (item: SetupItem) => string | null
): RowBadge | null {
  if (item.fresh) return { text: 'new', tone: 'new' }
  const own = rowTag?.(item) ?? null
  if (own) return { text: own, tone: 'tag' }
  if (item.origin === 'user') return { text: 'yours', tone: 'yours' }
  return aiLabel ? { text: aiLabel, tone: 'ai' } : null
}

const letters = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * The brand's own name among the kept names: the one that spells the site's
 * domain ("Example Co" for example.com), else the first that is neither "new"
 * from Find more nor a bare host ("Example.com"), else the first kept.
 * Find more puts rows at the top, so "first kept" alone would rename the brand.
 */
export function primaryBrand(draft: SetupDraft): string | null {
  const kept = draft.lists.brands
    .filter((item) => item.kept)
    .map((item) => ({ name: item.name.trim(), fresh: item.fresh }))
    .filter((item) => item.name.length > 0)
  const plain = kept.filter((item) => !looksLikeHost(item.name))
  const label = letters(cleanHost(draft.site.domain).split('.')[0] ?? '')
  const spelled = label ? plain.find((item) => letters(item.name) === label) : undefined
  return (
    spelled?.name ??
    plain.find((item) => !item.fresh)?.name ??
    plain[0]?.name ??
    kept[0]?.name ??
    null
  )
}

/** The brand as the steps name it: the project name, the brand's own name, or the site. */
export function brandName(draft: SetupDraft): string {
  const project = draft.site.projectName.trim()
  if (project) return project
  return primaryBrand(draft) ?? (draft.site.domain.trim() || 'your brand')
}

const HOST = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#].*)?$/iu

/** True for text typed as a domain or an address (`notifyre.com`, `https://x.io/`). */
export function looksLikeHost(text: string): boolean {
  return HOST.test(text.trim()) && !/\s/u.test(text.trim())
}

const GENERIC_SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'])

/** `notifyre.com` → `Notifyre`; `textmagic.co.uk` → `Textmagic`. */
export function nameFromHost(host: string): string {
  const parts = cleanHost(host)
    .split('.')
    .filter((part) => part.length > 0)
  let label = parts[0] ?? ''
  if (parts.length >= 2) {
    const second = parts[parts.length - 2] ?? ''
    label =
      parts.length >= 3 && GENERIC_SECOND_LEVEL.has(second)
        ? (parts[parts.length - 3] ?? second)
        : second
  }
  return label.length > 0 ? label.charAt(0).toUpperCase() + label.slice(1) : host.trim()
}

/** + Add on the competitors card: a domain becomes a name and a host; other text is a name. */
export function competitorFromText(text: string): SetupRow | null {
  const value = text.trim()
  if (value.length === 0) return null
  if (looksLikeHost(value)) {
    const host = cleanHost(value)
    return { name: nameFromHost(host), detail: '', url: host, tag: null }
  }
  return { name: value, detail: '', url: null, tag: null }
}

/** + Add on the buyers card: "Clinic manager: reminders stopped" splits into who and situation. */
export function buyerFromText(text: string): SetupRow | null {
  const value = text.trim()
  if (value.length === 0) return null
  const match = /^(.+?)\s*(?::|\s[-–—]\s)\s*(.+)$/u.exec(value)
  return match
    ? { name: (match[1] ?? '').trim(), detail: (match[2] ?? '').trim(), url: null, tag: null }
    : { name: value, detail: '', url: null, tag: null }
}
