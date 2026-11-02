import { isCountryCode, isLanguageTag } from '@shared/domain'
import type { WebsitePageRole } from '@shared/domain'
import type {
  FillFound,
  FillFromWebsiteRequest,
  FillFromWebsiteResult,
  ProductSearchState,
  SuggestedMarket,
  WebsitePageRead
} from '@shared/ipc'
import { SITE_READ_RULES } from '../assist/preamble'
import { pageLabel, progressHint, progressNote, progressStep } from '../assist/progress'
import { IpcRequestError } from '../ipc-request'
import { PipelineError } from '../pipeline/errors'
import { systemAddressLookup } from '../pipeline/fetch-guard'
import { capPageText } from '../pipeline/template-context'
import { readProjectProfile } from '../storage/project-profile'
import { getProject } from '../storage/records'
import {
  completeAssist,
  parseSiteRead,
  parseSwitching,
  type SiteMarket,
  type SiteProduct,
  type SiteRead
} from './assist'
import { SITE_READ_SHAPE, SWITCHING_SHAPE } from './assist-shapes'
import { seenReferenceDomains } from './competitor-domains'
import type { ReadPage } from './competitor-guard'
import { SWITCHING_RULES } from './competitor-rules'
import { competitorsByProduct } from './competitors-by-product'
import { guardFillCompanies } from './fill-companies'
import type { EngineHost } from './host'
import { withProject } from './project-db'
import { groundSummary, ordinaryName, siteCheckOf } from './site-grounding'
import {
  chooseSitePages,
  menuBlock,
  EXTRA_PAGES_MAX,
  PRODUCT_RULE,
  rememberFacts,
  rememberOutline,
  siteLinks,
  siteMenu,
  type SiteFact,
  type SiteLink
} from './site-outline'
import { siteIndexLinks } from './site-index'
import { homepageReader, readDetail, readSitePage, type SitePageBody } from './site-page'

/**
 * `projects:fillFromWebsite` (FR-1.8, Docs/FEEDBACK.md batch 2 row 5). Three focused
 * Claude steps instead of one mixed prompt:
 *
 * 1. Site read (no tools, the pages read): summary, brands, products, market.
 * 2. Competitors per product (web search on, one call per product, at most 3, in
 *    parallel): the owner's direct question for the chosen market; see
 *    `product-competitors.ts`.
 * 3. What buyers switch from and integrations (no tools, the pages read), run alongside
 *    step 1; the batch-1 guard still applies to them.
 *
 * Nothing is saved: the result is suggestions only.
 */

const PAGE_ROLES: readonly WebsitePageRole[] = ['home', 'pricing', 'about', 'compare']

/**
 * Characters kept per page read; the compare page keeps more (its rival list runs long),
 * an offering page less (up to 8 of them; the whole read stays near 24,000 characters).
 */
const PAGE_CHARS = 2000
const COMPARE_PAGE_CHARS = 6000
const EXTRA_PAGE_CHARS = 1500

/**
 * Too little to read (prompt bench report: 1 page and 1–2 KB on two big sites gave guessed
 * answers): fewer pages than this stops the read. Under `CHECK_MIN_CHARS` of text the read
 * goes on, but the section cards' text checks stay off (`site-grounding.ts`).
 */
export const THIN_MIN_PAGES = 3

export const SITE_READ_ASSIST_ID = 'project.fillSiteRead'
export const SWITCHING_ASSIST_ID = 'project.fillSwitching'

