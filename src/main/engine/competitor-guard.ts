import { bareDomain } from './competitor-domains'
import { notCompetitorReason } from './project-settings/competitors'

/**
 * The code side of the competitor rules (`competitor-rules.ts`, Docs/FEEDBACK.md
 * row 3). Claude sorts what it finds on the site into competitors, options buyers
 * switch from, and integrations; this guard re-checks that against the pages read:
 *
 * - every item must be named on a page read (or be a domain Google already cites);
 * - a "competitor" whose evidence is an alternative / migration / shutdown page about
 *   a discontinued service moves to `switchingFrom`;
 * - a "competitor" whose evidence is an integration page about it moves to `integrations`;
 * - a competitor with the same name as a switching-from item or an integration, the
 *   business's own brand, or a review site, marketplace, publisher or carrier is left out;
 * - a domain the pages do not link to or name is cleared (the name stays, `checkDomain`).
 */

export interface EvidenceRef {
  /** Page path such as `/compare`. */
  path: string
  quote: string
}

export interface SuggestedCompany {
  name: string
  domain: string | null
  reason: string
  evidence: EvidenceRef | null
  /**
   * Fill from my website only: the company's official domain from Claude's own
   * knowledge, for a domain the pages do not show. Unverified: a lookup candidate.
   */
  officialDomain?: string | null
}

export interface GuardedCompany extends Omit<SuggestedCompany, 'officialDomain'> {
  /** True when Claude gave a domain the pages do not show; it was cleared. */
  checkDomain: boolean
  /**
   * When `domain` is null: domains to look up (the cleared one, Claude's official
   * domain). Never shown until `company-domain-lookup.ts` verifies one.
   */
  candidates: string[]
}

export interface CompanyIdeas {
  competitors: readonly SuggestedCompany[]
  switchingFrom: readonly SuggestedCompany[]
  integrations: readonly SuggestedCompany[]
}

export interface GuardedIdeas {
  competitors: GuardedCompany[]
  switchingFrom: GuardedCompany[]
  integrations: GuardedCompany[]
  /** Items left out, with a short reason (logged, never shown as a suggestion). */
  dropped: { name: string; why: string }[]
}

/** A page Claude was given: its path, the text it saw, and the links on it when known. */
export interface ReadPage {
  path: string
  text: string
  links?: readonly string[]
}

export interface GuardOptions {
  /** The business's own domain. */
  ownDomain: string
  brandNames: readonly string[]
  /** Domains Google's AI Overviews already cite for the project (real, not guessed). */
  seenDomains?: readonly string[]
}

/** Most items kept per group. */
export const MAX_PER_GROUP = 8

const MIGRATION_PATH =
  /(alternative|migrat|shut-?down|sunset|replac|discontinu|switch|transition|end-of-life)/iu
const INTEGRATION_PATH = /(integrat|partner|connect|plugin|plug-in|add-on|addon)/iu
const DISCONTINUED =
  /\b(shut(?:ting|s)?[\s-]?down|shutdown|discontinu\w*|sunset\w*|no longer (?:available|supported|works?|offer\w*)|retir(?:ed|ing|es)|end[\s-]of[\s-]life|deprecat\w*|turn(?:ed|ing|s)? off|phas(?:ed|ing) out|going away|stopp(?:ed|ing) (?:working|supporting))\b/iu
const INTEGRATION =
  /\b(integrat\w*|works? with|connects? (?:with|to)|plug-?ins?|add-?ons?|partner\w*|sends? (?:[\w-]+ ){0,3}(?:through|via)|built for)\b/iu
const COMPARE =
  /(\bvs\.?(?=\s|$)|\bversus\b|\bcompar\w*|\balternatives? to\b|\binstead of\b|\bswitch(?:ing)? from\b|\bcheaper than\b|\bcompetitor\w*)/iu
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/u
const HOST_IN_TEXT =
  /(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?![a-z0-9-])/gu

