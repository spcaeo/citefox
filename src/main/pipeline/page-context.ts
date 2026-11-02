import type { GenerationTemplate, Market, PageSummary } from '@shared/domain'
import { competitorContext } from '../engine/competitor-context'
import type { Logger } from '../logging/logger'
import { businessBlock, competitorBlock, marketBlock, productBlock } from '../prompts/blocks'
import { getLatestSnapshot, type StoredSnapshot } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { getPage, listPageMarkets } from '../storage/pages'
import { getMarket, readProjectProfile, type ProjectProfile } from '../storage/project-profile'
import { getProject } from '../storage/records'
import { PipelineError } from './errors'
import {
  capPageText,
  formatFaqs,
  formatLastModified,
  formatOutline,
  unfencePageText
} from './template-context'
import { withSettingsInstructions } from './template-settings'
import { renderTemplate } from './templates'

/**
 * What every page-setup step renders with (Docs/PROMPT-AUDIT.md, package P1): the
 * page's flat values, fenced as data, and the context blocks code builds from the
 * project (`business_block`, `product_block`, `market_block`, `competitor_block`).
 * Setup and Try it both render through here, so a draft is tested on exactly what
 * a run sends.
 */

/** What a page step needs to render: the databases, project and logger. */
export interface PageRenderDeps {
  appDb: SqliteDatabase
  projectDb: SqliteDatabase
  projectId: string
  logger: Logger
}

/** The flat variables a page step renders with (also read by Try it). */
export function pageTemplateValues(
  page: PageSummary,
  snapshot: StoredSnapshot,
  brandNames: readonly string[],
  promptCount: number
): Record<string, string | number> {
  return {
    url: unfencePageText(page.url ?? ''),
    title: unfencePageText(snapshot.title ?? ''),
    meta_description: unfencePageText(snapshot.metaDescription ?? ''),
    h1: unfencePageText(snapshot.h1 ?? ''),
    page_text: unfencePageText(capPageText(snapshot.bodyText)),
    brand_name: brandNames.join(', '),
    prompt_count: promptCount,
    outline: unfencePageText(formatOutline(snapshot.outline)),
    faqs: unfencePageText(formatFaqs(snapshot.faqs)),
    last_modified: formatLastModified(snapshot.modifiedAt, snapshot.publishedAt)
  }
}

/** What {@link pageBlockValues} builds the blocks from. */
export interface PageBlockInput {
  db: SqliteDatabase
  pageId: string
  /** The project's domain; the page's host is used when it is blank. */
  domain: string
  pageUrl: string | null
  brandNames: readonly string[]
  /** The market the step writes for. Null renders the project's default market. */
  market: Market | null
  /** A template's language setting, which wins over the market's language. */
  language: string | null
}

/**
 * `{{ business_block }}`, `{{ product_block }}`, `{{ market_block }}` and
 * `{{ competitor_block }}` for one page. Competitors come from
 * `competitorContext({ pageId })`: the page's product once products are saved,
 * the project-wide lists before.
 */
export function pageBlockValues(input: PageBlockInput): Record<string, string> {
  const context = competitorContext(input.db, { pageId: input.pageId })
  const market = input.market ?? readProjectProfile(input.db)?.market ?? null
  return {
    business_block: businessBlock({
      domain: input.domain.trim() || hostOf(input.pageUrl),
      summary: context.product?.job ?? null,
      brandNames: input.brandNames
    }),
    product_block: productBlock(context.product),
    market_block:
      market === null
        ? marketBlock({ country: '', language: input.language ?? 'en' })
        : marketBlock({
            country: market.country,
            language: input.language ?? market.language,
            location: market.location
          }),
    competitor_block: competitorBlock(context)
  }
}

/**
 * Renders a page step's template with the page values and the blocks, appends the
 * engine's lines (`suffix`) and the template's settings lines.
 */
