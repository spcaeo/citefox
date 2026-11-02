import type { Market } from '@shared/domain'
import type { ImportDefaults, ImportMapping, ImportStageWords } from '@shared/ipc'
import { foldWord, translateStage, type ImportEntity } from '@shared/import-fields'
import { bareDomain, isOwnHost } from '@shared/own-site'

/**
 * Turns a table row into an import row's values: the matched columns by field id,
 * the stage translated (`stage` holds a stage id; an unknown word stays in
 * `stageRaw`), the market resolved to a project market (`market` holds its id; an
 * unknown code stays in `marketRaw`) and the defaults filled in. Pure.
 */

export function rowValues(input: {
  entity: ImportEntity
  cells: readonly string[]
  mapping: ImportMapping
  stageWords: ImportStageWords
  defaults: ImportDefaults
  markets: readonly Market[]
}): Record<string, string> {
  const raw: Record<string, string> = {}
  input.mapping.forEach((field, index) => {
    if (field === null) return
    const value = (input.cells[index] ?? '').trim()
    if (value.length > 0 && raw[field] === undefined) raw[field] = value
  })
  return resolveValues(input.entity, raw, input.stageWords, input.defaults, input.markets)
}

/** Resolves stage and market, applies defaults. Used for file rows and typed rows alike. */
export function resolveValues(
  entity: ImportEntity,
  raw: Readonly<Record<string, string>>,
  stageWords: ImportStageWords,
  defaults: ImportDefaults,
  markets: readonly Market[]
): Record<string, string> {
  const values: Record<string, string> = { ...raw }
  if (entity !== 'questions' && entity !== 'keywords') return values
  const stageCell = raw.stageRaw ?? raw.stage ?? ''
  if (stageCell.length > 0) {
    const stage = translateStage(stageCell, stageWords)
    values.stage = stage === 'unknown' ? '' : stage
    if (stage === 'unknown') values.stageRaw = stageCell
    else delete values.stageRaw
  } else if (defaults.stage !== null) values.stage = defaults.stage
  else values.stage = ''
  if ((values.page ?? '').length === 0 && defaults.page !== null) values.page = defaults.page
  const marketCell = raw.marketRaw ?? raw.market ?? ''
  if (marketCell.length > 0) {
    const found =
      markets.find((market) => market.id === marketCell) ?? resolveMarket(marketCell, markets)
    if (found === null) {
      values.market = ''
      values.marketRaw = marketCell
    } else {
      values.market = found.id
      delete values.marketRaw
    }
  } else values.market = defaults.market ?? ''
  return values
}

const COUNTRY_ALIASES: Readonly<Record<string, string>> = { UK: 'GB', EN: 'GB' }

let countryNames: Map<string, string> | null = null

/** "united states" → "US", built once from the runtime's region names. */
function countryByName(name: string): string | null {
  if (countryNames === null) {
    countryNames = new Map()
    try {
      const display = new Intl.DisplayNames(['en'], { type: 'region' })
      for (let a = 65; a <= 90; a += 1) {
        for (let b = 65; b <= 90; b += 1) {
          const code = String.fromCharCode(a, b)
          const label = display.of(code)
          // The first code keeps a shared name ("France" is FR, not the old FX).
          const key = label === undefined || label === code ? '' : foldWord(label)
          if (key.length > 0 && !countryNames.has(key)) countryNames.set(key, code)
        }
      }
    } catch {
      // No region names in this runtime: codes still work.
    }
    countryNames.set('usa', 'US')
    countryNames.set('america', 'US')
    countryNames.set('uk', 'GB')
    countryNames.set('england', 'GB')
    countryNames.set('britain', 'GB')
  }
  return countryNames.get(foldWord(name)) ?? null
}

/** A market cell as country code and language: "US", "US · EN", "en-US", "us_en", "United States". */
export function parseMarketCell(cell: string): { country: string; language: string | null } | null {
  const text = cell.trim()
  if (text.length === 0) return null
  const parts = text
    .split(/[\s·,/_|-]+/u)
    .map((part) => part.trim())
    .filter(Boolean)
  const codes = parts.filter((part) => /^[a-z]{2}$/iu.test(part))
  if (codes.length >= 1 && codes.length === parts.length) {
    // "en-US" is language-country; "US-en", "US · EN" are country-language.
    const [first, second] = codes as [string, string | undefined]
    if (second !== undefined) {
      const firstIsLanguage = first === first.toLowerCase() && second === second.toUpperCase()
      const country = (firstIsLanguage ? second : first).toUpperCase()
      const language = (firstIsLanguage ? first : second).toLowerCase()
      return { country: COUNTRY_ALIASES[country] ?? country, language }
    }
    const country = first.toUpperCase()
    return { country: COUNTRY_ALIASES[country] ?? country, language: null }
  }
  const byName = countryByName(text.split('·')[0] ?? text)
  return byName === null ? null : { country: byName, language: null }
}

function sameCountry(left: string, right: string): boolean {
  const norm = (value: string): string => {
    const upper = value.toUpperCase()
    return COUNTRY_ALIASES[upper] ?? upper
  }
  return norm(left) === norm(right)
}

/** The project market a cell names, or null. A language in the cell must match too. */
export function resolveMarket(cell: string, markets: readonly Market[]): Market | null {
  const parsed = parseMarketCell(cell)
  if (parsed === null) return null
  const candidates = markets.filter((market) => sameCountry(market.country, parsed.country))
  if (parsed.language === null) return candidates[0] ?? null
  return (
    candidates.find((market) => market.language.toLowerCase().startsWith(parsed.language ?? '')) ??
    null
  )
}

/** The code a market cell shows when it is not set up ("CA"), for "Markets CA and GB…". */
export function marketCode(cell: string): string {
  const parsed = parseMarketCell(cell)
  return parsed === null ? cell.trim().slice(0, 40) : parsed.country
}

export type PageCheck =
  | { ok: true; url: string; own: true }
  | { ok: false; reason: 'invalid' | 'other'; host: string | null }

/**
 * A page cell as a full URL on the project's site: a path ("/pricing/") is put on
 * the domain, a bare host gets https://. Another site's URL is refused.
 */
export function checkPageUrl(cell: string, domain: string, includeSubdomains: boolean): PageCheck {
  const text = cell.trim()
  if (text.length === 0) return { ok: false, reason: 'invalid', host: null }
  const own = bareDomain(domain)
  let candidate = text
  if (candidate.startsWith('/')) candidate = `https://${own}${candidate}`
  else if (!/^https?:\/\//iu.test(candidate)) candidate = `https://${candidate}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, reason: 'invalid', host: null }
  }
  if (!/^https?:$/u.test(parsed.protocol) || !parsed.hostname.includes('.')) {
    return { ok: false, reason: 'invalid', host: null }
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./u, '')
  if (!isOwnHost(host, own, includeSubdomains)) return { ok: false, reason: 'other', host }
  parsed.hash = ''
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_')) parsed.searchParams.delete(key)
  }
  return { ok: true, url: parsed.toString(), own: true }
}

/** "/email-to-sms/" for a full URL on the site: how pages are shown in rows. */
export function pagePath(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}