export async function fillFromWebsite(
  host: EngineHost,
  request: FillFromWebsiteRequest
): Promise<FillFromWebsiteResult> {
  const channel = 'projects:fillFromWebsite'
  if (request.projectId !== null && getProject(host.storage.db, request.projectId) === null) {
    throw new IpcRequestError(channel, 'That project was not found')
  }
  const { pagesRead, excerpts, pages, menu } = await readPages(host, request.domain)
  host.emitFillProgress({
    domain: request.domain,
    phase: 'suggest',
    state: 'running',
    url: null,
    detail: 'Suggesting brands, products and competitors.',
    nextStep: null
  })
  const empty = (message: string, nextStep: string): FillFromWebsiteResult => ({
    domain: request.domain,
    pagesRead,
    summary: null,
    products: [],
    brands: [],
    competitors: [],
    switchingFrom: [],
    integrations: [],
    suggestedMarket: null,
    message,
    nextStep
  })
  if (excerpts.length === 0) {
    progressNote({
      kind: 'result',
      label: 'Could not read the website',
      detail: 'Check the domain and try again.',
      state: 'failed'
    })
    warn(host, request.domain, 'Could not read the website.', 'Check the domain and try again.')
    return empty('Could not read the website.', 'Check the domain and try again.')
  }
  const known =
    request.projectId === null
      ? { seen: [], market: null }
      : await withProject(host, request.projectId, channel, (opened) => ({
          seen: seenReferenceDomains(opened.db),
          market: readProjectProfile(opened.db)?.market ?? null
        }))
  const pageText = capPageText(excerpts.join('\n\n'))
  const thin = thinRead(request.domain, excerpts.length, pageText.length)
  if (thin !== null) {
    progressNote({
      kind: 'result',
      label: 'Too little of the website could be read',
      state: 'failed'
    })
    warn(host, request.domain, thin, 'Try again, use your own ChatGPT, or type it yourself.')
    // A clear stop the setup screen shows with Try again / Use my own ChatGPT / I'll type it myself.
    throw new IpcRequestError(channel, thin)
  }
  progressHint(
    `Using ${excerpts.length} of ${pagesRead.length} ${pagesRead.length === 1 ? 'page' : 'pages'} · no searches`
  )
  try {
    if (request.brandOnly === true) {
      const site = await readSite(host, request, pageText, menu)
      keepFacts(host, request.domain, site, { switchingFrom: [], integrations: [] })
      return brandOnlyResult(host, request, pagesRead, site)
    }
    const [site, switching] = await Promise.all([
      readSite(host, request, pageText, menu),
      readSwitching(host, request, pageText)
    ])
    keepFacts(host, request.domain, site, switching)
    const brandNames = site.brands.map((brand) => brand.name)
    host.logger.info('fill site read', {
      products: site.products.map((product) => product.name),
      comparedWith: site.comparedWith
    })
    const others = await guardFillCompanies({
      ideas: { competitors: [], ...switching },
      pages,
      domain: request.domain,
      brandNames,
      seen: known.seen,
      dns: host.pageDns ?? systemAddressLookup(),
      createId: () => host.createId()
    })
    const suggested = validMarket(site.suggestedMarket)
    const chosen = chosenMarket(request.market ?? null) ?? known.market ?? suggested
    const market = chosen === null ? null : { country: chosen.country, language: chosen.language }
    const brands = site.brands.map((brand) => ({
      id: `brand-${host.createId()}`,
      name: brand.name,
      reason: brand.reason
    }))
    const toSearch = (
      site.products.length > 0 ? site.products : [fallbackProduct(request.domain, site)]
    ).map((product) => ({ ...product, id: `prod-${host.createId()}` }))
    // Setup step 3 lists what the site sells now, before the searches (minutes) start.
    emitFound(host, request.domain, 'Found what the site sells.', {
      kind: 'site',
      summary: site.summary,
      brands,
      products: toSearch.map((product) => ({ ...product, searchNote: null })),
      comparedWith: site.comparedWith,
      switchingFrom: others.switchingFrom,
      integrations: others.integrations,
      suggestedMarket: suggested,
      market
    })
    const found = await competitorsByProduct(host, {
      channel,
      projectId: request.projectId,
      domain: request.domain,
      summary: site.summary,
      products: toSearch,
      market,
      comparedWith: site.comparedWith,
      brandNames,
      notCompetitors: [...others.switchingFrom, ...others.integrations].map((item) => item.name),
      readHomepage: homepageReader(host),
      onSearch: (event) =>
        emitFound(host, request.domain, searchDetail(event.state), { kind: 'search', ...event })
    })
    const dropped = [...others.dropped, ...found.dropped]
    if (dropped.length > 0) {
      // Company names and a short reason only: never page text.
      host.logger.info('fill suggestions left out', {
        count: dropped.length,
        items: dropped.slice(0, 20).map((item) => `${item.name}: ${item.why}`)
      })
    }
    const companies =
      found.competitors.length + others.switchingFrom.length + others.integrations.length
    const nothing = site.brands.length === 0 && companies === 0 && suggested === null
    const count = site.brands.length + companies + (suggested === null ? 0 : 1)
    progressNote({
      kind: 'result',
      label: nothing
        ? 'No suggestions came back'
        : `${count} ${count === 1 ? 'suggestion' : 'suggestions'} ready`,
      detail: nothing ? 'Try again with a public domain.' : 'Nothing is saved until you add it',
      state: nothing ? 'skipped' : 'done'
    })
    host.emitFillProgress({
      domain: request.domain,
      phase: 'suggest',
      state: nothing ? 'warning' : 'ok',
      url: null,
      detail: nothing ? 'No suggestions were returned.' : 'Suggestions are ready.',
      nextStep: nothing ? 'Try again with a public domain.' : null
    })
    return {
      domain: request.domain,
      pagesRead,
      summary: site.summary,
      products: found.products,
      brands,
      competitors: found.competitors,
      switchingFrom: others.switchingFrom,
      integrations: others.integrations,
      suggestedMarket: suggested,
      message: nothing
        ? 'No brands or competitors were suggested.'
        : 'Suggestions are ready. Nothing was saved.',
      nextStep: nothing ? 'Try again with a public domain.' : null
    }
  } catch (error) {
    const failed = error instanceof PipelineError ? error : null
    const message = failed?.message ?? 'Could not suggest brands and competitors.'
    const nextStep = failed?.nextStep ?? 'Try again.'
    warn(host, request.domain, message, nextStep)
    return empty(message, nextStep)
  }
}

