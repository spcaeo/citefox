import { DEFAULT_INCLUDE_SUBDOMAINS, DEFAULT_MARKET_DEVICE } from '@shared/domain'
import type {
  CompanySuggestion,
  FillFromWebsiteResult,
  FinishSetupRequest,
  HelpFillResult,
  HelpFillRow,
  ProductSuggestion,
  SaveProfileRequest,
  SetupDraft,
  SetupItem,
  SetupListId,
  SetupRow
} from '@shared/ipc'
import { PROJECT_RULE_MAX, PROJECT_RULES_MAX } from '@shared/ipc'
import { primaryBrand } from './sections/rowView'
import { keptRows } from './setupDraft'
import { normalizeCountry, normalizeDomain, normalizeLanguageTag } from './validate'

/**
 * Onboarding v2: putting AI answers into the draft's sections (step 3's read, a
 * chatbot's answer) and turning the draft into the requests Continue sends
 * (`onboarding:saveProfile` after step 6, `onboarding:finishSetup` on step 8). Pure.
 */

let counter = 0
const RUN = Math.random().toString(36).slice(2, 8)

/** An opaque id, unique within the draft. */
export function newItemId(): string {
  counter += 1
  return `i-${RUN}-${counter.toString(36)}`
}

export function itemOf(row: SetupRow, origin: SetupItem['origin']): SetupItem {
  return {
    id: newItemId(),
    name: row.name.trim(),
    detail: row.detail.trim(),
    url: row.url && row.url.trim().length > 0 ? row.url.trim() : null,
    tag: row.tag && row.tag.trim().length > 0 ? row.tag.trim() : null,
    ...(row.tier !== undefined ? { tier: row.tier } : {}),
    origin,
    kept: true,
    edited: false,
    fresh: false
  }
}

