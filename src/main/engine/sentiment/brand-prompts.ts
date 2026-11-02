import {
  DEFAULT_BRAND_PROMPT_COUNT,
  MAX_BRAND_PROMPTS,
  SEARCHES_PER_PROMPT_MAX,
  SEARCHES_PER_PROMPT_MIN,
  type BrandPromptKind,
  type BrandPromptSet,
  type Market
} from '@shared/domain'
import type { BrandPromptDraft } from '@shared/ipc'
import Ajv from 'ajv'
import type { Logger } from '../../logging/logger'
import { redactString } from '../../logging/redact'
import { PipelineError } from '../../pipeline/errors'
import { llmInputHash } from '../../pipeline/hash'
import { completeStructured, type GenerationCallCaps } from '../../pipeline/llm'
import { BRAND_PROMPTS_SCHEMA } from '../../pipeline/sentiment-templates'
import { loadGenerationTemplate, renderTemplate } from '../../pipeline/templates'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import { getLatestBrandPromptSet, insertBrandPromptSet } from '../../storage/brand-records'
import { getLatestBuyerProfile } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { getPage, getStoredPage, listPageMarkets } from '../../storage/pages'
import { getMarket, readProjectProfile } from '../../storage/project-profile'
import { marketBlock, productBlock } from '../../prompts/blocks'
import {
  competitorContext,
  type CompetitorContext,
  type NamedCompetitor
} from '../competitor-context'
import { languageName, marketText } from './context'

const ajv = new Ajv({ allErrors: true, strict: false })
const promptsValid = ajv.compile(BRAND_PROMPTS_SCHEMA)

/** FR-16.1. The page's markets, its default market first, then in link order. */
export function pageMarkets(db: SqliteDatabase, pageId: string): Market[] {
  const defaultId = getStoredPage(db, pageId)?.defaultMarketId ?? null
  const markets = listPageMarkets(db, pageId)
    .map((link) => getMarket(db, link.marketId))
    .filter((market): market is Market => market !== null)
  return [
    ...markets.filter((market) => market.id === defaultId),
    ...markets.filter((market) => market.id !== defaultId)
  ]
}

/**
 * The page's brand prompts with their search cost (FR-16.1). Each market
 * searches the prompts in its own language, 1 sample each.
 */
export function brandPromptSetView(db: SqliteDatabase, pageId: string): BrandPromptSet {
  const set = getLatestBrandPromptSet(db, pageId)
  const markets = pageMarkets(db, pageId)
  const languages = [...new Set(markets.map((market) => market.language.toLowerCase()))]
  const prompts = set?.prompts ?? []
  const covered = new Set(prompts.map((prompt) => prompt.language))
  const searched = markets.reduce(
    (sum, market) =>
      sum + prompts.filter((prompt) => prompt.language === market.language.toLowerCase()).length,
    0
  )
  return {
    pageId,
    version: set?.version ?? null,
    savedAt: set?.savedAt ?? null,
    templateHash: set?.templateHash ?? null,
    prompts,
    languages,
    missingLanguages: languages.filter((language) => !covered.has(language)),
    estimate: {
      prompts: prompts.length,
      markets: markets.filter((market) => covered.has(market.language.toLowerCase())).length,
      minSearches: searched * SEARCHES_PER_PROMPT_MIN,
      maxSearches: searched * SEARCHES_PER_PROMPT_MAX
    }
  }
}

/** True when the text names one of the brand names, compared case-insensitively. */
export function namesBrand(text: string, brandNames: readonly string[]): boolean {
  const lower = text.toLowerCase()
  return brandNames.some(
    (name) => name.trim().length > 0 && lower.includes(name.trim().toLowerCase())
  )
}

export interface BrandPromptDeps {
  db: SqliteDatabase
  appDb: SqliteDatabase
  logger: Logger
  now: () => string
  createId: () => string
  secrets?: readonly string[]
  caps?: GenerationCallCaps
}

