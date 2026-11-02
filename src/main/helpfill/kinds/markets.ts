import type { Market } from '@shared/domain'
import { foldWord } from '@shared/import-fields'
import { ensureShippedAssists } from '../../assist/definitions'
import { runAssist } from '../../assist/run'
import { parseMarketCell } from '../../import/values'
import { listPageMarkets } from '../../storage/pages'
import { listMarkets } from '../../storage/project-profile'
import type { HelpFillKindDef, HelpFillValues } from '../types'

/**
 * Add market (page Markets tab and the project's Add market drawer) → ✦ Help me
 * fill this: the countries, languages and cities where the business's buyers
 * search Google. The reply columns are `country,language,city`; `city` reads the
 * importer's `location` words too ("location", "City or area"). Rows are merged
 * into the markets the page (or, with no page, the project) already tracks.
 * Describe runs the existing `markets.suggest` assist with the user's sentence as
 * its instruction (its prompt is not copied here).
 */

/** `context.extra` key: the tracked markets as labels and as merge keys. */
const LABELS = 'marketLabels'
const KEYS = 'marketKeys'

export const MARKETS_KIND: HelpFillKindDef = {
  kind: 'markets',
  noun: ['market', 'markets'],
  scope: 'project',
  sections: [
    {
      id: 'main',
      title: null,
      columns: ['country', 'language', 'city'],
      entity: 'markets',
      fields: { city: 'location' }
    }
  ],
  neutral: false,
  defaultCount: 3,
  // The most `markets.suggest` writes in one call.
  maxCount: 5,
  chatbotCount: 8,
  describeCost: { calls: 1, usd: 0.01 },
  role: () =>
    'You help a company choose the countries, languages and cities where its buyers search Google.',
  task: (_context, count) => [
    `Suggest ${count} new markets where buyers of this business search Google and could find it.`,
    'Add a city only when buyers search locally; leave it blank for the whole country.',
    "Don't repeat a market that is already tracked.",
    'country = a two-letter country code (US, GB, CA, IN…)',
    'language = a two-letter language code (en, es, fr, de…)',
    'city = a city or region name, or blank'
  ],
  extra(db, _project, pageId) {
    const all = listMarkets(db)
    const markets =
      pageId === null
        ? all
        : listPageMarkets(db, pageId)
            .map((link) => all.find((market) => market.id === link.marketId))
            .filter((market): market is Market => market !== undefined)
    return {
      [LABELS]: markets.map(marketText),
      [KEYS]: markets.map((market) =>
        marketKey({
          country: market.country,
          language: market.language,
          city: market.location ?? ''
        })
      )
    }
  },
  tracked: (context) => ({
    listed: context.extra?.[LABELS] ?? [],
    merge: { main: context.extra?.[KEYS] ?? [] }
  }),
  key: (values) => marketKey(values),
  clean: cleanMarket,
  async describe(host, context, input) {
    ensureShippedAssists()
    const result = await runAssist(host, {
      assistId: 'markets.suggest',
      projectId: context.projectId,
      pageId: context.target?.id ?? null,
      marketId: null,
      promptId: null,
      inputs: {},
      instruction: input.sentence.trim() || null
    })
    return result.items.slice(0, input.count).map((item) => {
      const tag = (item.tag ?? '').trim()
      // `text` is the whole market ("Canada · English · Toronto"); `tag` its country code.
      const parts = splitMarket(item.text)
      return {
        section: null,
        values: {
          country: /^[A-Za-z]{2}$/u.test(tag) ? tag : (parts[0] ?? item.text),
          language: parts[1] ?? '',
          city: parts[2] ?? ''
        }
      }
    })
  }
}

/** "US · en", "CA · en · Toronto": how a tracked market is listed in the prompt. */
function marketText(market: Market): string {
  return [market.country, market.language, market.location ?? ''].filter(Boolean).join(' · ')
}

/** What two markets are compared by: country, language and city (device is left out). */
export function marketKey(values: HelpFillValues): string {
  // A stored "UK" and a pasted "GB" are the same country.
  const cell = (values.country ?? '').trim()
  const country = parseMarketCell(cell)?.country ?? cell.toUpperCase()
  const language = (values.language ?? '').trim().toLowerCase().split(/[-_]/u)[0] ?? ''
  const city = foldWord(values.city ?? '')
  return `market ${country} ${language} ${city}`.trim()
}

/** "Canada · English · Toronto", "Canada | en", "Canada - English": the parts of one market. */
function splitMarket(text: string): string[] {
  return text
    .split(/\s*(?:·|\||;|,|\s[-–—]\s)\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Words a reply writes for "no city". */
const NO_CITY = new Set(['', 'none', 'n a', 'na', 'all', 'whole country', 'nationwide', 'national'])

/**
 * The country as a code (rows naming no country are dropped), the language as a
 * code ('' when blank or unknown) and the city as written ('' for "none", "all").
 * A plain list line holds the whole market in its first cell; it is split here.
 */
export function cleanMarket(values: HelpFillValues): HelpFillValues | null {
  let country = (values.country ?? '').trim()
  let language = (values.language ?? '').trim()
  let city = (values.city ?? '').trim()
  if (language.length === 0 && city.length === 0) {
    const parts = splitMarket(country)
    if (parts.length > 1) {
      country = parts[0] ?? ''
      language = parts[1] ?? ''
      city = parts[2] ?? ''
    }
  }
  const parsed = parseMarketCell(country)
  if (parsed === null) return null
  const code = languageCode(language) ?? parsed.language ?? ''
  const place = city.replace(/^\((.*)\)$/u, '$1').trim()
  return {
    country: parsed.country,
    language: code,
    city: NO_CITY.has(foldWord(place)) ? '' : place
  }
}

let languageNames: Map<string, string> | null = null

/** "en", "EN", "en-US", "English", "English (US)" → "en"; null when unknown. */
export function languageCode(cell: string): string | null {
  const text = cell.trim()
  if (text.length === 0) return null
  const tag = /^([A-Za-z]{2})(?:[-_][A-Za-z]{2,4})?$/u.exec(text)
  if (tag?.[1] !== undefined) return tag[1].toLowerCase()
  if (languageNames === null) {
    languageNames = new Map()
    try {
      const display = new Intl.DisplayNames(['en'], { type: 'language' })
      for (let a = 97; a <= 122; a += 1) {
        for (let b = 97; b <= 122; b += 1) {
          const code = String.fromCharCode(a, b)
          const label = display.of(code)
          if (label !== undefined && label !== code) languageNames.set(foldWord(label), code)
        }
      }
    } catch {
      // No language names in this runtime: codes still work.
    }
  }
  const name = foldWord(text.replace(/\(.*\)/u, ''))
  return languageNames.get(name) ?? null
}
