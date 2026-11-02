import {
  competitorDomainOf,
  isLanguageTag,
  MAX_PRODUCT_COMPETITORS,
  MAX_PRODUCTS,
  serpApiGl
} from '@shared/domain'
import type { ImportRowCheck, ImportValues } from '@shared/ipc'
import { foldWord, type ImportEntity } from '@shared/import-fields'
import { bareDomain } from '@shared/own-site'
import type { ProjectFacts } from './context'
import { checkPageUrl, parseMarketCell } from './values'

/**
 * Per-row checks for the lists that are not questions: pages (on the own site, not
 * tracked yet), competitors (a website that is not the own one, not saved yet),
 * products and markets. Every row gets a result; repeats in the file are skipped.
 * Pure over the project facts.
 */

function row(
  result: ImportRowCheck['result'],
  reason: string | null,
  fix: ImportRowCheck['fix'] = null
): ImportRowCheck {
  return { result, reason, fix, match: null, kind: null }
}

/** The key a list row is compared by, and its check. */
type ListCheck = { key: string; check: ImportRowCheck } | ImportRowCheck

function isKeyed(value: ListCheck): value is { key: string; check: ImportRowCheck } {
  return 'key' in value
}

export function checkListRows(
  entity: Exclude<ImportEntity, 'questions' | 'keywords'>,
  rows: readonly ImportValues[],
  facts: ProjectFacts
): ImportRowCheck[] {
  const seen = new Map<string, number>()
  let room = entity === 'products' ? MAX_PRODUCTS - facts.products.length : Number.POSITIVE_INFINITY
  if (entity === 'competitors') {
    room = MAX_PRODUCT_COMPETITORS - facts.competitors.length
  }
  return rows.map((values, index) => {
    const outcome = checkOne(entity, values, facts)
    if (!isKeyed(outcome)) return outcome
    const earlier = seen.get(outcome.key)
    if (earlier !== undefined)
      return row('duplicate', `Same as row ${earlier + 1} in this list · skipped.`)
    seen.set(outcome.key, index)
    if (outcome.check.result !== 'new') return outcome.check
    if (room <= 0) {
      return row(
        'fix',
        `No room: a project keeps at most ${entity === 'products' ? MAX_PRODUCTS : MAX_PRODUCT_COMPETITORS} ${entity}.`,
        'limit'
      )
    }
    room -= 1
    return outcome.check
  })
}

function checkOne(
  entity: Exclude<ImportEntity, 'questions' | 'keywords'>,
  values: ImportValues,
  facts: ProjectFacts
): ListCheck {
  switch (entity) {
    case 'pages':
      return checkPage(values, facts)
    case 'competitors':
      return checkCompetitor(values, facts)
    case 'products':
      return checkProduct(values, facts)
    case 'markets':
      return checkMarket(values, facts)
  }
}

function checkPage(values: ImportValues, facts: ProjectFacts): ListCheck {
  const cell = (values.url ?? '').trim()
  if (cell.length === 0) return row('fix', 'No page URL in this row.', 'empty')
  const checked = checkPageUrl(cell, facts.domain, facts.includeSubdomains)
  if (!checked.ok) {
    return checked.reason === 'other'
      ? row(
          'fix',
          `Another site (${checked.host ?? ''}): only ${facts.domain} pages are imported.`,
          'page'
        )
      : row('fix', `“${cell.slice(0, 60)}” is not a web address.`, 'invalid')
  }
  const key = checked.url.toLowerCase()
  if (facts.trackedUrls.has(key))
    return { key, check: row('duplicate', 'Already tracked · skipped.') }
  return { key, check: row('new', null) }
}

