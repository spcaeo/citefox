/**
 * Starting prices as written by the web search ("$29/mo", "$0.019/text",
 * "$24.50 / 500 texts", "$25/user/mo", "$650 one-time") and the cheapest one
 * in a group (owner feedback: the competitor's least price shows in green).
 *
 * Green goes to the cheapest price **per unit** when at least two competitors
 * use the same unit and currency (per message, per user a month, a month…),
 * one mark per unit. When no unit is shared, the cheapest plan price in the
 * same currency gets it instead. The tooltip says which comparison was made.
 */

export type PriceUnit = 'message' | 'user-month' | 'month' | 'year' | 'one-time' | 'other'

export interface ParsedPrice {
  /** Price for one unit, in the currency's main unit (dollars, euros). */
  perUnit: number
  /** The plan price as written (the number before any "/ 500 texts"). */
  plan: number
  currency: string
  unit: PriceUnit
  /** The unit word for `other` units ("contact"), else null. */
  word: string | null
}

export interface LowestMark {
  /** Short words under the price: "Lowest per text", "Lowest monthly". */
  label: string
  /** The tooltip: what was compared. */
  tooltip: string
}

const CURRENCIES: Readonly<Record<string, string>> = {
  $: 'USD',
  US$: 'USD',
  usd: 'USD',
  '€': 'EUR',
  eur: 'EUR',
  '£': 'GBP',
  gbp: 'GBP',
  A$: 'AUD',
  aud: 'AUD',
  C$: 'CAD',
  cad: 'CAD',
  '₹': 'INR',
  inr: 'INR'
}

const MESSAGE = /^(?:texts?|sms(?:es)?|messages?|msgs?|credits?|segments?|emails?|mms)$/u
const USER = /^(?:users?|seats?|agents?|members?)$/u
const MONTH = /^(?:mo|mos|month|months|monthly|mth)$/u
const YEAR = /^(?:yr|yrs|year|years|yearly|annually|annual)$/u

/** Null when the text carries no price we can compare ("Contact sales", "Not listed"). */
export function parsePrice(text: string | null | undefined): ParsedPrice | null {
  if (!text) return null
  const lower = text.toLowerCase().replace(/,(?=\d{3}\b)/gu, '')
  if (/\bfree\b/u.test(lower) && !/\btrial\b/u.test(lower) && !/\d/u.test(lower)) {
    return { perUnit: 0, plan: 0, currency: 'USD', unit: 'month', word: null }
  }
  const money =
    /(us\$|a\$|c\$|[$€£₹])\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(usd|eur|gbp|aud|cad|inr|€|£)/u.exec(
      lower
    )
  if (!money) return null
  const symbol = (money[1] ?? money[4] ?? '$')
    .replace('us$', 'US$')
    .replace('a$', 'A$')
    .replace('c$', 'C$')
  const currency = CURRENCIES[symbol] ?? CURRENCIES[symbol.toLowerCase()] ?? 'USD'
  const plan = Number(money[2] ?? money[3])
  if (!Number.isFinite(plan)) return null
  const rest = lower.slice((money.index ?? 0) + money[0].length)
  if (/one[-\s]?time|lifetime|once\b/u.test(rest)) {
    return { perUnit: plan, plan, currency, unit: 'one-time', word: null }
  }
  // "/ 500 texts", "per 1000 messages": a bundle price, divided down to one unit.
  const bundle = /(?:\/|per|for)\s*(\d+(?:\.\d+)?)\s*([a-z]+)/u.exec(rest)
  if (bundle) {
    const count = Number(bundle[1])
    const word = singular(bundle[2] ?? '')
    if (count > 0) {
      const unit = unitOf([word])
      return {
        perUnit: plan / count,
        plan,
        currency,
        unit: unit.unit,
        word: unit.unit === 'other' ? word : null
      }
    }
  }
  const words = [...rest.matchAll(/(?:\/|\bper\b|\ba\b|\ban\b|\beach\b)\s*([a-z]+)/gu)].map(
    (match) => singular(match[1] ?? '')
  )
  if (/\bmonthly\b/u.test(rest)) words.push('month')
  if (/\b(?:yearly|annually)\b/u.test(rest)) words.push('year')
  const unit = unitOf(words)
  const perUnit = unit.unit === 'year' ? plan / 12 : plan
  return {
    perUnit,
    plan,
    currency,
    unit: unit.unit === 'year' ? 'month' : unit.unit,
    word: unit.word
  }
}