/** Step 1: what the site sells. A failure fails the read (nothing to search for). */
async function readSite(
  host: EngineHost,
  request: FillFromWebsiteRequest,
  pageText: string,
  menu: readonly SiteLink[]
): Promise<SiteRead> {
  const json = await completeAssist(
    host,
    'projects:fillFromWebsite',
    siteReadPrompt(request.domain, pageText, menu),
    (value) => parseSiteRead(value) !== null,
    SITE_READ_SHAPE,
    { assistId: SITE_READ_ASSIST_ID, projectId: request.projectId },
    { rules: SITE_READ_RULES }
  )
  const site = parseSiteRead(json)
  if (site === null) {
    throw new PipelineError('The reply did not match the schema.', {
      code: 'schema_validation',
      nextStep: 'Try again.'
    })
  }
  // A label or number the pages never use is taken out of the summary in code.
  const check = siteCheckOf({ pages: [], menu: menu, text: pageText })
  // Feature labels and ordinary words ("Storage", "Premium") are not brands to track.
  const main = site.brands[0]?.name ?? request.domain.split('.')[0] ?? request.domain
  const brands = site.brands.filter(
    (brand, index) => index === 0 || !ordinaryName(brand.name, main, check)
  )
  return {
    ...site,
    brands,
    summary: site.summary === null ? null : groundSummary(site.summary, check)
  }
}

/** The plain stop for a read with too little text, or null when there is enough. */
export function thinRead(domain: string, pages: number, chars: number): string | null {
  if (pages >= THIN_MIN_PAGES) return null
  const kb = Math.max(1, Math.round(chars / 1000))
  return `Only ${pages} ${pages === 1 ? 'page' : 'pages'} (about ${kb} KB of text) of ${domain} could be read: too little to say what it sells without guessing. The site may block automatic readers with a robot check, or build its pages with scripts. You can try again in a few minutes, use your own ChatGPT (it can open the site for you), or type what it sells yourself.`
}

/** What the read found, kept for the section cards' prompts and checks. */
function keepFacts(
  host: EngineHost,
  domain: string,
  site: SiteRead,
  switching: { switchingFrom: SuggestedLike[]; integrations: SuggestedLike[] }
): void {
  const fact = (name: string, evidence: { path: string; quote: string } | null): SiteFact => ({
    name,
    path: evidence?.path ?? null,
    quote: evidence?.quote ?? null
  })
  rememberFacts(host, domain, {
    brands: site.brands.map((brand) => brand.name),
    products: site.products.map((product) => fact(product.name, product.evidence)),
    audiences: site.audiences.map((item) => fact(item.name, item.evidence)),
    comparedWith: site.comparedWith,
    switchingFrom: switching.switchingFrom.map((item) => fact(item.name, item.evidence)),
    integrations: switching.integrations.map((item) => fact(item.name, item.evidence))
  })
}

interface SuggestedLike {
  name: string
  evidence: { path: string; quote: string } | null
}

/** A brand-only read: what the site says about itself, no competitors. */
function brandOnlyResult(
  host: EngineHost,
  request: FillFromWebsiteRequest,
  pagesRead: FillFromWebsiteResult['pagesRead'],
  site: Awaited<ReturnType<typeof readSite>>
): FillFromWebsiteResult {
  return {
    domain: request.domain,
    pagesRead,
    summary: site.summary,
    products: site.products.map((product) => ({
      id: `prod-${host.createId()}`,
      name: product.name,
      job: product.job,
      buyer: product.buyer,
      evidence: product.evidence,
      searchNote: null
    })),
    brands: site.brands.map((brand) => ({
      id: `brand-${host.createId()}`,
      name: brand.name,
      reason: brand.reason
    })),
    competitors: [],
    switchingFrom: [],
    integrations: [],
    suggestedMarket: validMarket(site.suggestedMarket),
    message:
      site.summary === null ? 'CiteFox AI could not say what the site sells.' : 'Read again.',
    nextStep: site.summary === null ? 'Try again.' : null
  }
}