function checkCompetitor(values: ImportValues, facts: ProjectFacts): ListCheck {
  const cell = (values.domain ?? '').trim()
  const name = (values.name ?? '').trim()
  const domain = competitorDomainOf(cell)
  if (cell.length === 0 && name.length === 0) return row('fix', 'No website in this row.', 'empty')
  if (domain === null) {
    return row(
      'fix',
      `“${(cell || name).slice(0, 60)}” is not a website. Add its address.`,
      'invalid'
    )
  }
  if (domain === bareDomain(facts.domain) || domain.endsWith(`.${bareDomain(facts.domain)}`)) {
    return row('fix', 'That is your own site.', 'invalid')
  }
  if (name.length > 80) return row('fix', 'The name is longer than 80 characters.', 'long')
  const saved = facts.competitors.some(
    (item) =>
      (item.domain !== null && item.domain.toLowerCase() === domain) ||
      (name.length > 0 && item.name.toLowerCase() === name.toLowerCase())
  )
  if (saved) return { key: domain, check: row('duplicate', 'Already saved · skipped.') }
  return { key: domain, check: row('new', null) }
}

function checkProduct(values: ImportValues, facts: ProjectFacts): ListCheck {
  const name = (values.name ?? '').trim()
  if (name.length === 0) return row('fix', 'No product name in this row.', 'empty')
  if (name.length > 80) return row('fix', 'The name is longer than 80 characters.', 'long')
  if ((values.job ?? '').length > 300 || (values.buyer ?? '').length > 300) {
    return row('fix', 'Keep "What it does" and "Who buys it" under 300 characters.', 'long')
  }
  const url = (values.url ?? '').trim()
  if (url.length > 0) {
    const checked = checkPageUrl(url, facts.domain, facts.includeSubdomains)
    if (!checked.ok) return row('fix', `The page must be on ${facts.domain}.`, 'page')
  }
  const key = foldWord(name)
  if (facts.products.some((item) => foldWord(item.name) === key)) {
    return { key, check: row('duplicate', 'Already saved · skipped.') }
  }
  return { key, check: row('new', null) }
}

/** A market row as country, language, location and device, or the reason it is not one. */
export function marketOf(
  values: ImportValues,
  defaultLanguage: string
):
  | {
      ok: true
      country: string
      language: string
      location: string | null
      device: 'desktop' | 'mobile'
    }
  | { ok: false; reason: string } {
  const cell = (values.country ?? '').trim()
  if (cell.length === 0) return { ok: false, reason: 'No country in this row.' }
  const parsed = parseMarketCell(cell)
  if (parsed === null) return { ok: false, reason: `“${cell.slice(0, 40)}” is not a country.` }
  const languageCell = (values.language ?? '').trim().toLowerCase()
  const language = languageCell || parsed.language || defaultLanguage
  if (!isLanguageTag(language))
    return { ok: false, reason: `“${languageCell}” is not a language code (en, fr…).` }
  const deviceCell = foldWord(values.device ?? '')
  if (deviceCell.length > 0 && deviceCell !== 'desktop' && deviceCell !== 'mobile') {
    return { ok: false, reason: 'Device is desktop or mobile.' }
  }
  const location = (values.location ?? '').trim()
  return {
    ok: true,
    country: parsed.country,
    language,
    location: location.length > 0 ? location.slice(0, 120) : null,
    device: deviceCell === 'mobile' ? 'mobile' : 'desktop'
  }
}

function checkMarket(values: ImportValues, facts: ProjectFacts): ListCheck {
  const language = facts.markets[0]?.language ?? 'en'
  const market = marketOf(values, language)
  if (!market.ok) return row('fix', market.reason, 'invalid')
  const key = [
    serpApiGl(market.country),
    market.language,
    foldWord(market.location ?? ''),
    market.device
  ].join('|')
  const exists = facts.markets.some(
    (item) =>
      [
        serpApiGl(item.country),
        item.language.toLowerCase(),
        foldWord(item.location ?? ''),
        item.device
      ].join('|') === key
  )
  if (exists) return { key, check: row('duplicate', 'Already set up · skipped.') }
  return { key, check: row('new', null) }
}