/** A name folded for comparing: "Text-Em-All" and "textemall" are the same. */
export function fold(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * A read's rows for one list: the user's rows (typed or edited) stay first and as
 * they are; untouched AI rows are replaced by the new ones, ticked. A new row with
 * the same name as a user row is left out.
 */
export function replaceAiRows(
  current: readonly SetupItem[],
  rows: readonly SetupRow[]
): SetupItem[] {
  const mine = current.filter((item) => item.origin === 'user' || item.edited)
  const seen = new Set(mine.map((item) => fold(item.name)))
  const fresh: SetupItem[] = []
  for (const row of rows) {
    const key = fold(row.name)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    fresh.push(itemOf(row, 'ai'))
  }
  return [...mine, ...fresh]
}

/** The draft with `rows` applied into `list` (see {@link replaceAiRows}). */
export function applyRows(
  draft: SetupDraft,
  list: SetupListId,
  rows: readonly SetupRow[]
): SetupDraft {
  return { ...draft, lists: { ...draft.lists, [list]: replaceAiRows(draft.lists[list], rows) } }
}

const nameRow = (name: string, url: string | null = null): SetupRow => ({
  name,
  detail: '',
  url,
  tag: null
})

/** Step 3's website read (`projects:fillFromWebsite`) applied into the draft as AI rows. */
/** Step 4's part of a site read: the summary, the brand names and what it sells. */
export function applyBrandFill(draft: SetupDraft, fill: FillFromWebsiteResult): SetupDraft {
  const products = fill.products ?? []
  let next = draft
  const summary = (fill.summary ?? '').trim()
  if (summary.length > 0 && (draft.summaryOrigin === 'ai' || draft.summary.trim() === '')) {
    next = { ...next, summary, summaryOrigin: 'ai' }
  }
  next = applyRows(
    next,
    'brands',
    fill.brands.map((brand) => nameRow(brand.name))
  )
  next = applyRows(
    next,
    'products',
    products.map((product) => ({
      name: product.name,
      detail: product.job,
      url: product.evidence?.path ?? null,
      tag: null
    }))
  )
  return next
}

/** Competitor rows, each tagged with the product it was found for. */
export function competitorRows(
  products: readonly ProductSuggestion[],
  competitors: readonly CompanySuggestion[]
): SetupRow[] {
  const productName = (id: string | null | undefined): string | null =>
    products.find((product) => product.id === id)?.name ?? null
  return competitors.map((company) => ({
    name: company.name,
    detail: company.reason,
    url: company.domain,
    tag: productName(company.product),
    tier: company.tier ?? null
  }))
}

/**
 * `rows` added to the end of `list` as ticked AI rows, leaving every row already there as
 * it is (a competitor search that finishes late, or a product's Try again). A row whose
 * name is already listed, ticked or not, is left out.
 */
export function appendRows(
  draft: SetupDraft,
  list: SetupListId,
  rows: readonly SetupRow[]
): SetupDraft {
  const current = draft.lists[list]
  const seen = new Set(current.map((item) => fold(item.name)))
  const fresh: SetupItem[] = []
  for (const row of rows) {
    const key = fold(row.name)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    fresh.push(itemOf(row, 'ai'))
  }
  if (fresh.length === 0) return draft
  return { ...draft, lists: { ...draft.lists, [list]: [...current, ...fresh] } }
}

export function applyFill(draft: SetupDraft, fill: FillFromWebsiteResult): SetupDraft {
  let next = applyBrandFill(draft, fill)
  next = applyRows(next, 'competitors', competitorRows(fill.products ?? [], fill.competitors))
  next = applyRows(
    next,
    'switchingFrom',
    fill.switchingFrom.map((company) => nameRow(company.name, company.domain))
  )
  next = applyRows(
    next,
    'integrations',
    fill.integrations.map((company) => nameRow(company.name, company.domain))
  )
  return next
}

/** A chatbot's five-section answer (`helpfill:setupRead`, kind `project`) applied as AI rows. */
export function applyChatbotAnswer(draft: SetupDraft, result: HelpFillResult): SetupDraft {
  const rows = (section: string): HelpFillRow[] =>
    result.rows.filter((row) => row.section === section)
  const cell = (row: HelpFillRow, id: string): string => (row.values[id] ?? '').trim()
  const products = rows('products').map((row) => ({
    name: cell(row, 'name'),
    detail: cell(row, 'job'),
    url: cell(row, 'url').startsWith('/') ? cell(row, 'url') : null,
    tag: null
  }))
  const buyers = rows('buyers')
  const triggers = buyers.map((row) => cell(row, 'trigger')).filter((text) => text.length > 0)
  let next = applyRows(draft, 'products', products)
  next = applyRows(
    next,
    'buyers',
    buyers.map((row) => ({
      name: cell(row, 'who'),
      detail: cell(row, 'problem'),
      url: null,
      tag: cell(row, 'product') || null
    }))
  )
  next = applyRows(
    next,
    'triggers',
    triggers.map((text) => nameRow(text))
  )
  next = applyRows(
    next,
    'competitors',
    rows('competitors').map((row) => ({
      name: cell(row, 'name') || cell(row, 'domain'),
      detail: '',
      url: cell(row, 'domain') || null,
      tag: cell(row, 'competes_with') || null,
      tier: 'direct' as const
    }))
  )
  next = applyRows(
    next,
    'questions',
    rows('questions').map((row) => ({
      name: cell(row, 'question'),
      detail: '',
      url: null,
      tag: cell(row, 'stage') || null
    }))
  )
  return next
}

/** "Example Co" from `example.com`, for a project with no brand kept yet. */
export function brandFromDomain(domain: string): string {
  const host = normalizeDomain(domain)
  const label = host.split('.')[0] ?? ''
  return label.length > 0 ? label.charAt(0).toUpperCase() + label.slice(1) : host
}

/** A bare host, or null when the text is not one. */
function hostOf(value: string | null): string | null {
  if (value === null) return null
  const host = normalizeDomain(value)
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null
}

function names(draft: SetupDraft, list: SetupListId): string[] {
  return keptRows(draft, list)
    .map((row) => row.name.trim())
    .filter((name) => name.length > 0)
}

/** `onboarding:saveProfile` from the draft: the site and the kept rows of steps 4 and 6. */
export function profileRequest(draft: SetupDraft): SaveProfileRequest {
  const { site } = draft
  const primary = primaryBrand(draft)
  // The brand's own name first: the app shows the first brand name as the brand.
  const brands = names(draft, 'brands').sort(
    (a, b) => Number(b === primary) - Number(a === primary)
  )
  const competitors = [
    ...new Set(
      keptRows(draft, 'competitors').flatMap((row) => {
        const host = hostOf(row.url)
        return host === null ? [] : [host]
      })
    )
  ]
  const location = site.location.trim()
  const domain = normalizeDomain(site.domain)
  return {
    userName: site.userName.trim(),
    projectName: site.projectName.trim() || primary || brandFromDomain(domain),
    domain,
    includeSubdomains: DEFAULT_INCLUDE_SUBDOMAINS,
    brandNames: brands.length > 0 ? brands : [brandFromDomain(domain)],
    competitors,
    country: normalizeCountry(site.country === 'other' ? site.countryCode : site.country),
    language: normalizeLanguageTag(site.language === 'other' ? site.languageCode : site.language),
    location: location.length > 0 ? location : null,
    device: DEFAULT_MARKET_DEVICE,
    switchingFrom: names(draft, 'switchingFrom'),
    integrations: names(draft, 'integrations')
  }
}

/** Step 8's "Finish and run the first check": the kept rows the profile does not hold. */
export function finishRequest(draft: SetupDraft, runFirstCheck: boolean): FinishSetupRequest {
  return {
    summary: draft.summary.trim(),
    products: keptRows(draft, 'products'),
    competitors: keptRows(draft, 'competitors'),
    buyers: keptRows(draft, 'buyers'),
    triggers: names(draft, 'triggers'),
    topic: draft.topic.trim(),
    questions: keptRows(draft, 'questions'),
    runFirstCheck,
    ...(draft.rules && draft.rules.length > 0 ? { rules: draft.rules } : {})
  }
}

/**
 * The draft with a Redo box's words kept as a project rule ("Save as a project
 * rule"), once, whatever their case. Blank words change nothing.
 */
export function withRule(draft: SetupDraft, words: string): SetupDraft {
  const rule = words.replace(/\s+/gu, ' ').trim().slice(0, PROJECT_RULE_MAX)
  if (rule.length === 0) return draft
  const rules = draft.rules ?? []
  if (rules.some((item) => item.toLowerCase() === rule.toLowerCase())) return draft
  return { ...draft, rules: [...rules, rule].slice(-PROJECT_RULES_MAX) }
}
