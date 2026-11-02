import { cleanHost } from '@shared/competitor-hosts'
import type { SetupContext, SetupRow } from '@shared/ipc'
import { bareDomain } from '../../engine/competitor-domains'
import { nameKey } from '../../engine/competitor-guard'
import { marketWords } from '../../engine/product-competitors'
import { pathOf } from '../../helpfill/context'
import type { SectionContextLine, SectionValues } from './types'

/** Small pure helpers the section definitions share. */

/** One reply cell, trimmed, with runs of spaces folded. */
export function cell(values: SectionValues, id: string): string {
  return (values[id] ?? '').replace(/\s+/gu, ' ').trim()
}

/** At most `max` characters, cut with an ellipsis. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u

/** A bare host (`example.com`) from a cell, or null when it is not one. */
export function hostOf(value: string): string | null {
  const host = bareDomain(cleanHost(value.trim()))
  return HOST.test(host) ? host : null
}

/** True when the host is the business's own site (or a subdomain of it). */
export function isOwnHost(host: string | null, domain: string): boolean {
  const own = bareDomain(cleanHost(domain))
  return host !== null && own.length > 0 && (host === own || host.endsWith(`.${own}`))
}

/** True when the name is one of the brand's own names, or the domain's first label. */
export function isOwnName(name: string, context: SetupContext): boolean {
  const key = nameKey(name)
  if (key.length === 0) return false
  const own = bareDomain(cleanHost(context.domain))
  const keys = [...context.brands, own, own.split('.')[0] ?? ''].map(nameKey).filter(Boolean)
  return keys.includes(key)
}

/** True when two names are the same company (one starts with the other when both are long). */
export function sameName(left: string, right: string): boolean {
  const a = nameKey(left)
  const b = nameKey(right)
  if (a.length === 0 || b.length === 0) return false
  return a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)))
}

/** A site path (`/pricing/`) from a cell (a URL or a path), or null. */
export function pathOrNull(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const path = pathOf(
    trimmed.startsWith('/') || /^https?:/iu.test(trimmed) ? trimmed : `/${trimmed}`
  )
  return path.length > 0 && path.length <= 300 && !/\s/u.test(path) ? path : null
}

/** The product name as the context spells it, or null when the cell names none. */
export function productNamed(value: string, context: SetupContext): string | null {
  const key = nameKey(value)
  if (key.length === 0) return null
  const found = context.products.find((product) => nameKey(product.name) === key)
  return found?.name ?? null
}

/** "Name (detail)", "Name (host)" or the name alone, for the prompt's lists. */
export function withDetail(name: string, detail: string | null): string {
  const extra = (detail ?? '').trim()
  return extra.length === 0 ? name : `${name} (${extra})`
}

/** Brand names joined for a "Never name …" rule. */
export function brandWords(context: SetupContext): string {
  return context.brands.length > 0 ? context.brands.join(' or ') : 'the company'
}

/** "United States (English)", or null when the market is not set. */
export function marketOf(context: SetupContext): string | null {
  const country = context.country.trim()
  const language = context.language.trim()
  if (!/^[A-Za-z]{2}$/u.test(country) || language.length === 0) return null
  return marketWords({ country, language })
}

/** The context lines one section asks for; a line with no value is left out. */
export function contextLines(
  context: SetupContext,
  wanted: readonly SectionContextLine[]
): string[] {
  const join = (items: readonly string[]): string =>
    items
      .map((item) => item.trim())
      .filter(Boolean)
      .join('; ')
  const rows = (items: readonly SetupRow[], detail: (row: SetupRow) => string | null): string =>
    join(items.map((row) => withDetail(row.name, detail(row))))
  const lines: string[] = []
  for (const key of wanted) {
    let value = ''
    let label = ''
    switch (key) {
      case 'website':
        label = 'Website'
        value = context.domain.trim()
        break
      case 'market':
        label = 'Market tracked (where AI answers are checked, not always where it sells)'
        value = marketOf(context) ?? ''
        break
      case 'summary':
        label = 'What it does'
        value = context.summary.replace(/\s+/gu, ' ').trim()
        break
      case 'brands':
        label = 'Brand names'
        value = join(context.brands)
        break
      case 'products':
        label = 'Products'
        value = rows(context.products, (row) => row.detail)
        break
      case 'buyers':
        label = 'Buyers'
        value = rows(context.buyers, (row) => row.detail)
        break
      case 'triggers':
        label = 'What sends them looking'
        value = join(context.triggers)
        break
      case 'competitors':
        label = 'Competitors'
        value = rows(context.competitors, (row) => row.url)
        break
      case 'switchingFrom':
        label = 'Buyers switch from'
        value = join(context.switchingFrom)
        break
      case 'integrations':
        label = 'Used with'
        value = join(context.integrations)
        break
      case 'topic':
        label = 'Topic'
        value = context.topic.replace(/\s+/gu, ' ').trim()
        break
    }
    if (value.length > 0) lines.push(`${label}: ${clip(value, 1200)}`)
  }
  return lines
}