/** Step 1's prompt: the task, the site menu, then the pages read. */
function siteReadPrompt(domain: string, pageText: string, menu: readonly SiteLink[]): string {
  const block = menuBlock(menu)
  return `Assist: ${SITE_READ_ASSIST_ID}
Read the pages of ${domain} below and say what the business sells.
- summary: what ${domain} sells, to whom, for what job, and the countries or regions it serves when the pages name them (otherwise say nothing about countries). Describe the business, never the pages.
- products: ${PRODUCT_RULE}${block.length > 0 ? ' Use the site menu for offerings whose page was not read.' : ''}
- comparedWith: live products its pages compare it with or help buyers switch from, by name.
- brands: the company name and its own products sold or marketed under their own name, spelled as on the pages; not feature, plan or ordinary-word names.
- audiences: the industries, roles, teams and use cases the pages say it is for, with a quote.
- suggestedMarket: where it sells.
${block.length > 0 ? `\n${block.join('\n')}\n` : ''}
The pages read, each starting with its path:

${pageText}`
}

/** Step 3: switch-from and integrations. A failure only leaves those groups empty. */
async function readSwitching(
  host: EngineHost,
  request: FillFromWebsiteRequest,
  pageText: string
): Promise<NonNullable<ReturnType<typeof parseSwitching>>> {
  try {
    const json = await completeAssist(
      host,
      'projects:fillFromWebsite',
      `Assist: ${SWITCHING_ASSIST_ID}
From the pages of ${request.domain} below, list what buyers switch from and the tools used together with it.

${SWITCHING_RULES}

The pages read, each starting with its path:

${pageText}`,
      (value) => parseSwitching(value) !== null,
      SWITCHING_SHAPE,
      { assistId: SWITCHING_ASSIST_ID, projectId: request.projectId },
      { rules: SITE_READ_RULES }
    )
    return parseSwitching(json) ?? { switchingFrom: [], integrations: [] }
  } catch (error) {
    host.logger.warn('switch-from read failed', {
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown'
    })
    return { switchingFrom: [], integrations: [] }
  }
}

interface PageToRead {
  path: string
  role: WebsitePageRole
}

interface PagesRead {
  pagesRead: WebsitePageRead[]
  excerpts: string[]
  pages: ReadPage[]
  /** The home page's menu (same-site links with their words). */
  menu: SiteLink[]
}

/**
 * The pages of the site, each as a live step: the home page, then pricing, about and
 * compare, then up to 8 offering pages the home page links to (`site-outline.ts`).
 * The pages after the home page are read side by side (the read pool keeps it to two
 * at once on the site) and kept in this order, so the prompt reads the same either way.
 */
async function readPages(host: EngineHost, domain: string): Promise<PagesRead> {
  const read: PagesRead = { pagesRead: [], excerpts: [], pages: [], menu: [] }
  const home = await readOnePage(host, domain, { path: '/', role: 'home' })
  keepPage(read, home)
  let links = home.body === null ? [] : siteLinks(domain, home.body)
  let curated = false
  if (links.length === 0) {
    // A blocked or script-built home page: the site's llms.txt or sitemap lists its pages.
    const index = await siteIndexLinks(host, domain)
    links = index.links
    curated = index.source === 'llms'
    if (links.length > 0) progressHint(`Found ${links.length} pages in the site's own page list`)
  }
  read.menu = siteMenu(links)
  const fixed = PAGE_ROLES.filter((role) => role !== 'home').map((role): PageToRead => ({
    path: `/${role}`,
    role
  }))
  const already = ['/', ...fixed.map((page) => page.path)]
  // An llms.txt lists the main pages first: read them in its order.
  const extra = (curated ? firstNewPaths(links, already) : chooseSitePages(links, already)).map(
    (path): PageToRead => ({ path, role: 'page' })
  )
  const rest = await Promise.all(
    [...fixed, ...extra].map((page) => readOnePage(host, domain, page))
  )
  for (const outcome of rest) keepPage(read, outcome)
  rememberOutline(host, domain, {
    pages: read.pages.map((page) => ({ path: page.path, title: page.text.split('\n')[0] ?? '' })),
    menu: read.menu,
    text: capPageText(read.excerpts.join('\n\n'))
  })
  return read
}