/** FR-16.1. User edits: the next version. Every prompt must name the brand. */
export function saveBrandPrompts(
  deps: BrandPromptDeps,
  input: { projectId: string; pageId: string; prompts: readonly BrandPromptDraft[] }
): BrandPromptSet {
  const page = requirePage(deps.db, input.projectId, input.pageId)
  const brands = requireBrands(deps.db)
  if (input.prompts.length === 0) {
    throw new PipelineError('Add at least one brand prompt.', {
      code: 'not_found',
      nextStep: 'Write a prompt that names your brand.'
    })
  }
  const perLanguage = new Map<string, number>()
  for (const prompt of input.prompts) {
    const language = prompt.language.trim().toLowerCase()
    perLanguage.set(language, (perLanguage.get(language) ?? 0) + 1)
    if ((perLanguage.get(language) ?? 0) > MAX_BRAND_PROMPTS) {
      throw new PipelineError(
        `A page has at most ${MAX_BRAND_PROMPTS} brand prompts per language.`,
        {
          code: 'not_found',
          nextStep: 'Remove a prompt and save again.'
        }
      )
    }
    if (!namesBrand(prompt.text, brands)) {
      throw new PipelineError(`Each brand prompt must name ${brands[0] ?? 'the brand'}.`, {
        code: 'not_found',
        nextStep: `Add ${brands[0] ?? 'the brand name'} to the prompt and save again.`
      })
    }
  }
  insertBrandPromptSet(deps.db, {
    pageId: page.id,
    savedAt: deps.now(),
    templateId: null,
    templateHash: null,
    prompts: input.prompts.map((prompt) => ({
      id: deps.createId(),
      kind: prompt.kind,
      language: prompt.language,
      text: prompt.text
    }))
  })
  return brandPromptSetView(deps.db, page.id)
}

/**
 * FR-16.1. Claude writes the default 5 brand prompts per market language from
 * `brand_prompts.md`, and they are saved as the next version. Nothing is
 * searched until the next check, whose estimate shows their cost.
 */
export async function generateBrandPrompts(
  deps: BrandPromptDeps & { claude: ClaudeProvider },
  input: { projectId: string; pageId: string }
): Promise<BrandPromptSet> {
  const page = requirePage(deps.db, input.projectId, input.pageId)
  const brands = requireBrands(deps.db)
  const markets = pageMarkets(deps.db, page.id)
  if (markets.length === 0) {
    throw new PipelineError('Add a market to this page first.', {
      code: 'not_found',
      nextStep: 'Open the Markets tab and add a market.'
    })
  }
  // FR-26.8: the project's own version of the step, else the app default.
  const template = loadGenerationTemplate(
    deps.appDb,
    'brand_prompts',
    undefined,
    'templates:get',
    deps.db
  )
  const buyer = getLatestBuyerProfile(deps.db, page.id)
  // Same product, different competitors: the comparison is against a competitor of
  // this page's product (Docs/PROMPT-AUDIT.md, P6 5).
  const competitors = competitorContext(deps.db, { pageId: page.id })
  const versus = comparisonCompetitor(competitors)
  const secrets = deps.secrets ?? []
  const drafts: { kind: BrandPromptKind; language: string; text: string }[] = []
  const seen = new Set<string>()
  for (const market of markets) {
    const language = market.language.toLowerCase()
    if (seen.has(language)) continue
    seen.add(language)
    const prompt = redactString(
      renderTemplate(template.body, {
        url: page.url ?? '',
        title: page.title ?? '',
        brand_name: brands.join(', '),
        competitors: versus?.name ?? 'none',
        product_block: productBlock(competitors.product),
        market_block: marketBlock(market),
        market: marketText(market),
        market_language: languageName(language),
        buyer_values:
          buyer === null || buyer.values.length === 0
            ? 'No buyer profile yet.'
            : buyer.values.map((value) => `- ${value}`).join('\n'),
        prompt_count: String(DEFAULT_BRAND_PROMPT_COUNT)
      }).text,
      { secrets, hexKeys: true }
    )
    const reply = await completeStructured({
      db: deps.db,
      pageId: page.id,
      provider: deps.claude,
      logger: deps.logger,
      kind: 'brand_prompts',
      templateId: template.id,
      templateHash: template.templateHash,
      prompt,
      schema: BRAND_PROMPTS_SCHEMA,
      model: null,
      inputHash: llmInputHash({
        templateHash: template.templateHash,
        prompt,
        schema: BRAND_PROMPTS_SCHEMA
      }),
      validate: (value) => {
        const problem = brandPromptsProblem(value, brands, versus)
        return problem === null ? null : { code: 'schema_validation', message: problem }
      },
      secrets,
      ...(deps.caps !== undefined ? { caps: deps.caps } : {})
    })
    const value = reply.value as { prompts: { kind: BrandPromptKind; text: string }[] }
    for (const item of value.prompts) {
      drafts.push({ kind: item.kind, language, text: item.text.replace(/\s+/g, ' ').trim() })
    }
  }
  insertBrandPromptSet(deps.db, {
    pageId: page.id,
    savedAt: deps.now(),
    templateId: template.id,
    templateHash: template.templateHash,
    prompts: drafts.map((draft) => ({ ...draft, id: deps.createId() }))
  })
  return brandPromptSetView(deps.db, page.id)
}