function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}

function unitOf(words: readonly string[]): { unit: PriceUnit; word: string | null } {
  const user = words.some((word) => USER.test(word))
  const month = words.some((word) => MONTH.test(word))
  const year = words.some((word) => YEAR.test(word))
  if (words.some((word) => MESSAGE.test(word))) return { unit: 'message', word: null }
  if (user && (month || year || words.length === 1)) return { unit: 'user-month', word: null }
  if (month) return { unit: 'month', word: null }
  if (year) return { unit: 'year', word: null }
  const other = words.find((word) => word.length > 1)
  return other ? { unit: 'other', word: other } : { unit: 'month', word: null }
}

const UNIT_LABEL: Readonly<Record<Exclude<PriceUnit, 'year' | 'other'>, string>> = {
  message: 'per text',
  'user-month': 'per user/month',
  month: 'monthly',
  'one-time': 'one-time'
}

const UNIT_TOOLTIP: Readonly<Record<Exclude<PriceUnit, 'year' | 'other'>, string>> = {
  message: 'per message',
  'user-month': 'per user a month',
  month: 'a month',
  'one-time': 'as a one-time price'
}

/** What a mark says for `unit` ("Lowest per text"). */
function unitLabel(price: ParsedPrice): { label: string; tooltip: string } {
  if (price.unit === 'other' || price.unit === 'year') {
    const word = price.word ?? 'unit'
    return { label: `per ${word}`, tooltip: `per ${word}` }
  }
  return { label: UNIT_LABEL[price.unit], tooltip: UNIT_TOOLTIP[price.unit] }
}

export interface PricedItem {
  id: string
  startingPrice?: string | null
}

/**
 * The cheapest item(s) of one group, by id. `group` names the group in the
 * tooltip ("direct competitors").
 */
export function lowestPrices(
  items: readonly PricedItem[],
  group: string
): ReadonlyMap<string, LowestMark> {
  const parsed = items.flatMap((item) => {
    const price = parsePrice(item.startingPrice)
    return price ? [{ id: item.id, price }] : []
  })
  const marks = new Map<string, LowestMark>()
  const buckets = new Map<string, typeof parsed>()
  for (const entry of parsed) {
    const key = `${entry.price.currency}|${entry.price.unit}|${entry.price.word ?? ''}`
    buckets.set(key, [...(buckets.get(key) ?? []), entry])
  }
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue
    for (const best of cheapest(bucket, (entry) => entry.price.perUnit)) {
      const words = unitLabel(best.price)
      marks.set(best.id, {
        label: `Lowest ${words.label}`,
        tooltip: `Cheapest ${words.tooltip} among the ${bucket.length} ${group} that list a price ${words.tooltip}.`
      })
    }
  }
  if (marks.size > 0) return marks
  // No unit is shared: compare the plan prices themselves, in one currency.
  const byCurrency = new Map<string, typeof parsed>()
  for (const entry of parsed) {
    byCurrency.set(entry.price.currency, [...(byCurrency.get(entry.price.currency) ?? []), entry])
  }
  const [currency] = [...byCurrency.entries()].sort((a, b) => b[1].length - a[1].length)
  if (currency === undefined || currency[1].length < 2) return marks
  for (const best of cheapest(currency[1], (entry) => entry.price.plan)) {
    marks.set(best.id, {
      label: 'Lowest plan price',
      tooltip: `Cheapest plan price among the ${currency[1].length} ${group} with a price. Their units differ, so only the plan price is compared.`
    })
  }
  return marks
}

/** Every item at the lowest value (a tie marks each of them). */
function cheapest<T>(list: readonly T[], value: (item: T) => number): T[] {
  const low = Math.min(...list.map(value))
  return list.filter((item) => value(item) === low)
}