/** The first `EXTRA_PAGES_MAX` link paths not read yet, in list order. */
function firstNewPaths(links: readonly SiteLink[], already: readonly string[]): string[] {
  const key = (path: string): string => path.toLowerCase().replace(/\/+$/u, '') || '/'
  const seen = new Set(already.map(key))
  const out: string[] = []
  for (const link of links) {
    if (out.length >= EXTRA_PAGES_MAX || seen.has(key(link.path))) continue
    seen.add(key(link.path))
    out.push(link.path)
  }
  return out
}

/** One page's read: null `body` when it could not be read or had no text. */
interface PageOutcome {
  page: PageToRead
  url: string
  body: SitePageBody | null
}

/** One page as a live step. */
async function readOnePage(
  host: EngineHost,
  domain: string,
  page: PageToRead
): Promise<PageOutcome> {
  const url = `https://${domain}${page.path}`
  host.emitFillProgress({
    domain,
    phase: 'fetch',
    state: 'running',
    url,
    detail: 'Reading the page.',
    nextStep: null
  })
  const step = progressStep({ kind: 'read', label: `Reading ${pageLabel(url)}` })
  const body = await readSitePage(host, url)
  if (body === null || body.text.trim().length === 0) {
    step.skip('Not found or not readable · skipped')
    host.emitFillProgress({
      domain,
      phase: 'fetch',
      state: 'warning',
      url,
      detail: 'Could not read this page.',
      nextStep: 'The suggestion can still use the pages that loaded.'
    })
    return { page, url, body: null }
  }
  step.done(readDetail(body))
  host.emitFillProgress({
    domain,
    phase: 'fetch',
    state: 'ok',
    url,
    detail: 'Read the page.',
    nextStep: null
  })
  return { page, url, body }
}

/** Adds one page's read to `read`; its excerpt joins when it has text. */
function keepPage(read: PagesRead, { page, url, body }: PageOutcome): void {
  read.pagesRead.push({ url, role: page.role, ok: body !== null })
  if (body === null) return
  // The compare page names the rivals the site weighs itself against: keep more of it.
  const max =
    page.role === 'compare'
      ? COMPARE_PAGE_CHARS
      : page.role === 'page'
        ? EXTRA_PAGE_CHARS
        : PAGE_CHARS
  const text = body.text.slice(0, max)
  const label = page.role === 'page' ? page.path : `${page.path} (${page.role})`
  read.excerpts.push(`${label}: ${body.title}\n${text}`)
  read.pages.push({
    path: page.path,
    text: `${body.title}\n${text}`,
    ...(body.links ? { links: body.links } : {})
  })
}

/** A `suggest` event carrying what the read found so far (setup step 3's live list). */
function emitFound(host: EngineHost, domain: string, detail: string, found: FillFound): void {
  host.emitFillProgress({
    domain,
    phase: 'suggest',
    state: 'running',
    url: null,
    detail,
    nextStep: null,
    found
  })
}

function searchDetail(state: ProductSearchState): string {
  switch (state) {
    case 'waiting':
      return 'A competitor search is waiting its turn.'
    case 'running':
      return 'Searching the web for competitors.'
    case 'done':
      return 'A competitor search is done.'
    case 'failed':
      return 'A competitor search did not finish.'
  }
}

function warn(host: EngineHost, domain: string, detail: string, nextStep: string): void {
  host.emitFillProgress({ domain, phase: 'suggest', state: 'warning', url: null, detail, nextStep })
}

/** No product came back: ask about the business as a whole. */
function fallbackProduct(domain: string, site: SiteRead): SiteProduct {
  return {
    name: 'main product',
    job: site.summary ?? `What ${domain} sells.`,
    buyer: 'Its buyers',
    evidence: null
  }
}

function chosenMarket(
  market: { country: string; language: string } | null
): { country: string; language: string } | null {
  if (market === null) return null
  const country = market.country.trim().toUpperCase()
  const language = market.language.trim()
  return isCountryCode(country) && isLanguageTag(language) ? { country, language } : null
}

function validMarket(market: SiteMarket | null): SuggestedMarket | null {
  if (market === null) return null
  const valid = chosenMarket(market)
  return valid === null ? null : { ...valid, location: market.location, reason: market.reason }
}