/** Letters and digits only, lower case: "Text-Em-All" and "textemall" match. */
export function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** `/compare/`, `https://x.com/compare` and `compare` all become `/compare`. */
export function normalizePath(value: string): string {
  let path = value.trim()
  try {
    if (/^https?:\/\//iu.test(path)) path = new URL(path).pathname
  } catch {
    // Not a URL: use it as written.
  }
  path = path.split(/[?#]/u)[0] ?? ''
  if (!path.startsWith('/')) path = `/${path}`
  if (path.length > 1) path = path.replace(/\/+$/u, '')
  return path.toLowerCase()
}

/** Hosts a page names in its text or links to. */
export function hostsIn(page: ReadPage): string[] {
  const found = new Set<string>()
  for (const match of page.text.toLowerCase().matchAll(HOST_IN_TEXT)) {
    const host = bareDomain(match[1] ?? '')
    if (DOMAIN.test(host)) found.add(host)
  }
  for (const link of page.links ?? []) {
    const host = bareDomain(link)
    if (DOMAIN.test(host)) found.add(host)
  }
  return [...found]
}

export function guardCompanyIdeas(
  ideas: CompanyIdeas,
  pages: readonly ReadPage[],
  options: GuardOptions
): GuardedIdeas {
  const own = bareDomain(options.ownDomain)
  const seen = (options.seenDomains ?? []).map(bareDomain).filter((host) => DOMAIN.test(host))
  const byPath = new Map(pages.map((page) => [normalizePath(page.path), page] as const))
  const corpus = nameKey([...pages.map((page) => page.text), ...seen].join(' '))
  const known = new Set([...pages.flatMap(hostsIn), ...seen])
  const ownKeys = new Set(
    [...options.brandNames, own, own.split('.')[0] ?? ''].map(nameKey).filter(Boolean)
  )
  const dropped: GuardedIdeas['dropped'] = []
  const used = new Set<string>()
  const out: Omit<GuardedIdeas, 'dropped'> = {
    competitors: [],
    switchingFrom: [],
    integrations: []
  }

  const context = { byPath, corpus, known, own, seen, ownKeys }
  const place = (group: keyof typeof out, item: GuardedCompany): void => {
    const key = nameKey(item.name)
    if (used.has(key)) {
      dropped.push({ name: item.name, why: 'listed twice' })
      return
    }
    if (out[group].length >= MAX_PER_GROUP) return
    used.add(key)
    out[group].push(item)
  }

  // Switching-from and integrations first: a competitor with the same name is left out.
  for (const group of ['switchingFrom', 'integrations'] as const) {
    for (const raw of ideas[group]) {
      const checked = checkItem(raw, context, dropped)
      if (checked !== null) place(group, checked.item)
    }
  }
  for (const raw of ideas.competitors) {
    const checked = checkItem(raw, context, dropped)
    if (checked === null) continue
    const { item, page } = checked
    if (isDiscontinued(item, page)) {
      place('switchingFrom', item)
      continue
    }
    if (isIntegration(item, page)) {
      place('integrations', item)
      continue
    }
    const notRival = item.domain === null ? null : notCompetitorReason(item.domain, [], new Set())
    if (notRival !== null) {
      dropped.push({ name: item.name, why: notRival })
      continue
    }
    place('competitors', item)
  }
  return { ...out, dropped }
}

interface GuardContext {
  byPath: Map<string, ReadPage>
  corpus: string
  known: Set<string>
  own: string
  seen: readonly string[]
  ownKeys: Set<string>
}

function checkItem(
  raw: SuggestedCompany,
  context: GuardContext,
  dropped: GuardedIdeas['dropped']
): { item: GuardedCompany; page: ReadPage | null } | null {
  const name = raw.name.trim()
  const key = nameKey(name)
  if (key.length === 0) return null
  const given = raw.domain === null ? '' : raw.domain.trim()
  const domain = given.length === 0 ? null : resolveDomain(given, context)
  if (context.ownKeys.has(key) || (domain !== null && isOwn(domain, context.own))) {
    dropped.push({ name, why: 'the business’s own brand' })
    return null
  }
  const cited = domain !== null && context.seen.includes(domain)
  if (!namedIn(name, context.corpus) && !cited) {
    dropped.push({ name, why: 'not named on the pages read' })
    return null
  }
  const page = raw.evidence === null ? null : findPage(raw.evidence.path, context.byPath)
  // Evidence must be a page read; only a domain Google already cites may go without.
  if (page === null && !cited) {
    dropped.push({ name, why: 'no evidence from a page read' })
    return null
  }
  const evidence =
    raw.evidence === null || page === null
      ? null
      : { path: normalizePath(page.path), quote: raw.evidence.quote }
  const official = raw.officialDomain?.trim() ?? ''
  const candidates =
    domain === null ? [...new Set([given, official].filter((value) => value.length > 0))] : []
  const reason = plainReason(raw.reason)
  return {
    item: {
      name,
      domain,
      reason:
        reason.length > 0
          ? reason
          : evidence === null
            ? 'The site names it.'
            : `The site names it on ${evidence.path}.`,
      evidence,
      checkDomain: given.length > 0 && domain === null,
      candidates
    },
    page
  }
}

/**
 * A sentence about the reading itself, not the buyer: "The pages read do not show what
 * Text-Em-All does better." (batch 2 row 3), or an instruction to the reader such as
 * "Confirm the gateway's status before publishing." Such notes are dropped from reasons.
 */
const META_NOTE = new RegExp(
  [
    String.raw`\b(?:pages?|site|website|inputs?|text|sources?|saved data|evidence|search(?: results)?)(?: (?:read|given|provided|shown|available|above|(?:I|we) (?:found|checked|read|saw|used)))? (?:do(?:es)?(?: not|n[’']t)|did(?: not|n[’']t)|never|cannot|can[’']t|fails? to) (?:show|say|state|mention|confirm|list|explain|tell|describe|cover|include|specify|give)\b`,
    String.raw`\bnot (?:shown|stated|mentioned|confirmed|covered|specified|given|listed) (?:on|in|by) the (?:pages?|site|website|inputs?|text)\b`,
    String.raw`\b(?:no|without) (?:evidence|information|details?|data) (?:on|in|from) the (?:pages?|site|website|inputs?)\b`,
    String.raw`\b(?:unclear|unknown) from the (?:pages?|site|website|inputs?)\b`,
    // A note about the web search (batch 2 row 5): "I could not confirm that replies return."
    String.raw`\b(?:I|we) (?:could not|couldn[’']t|did not|didn[’']t|cannot|can[’']t) (?:find|confirm|verify|see|tell)\b`,
    // An instruction to the reader, not a fact: "[Confirm the gateway's status before publishing.]"
    String.raw`^\s*(?:please )?(?:confirm|check|verify|double[- ]check|make sure|ensure)\b`,
    String.raw`\bbefore (?:publishing|you publish|using (?:it|this))\b`,
    // "US coverage should be confirmed before buying." (a web-search reason, batch 2 row 5)
    String.raw`\bshould be (?:confirmed|checked|verified|double[- ]checked)\b`
  ].join('|'),
  'iu'
)

/** True when the text carries a note about the pages read ("the pages read do not show…"). */
export function hasMetaNote(value: string): boolean {
  return META_NOTE.test(value)
}

/**
 * A reason as plain buyer-facing sentences: notes about what the pages read do or do not
 * show are removed, bracketed or not. A bracketed unconfirmed fact stays (spec: unconfirmed
 * facts go in [brackets]).
 */
export function plainReason(value: string): string {
  const unbracketed = value.replace(/\[([^\]]*)\]/gu, (match, inner: string) =>
    META_NOTE.test(inner) ? ' ' : match
  )
  const sentences = unbracketed
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && !META_NOTE.test(sentence))
  return sentences
    .join(' ')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([.,;:!?])/gu, '$1')
    .trim()
}