export function renderPagePrompt(
  deps: PageRenderDeps,
  template: GenerationTemplate,
  snapshot: StoredSnapshot,
  pageId: string,
  suffix: string,
  options: { market?: Market | null } = {}
): string {
  const page = requirePage(deps.projectDb, pageId, deps.projectId)
  const profile = requireProfile(deps.projectDb)
  const values = {
    ...pageTemplateValues(
      page,
      snapshot,
      profile.brandNames,
      template.settings.promptCount ?? page.promptCount
    ),
    ...pageBlockValues({
      db: deps.projectDb,
      pageId,
      domain: projectDomain(deps.appDb, deps.projectId),
      pageUrl: page.url,
      brandNames: profile.brandNames,
      market: options.market ?? defaultPageMarket(deps.projectDb, page),
      language: template.settings.language
    })
  }
  const rendered = renderTemplate(template.body, values)
  if (rendered.warnings.length > 0) {
    deps.logger.warn('template variables', { kind: template.kind, warnings: rendered.warnings })
  }
  const text = suffix.length === 0 ? rendered.text : `${rendered.text}\n${suffix}`
  return withSettingsInstructions(text, template.kind, template.settings)
}

/** The project's domain from the app database, or '' when the project row is missing. */
export function projectDomain(appDb: SqliteDatabase, projectId: string): string {
  try {
    return getProject(appDb, projectId)?.domain ?? ''
  } catch {
    return ''
  }
}

/** Every text of the snapshot, for checking quotes (also read by Try it). */
export function pageBlob(snapshot: StoredSnapshot): string {
  return [
    snapshot.title ?? '',
    snapshot.metaDescription ?? '',
    snapshot.h1 ?? '',
    snapshot.bodyText,
    ...snapshot.outline.map((heading) => heading.text),
    ...snapshot.faqs.flatMap((faq) => [faq.question, faq.answer])
  ].join('\n')
}

/** The page's markets, its default first. */
export function marketsForPage(
  db: SqliteDatabase,
  pageId: string,
  defaultMarketId: string | null
): Market[] {
  const markets: Market[] = []
  for (const link of listPageMarkets(db, pageId)) {
    const market = getMarket(db, link.marketId)
    if (market === null) {
      throw new PipelineError('A market on this page is missing.', {
        code: 'not_found',
        nextStep: 'Add the market again, then write the prompts.'
      })
    }
    markets.push(market)
  }
  markets.sort((left, right) => {
    if (left.id === defaultMarketId) return -1
    if (right.id === defaultMarketId) return 1
    return 0
  })
  return markets
}

/** The page's default market, else its first, else null (the project's default is used). */
export function defaultPageMarket(db: SqliteDatabase, page: PageSummary): Market | null {
  try {
    return marketsForPage(db, page.id, page.defaultMarketId)[0] ?? null
  } catch {
    return null
  }
}

export function requirePage(db: SqliteDatabase, pageId: string, projectId: string): PageSummary {
  const page = getPage(db, pageId, projectId)
  if (page === null) {
    throw new PipelineError('That page is not in this project.', {
      code: 'not_found',
      nextStep: 'Add the page, then try again.'
    })
  }
  return page
}

export function requireSnapshot(
  db: SqliteDatabase,
  pageId: string,
  message = 'Read the page before writing the buyer profile.'
): StoredSnapshot {
  const snapshot = getLatestSnapshot(db, pageId)
  if (snapshot === null) {
    throw new PipelineError(message, {
      code: 'not_found',
      nextStep: 'Read the page, then try again.'
    })
  }
  return snapshot
}

export function requireProfile(db: SqliteDatabase): ProjectProfile {
  const profile = readProjectProfile(db)
  if (profile === null) {
    throw new PipelineError('Save the project profile before reading pages.', {
      code: 'not_found',
      nextStep: 'Save the project profile, then try again.'
    })
  }
  return profile
}

function hostOf(url: string | null): string {
  if (url === null) return ''
  try {
    return new URL(url).hostname.replace(/^www\./u, '')
  } catch {
    return ''
  }
}