/**
 * The competitor the comparison prompt names: the page product's first direct
 * competitor, else its first partial one, else none.
 */
export function comparisonCompetitor(
  context: Pick<CompetitorContext, 'direct' | 'partial'>
): NamedCompetitor | null {
  return context.direct[0] ?? context.partial[0] ?? null
}

/**
 * Schema, plus every prompt names the brand, no two prompts are the same, and the
 * comparison prompt names the chosen competitor (by name or domain) when there is one.
 */
export function brandPromptsProblem(
  value: unknown,
  brands: readonly string[],
  versus: NamedCompetitor | null = null
): string | null {
  if (!promptsValid(value)) return 'The reply did not match the schema.'
  const prompts = (value as { prompts: { kind: BrandPromptKind; text: string }[] }).prompts
  const texts = new Set<string>()
  for (const prompt of prompts) {
    if (!namesBrand(prompt.text, brands))
      return `A brand prompt does not name ${brands[0] ?? 'the brand'}.`
    const key = prompt.text.trim().toLowerCase()
    if (texts.has(key)) return 'Two brand prompts are the same.'
    texts.add(key)
    if (prompt.kind === 'comparison' && versus !== null && !namesCompetitor(prompt.text, versus)) {
      return `The comparison prompt must name ${versus.name}.`
    }
  }
  return null
}

/** "Example Co vs Txt Impact" names TXTImpact; so does "txtimpact.com". */
function namesCompetitor(text: string, competitor: NamedCompetitor): boolean {
  const squashed = squashName(text)
  const names = [competitor.name, competitor.domain?.replace(/\.[a-z.]+$/u, '') ?? '']
  return names.some((name) => squashName(name).length > 0 && squashed.includes(squashName(name)))
}

function squashName(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function requirePage(
  db: SqliteDatabase,
  projectId: string,
  pageId: string
): { id: string; url: string | null; title: string | null } {
  const page = getPage(db, pageId, projectId)
  if (page === null) {
    throw new PipelineError('This page is not in the project.', {
      code: 'not_found',
      nextStep: 'Open the page from the sidebar and try again.'
    })
  }
  return page
}

function requireBrands(db: SqliteDatabase): string[] {
  const brands = (readProjectProfile(db)?.brandNames ?? []).filter((name) => name.trim().length > 0)
  if (brands.length === 0) {
    throw new PipelineError('Add your brand name to the project first.', {
      code: 'not_found',
      nextStep: 'Open Project settings and add the brand name.'
    })
  }
  return brands
}