/** The page read that a cited path names: `/compare`, `compare page`, `homepage` and so on. */
function findPage(path: string, byPath: Map<string, ReadPage>): ReadPage | null {
  const exact = byPath.get(normalizePath(path))
  if (exact !== undefined) return exact
  const key = nameKey(path)
  if (key === 'home' || key === 'homepage') return byPath.get('/') ?? null
  if (key.length < 3) return null
  for (const [pagePath, page] of byPath) {
    const pageKey = nameKey(pagePath)
    if (pageKey.length >= 3 && (key === pageKey || key.startsWith(pageKey))) return page
  }
  return null
}

/** The full name, or its first word (3+ letters), appears on a page read. */
function namedIn(name: string, corpus: string): boolean {
  const full = nameKey(name)
  if (full.length >= 2 && corpus.includes(full)) return true
  const first = nameKey(name.trim().split(/\s+/u)[0] ?? '')
  return first.length >= 3 && corpus.includes(first)
}

/** A domain the pages name or link to (or Google cites), in that spelling; else null. */
function resolveDomain(value: string, context: GuardContext): string | null {
  const domain = bareDomain(value)
  if (!DOMAIN.test(domain)) return null
  if (context.known.has(domain)) return domain
  const spelling = nameKey(domain)
  for (const host of context.known) {
    if (nameKey(host) === spelling) return host
  }
  return null
}

function isOwn(domain: string, own: string): boolean {
  return own.length > 0 && (domain === own || domain.endsWith(`.${own}`))
}

/** Evidence is an alternative/migration/shutdown page about a service that went away. */
function isDiscontinued(item: GuardedCompany, page: ReadPage | null): boolean {
  const quote = item.evidence?.quote ?? ''
  if (DISCONTINUED.test(quote)) return true
  if (item.evidence === null || page === null) return false
  return MIGRATION_PATH.test(item.evidence.path) && DISCONTINUED.test(page.text)
}

/** Evidence is an integration page about it (or the quote says it works with the product). */
function isIntegration(item: GuardedCompany, page: ReadPage | null): boolean {
  const quote = item.evidence?.quote ?? ''
  if (INTEGRATION.test(quote) && !COMPARE.test(quote)) return true
  if (item.evidence === null || page === null || COMPARE.test(quote)) return false
  const pathKey = nameKey(item.evidence.path)
  const first = nameKey(item.name.trim().split(/\s+/u)[0] ?? '')
  const aboutIt =
    INTEGRATION_PATH.test(item.evidence.path) || (first.length >= 3 && pathKey.includes(first))
  return aboutIt && INTEGRATION.test(page.text) && !COMPARE.test(page.text)
}
