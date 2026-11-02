import { SEARCHES_PER_PROMPT_MAX, SEARCHES_PER_PROMPT_MIN } from '@shared/domain'

/** One market row of the Add page form. */
export interface MarketRow {
  key: string
  country: string
  language: string
  location: string
  localWording: boolean
}

let rowKey = 0

/** A new row key, unique for this window. */
export function nextMarketKey(): string {
  rowKey += 1
  return `market-${rowKey}`
}

/**
 * The address to save: a typed path (`/pricing`) or a bare host path
 * (`example.com/pricing`) becomes a full `https://` address on the project's
 * domain; anything else is returned trimmed.
 */
export function addressOf(typed: string, domain: string): string {
  const text = typed.trim()
  const host = domain
    .trim()
    .replace(/^https?:\/\//iu, '')
    .replace(/\/.*$/u, '')
  if (text.startsWith('/')) return `https://${host}${text}`
  const bare = text.toLowerCase()
  if (bare === host.toLowerCase() || bare.startsWith(`${host.toLowerCase()}/`)) {
    return `https://${text}`
  }
  return text
}

/** "10–20": searches for one check of every prompt, market and sample. */
export function searchRange(prompts: number, markets: number, samples: number): string {
  const units = Math.max(0, prompts) * Math.max(0, markets) * Math.max(0, samples)
  const min = units * SEARCHES_PER_PROMPT_MIN
  const max = units * SEARCHES_PER_PROMPT_MAX
  return `${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')}`
}
