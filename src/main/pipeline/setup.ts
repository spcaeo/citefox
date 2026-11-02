import type {
  BuyerProfile,
  BuyerPrompt,
  CoverageMatrix,
  GenerationTemplate,
  Market,
  JinaMode,
  PromptSetView
} from '@shared/domain'
import type { PageReadResult } from '@shared/ipc'
import { randomUUID } from 'node:crypto'
import { competitorContext } from '../engine/competitor-context'
import type { Logger } from '../logging/logger'
import type { ClaudeProvider } from '../providers/claude/claude-code'
import type { HttpTransport } from '../providers/http'
import type { SecretStore } from '../secrets/secret-store'
import {
  getLatestBuyerProfile,
  getLatestPromptSet,
  getPromptSetVersion,
  insertBuyerProfile,
  insertPromptSet,
  nextPromptSetVersion,
  type StoredSnapshot
} from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { setPageStatus } from '../storage/pages'
import { generateCoverage } from './coverage'
import { PipelineError } from './errors'
import type { AddressLookup } from './fetch-guard'
import { llmInputHash } from './hash'
import { completeStructured } from './llm'
import {
  marketsForPage,
  pageBlob,
  renderPagePrompt,
  requirePage,
  requireProfile,
  requireSnapshot
} from './page-context'
import { readPage, type JinaKeyRef, type JinaReadHooks, type ReadPageOptions } from './page-reader'
import { BUYER_PROFILE_SCHEMA, BUYER_PROMPTS_SCHEMA } from './schemas'
import { formatBuyerProfile } from './template-context'
import { modelFor } from './template-settings'
import { loadGenerationTemplate, templateHash } from './templates'
import {
  requiredPromptSources,
  unlistedCompanies,
  validateBuyerProfile,
  validateBuyerPrompts,
  type CanonicalPrompt,
  type PromptCompetitorLists,
  type PromptDraft
} from './validate'

/** Content gaps live in `coverage.ts`; these names keep their old import path. */
export { generateCoverage, redoCoveragePrompt } from './coverage'
/** Page values and quote text live in `page-context.ts` (also read by Try it). */
export { pageBlob, pageTemplateValues } from './page-context'

export interface PageSetupDeps {
  appDb: SqliteDatabase
  projectDb: SqliteDatabase
  transport: HttpTransport
  provider: ClaudeProvider
  logger: Logger
  secretStore: SecretStore
  jinaKeychainRef: string | null
  /** FR-11.5. Keys in rotation order; overrides `jinaKeychainRef` when set. */
  jinaKeys?: readonly JinaKeyRef[]
  jinaHooks?: JinaReadHooks
  jinaMode: JinaMode
  /** Direct-fetch SSRF check. Defaults to system DNS; tests pass a fake. */
  dns?: AddressLookup
  /** Project that owns `projectDb`. Stamped onto page summaries. Not stored on the page row. */
  projectId: string
  secrets?: readonly string[]
  now?: () => string
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
  delayMs?: number
  model?: string | null
}

export interface PageSetupResult {
  read: PageReadResult
  profile: BuyerProfile
  prompts: PromptSetView
  coverage: CoverageMatrix
}

/** Read the page, write the buyer profile, the prompt set, and the coverage matrix. No IPC. */
export async function runPageSetup(
  deps: PageSetupDeps,
  pageId: string,
  options?: { reuseStoredSnapshot?: boolean; force?: boolean }
): Promise<PageSetupResult> {
  const page = requirePage(deps.projectDb, pageId, deps.projectId)
  if (page.status === 'not_tracked')
    setPageStatus(deps.projectDb, pageId, 'setting_up', deps.projectId)
  const read = await readSetupPage(deps, pageId, options?.reuseStoredSnapshot ?? false)
  const profile = await generateBuyerProfile(deps, pageId, { force: options?.force ?? false })
  const prompts = await generateBuyerPrompts(deps, pageId, { rewrite: options?.force ?? false })
  const coverage = await generateCoverage(deps, pageId, { force: options?.force ?? false })
  return { read, profile, prompts, coverage }
}

/** The page read step with the app's reader rules (FR-2.1, FR-2.5). Throws when both readers fail. */
export function readSetupPage(
  deps: PageSetupDeps,
  pageId: string,
  reuseStoredSnapshot = false
): Promise<PageReadResult> {
  return readPage(readOptions(deps, pageId, reuseStoredSnapshot))
}

export async function generateBuyerProfile(
  deps: PageSetupDeps,
  pageId: string,
  options?: { force?: boolean; templateId?: string }
): Promise<BuyerProfile> {
  const template = loadGenerationTemplate(
    deps.appDb,
    'buyer_profile',
    options?.templateId,
    'buyerProfile:generate',
    deps.projectDb
  )
  const snapshot = requireSnapshot(deps.projectDb, pageId)
  const hash = templateHash(template.body)
  const current = getLatestBuyerProfile(deps.projectDb, pageId)
  if (
    current !== null &&
    !options?.force &&
    current.snapshotId === snapshot.id &&
    current.templateHash === hash
  ) {
    return current
  }
  const prompt = renderPagePrompt(deps, template, snapshot, pageId, '')
  const result = await completeStructured({
    db: deps.projectDb,
    pageId,
    provider: deps.provider,
    logger: deps.logger,
    kind: 'buyer_profile',
    templateId: template.id,
    templateHash: hash,
    prompt,
    schema: BUYER_PROFILE_SCHEMA,
    model: modelFor(template.settings, deps.model),
    inputHash: llmInputHash({ templateHash: hash, prompt, schema: BUYER_PROFILE_SCHEMA }),
    validate: (value) =>
      validateBuyerProfile(value, { brands: requireProfile(deps.projectDb).brandNames }),
    secrets: deps.secrets,
    now: deps.now,
    trace: { source: 'pipeline', projectId: deps.projectId },
    force: options?.force ?? false
  })
  const id = `icp-${randomUUID()}`
  const body = result.value as BuyerProfile
  insertBuyerProfile(deps.projectDb, {
    ...body,
    id,
    pageId,
    snapshotId: snapshot.id,
    templateId: template.id,
    templateName: template.name,
    templateHash: hash,
    templateUpdatedAt: template.updatedAt,
    createdAt: (deps.now ?? (() => new Date().toISOString()))(),
    promptsStale: false
  })
  const stored = getLatestBuyerProfile(deps.projectDb, pageId)
  if (stored === null || stored.id !== id) {
    throw new PipelineError('The buyer profile could not be saved.', {
      code: 'not_found',
      nextStep: 'Read the page again.'
    })
  }
  return stored
}

export async function generateBuyerPrompts(
  deps: PageSetupDeps,
  pageId: string,
  options?: { rewrite?: boolean; templateId?: string }
): Promise<PromptSetView> {
  const brands = requireProfile(deps.projectDb).brandNames
  const existing = getLatestPromptSet(deps.projectDb, pageId, brands)
  if (existing !== null && !options?.rewrite) return existing
  const snapshot = requireSnapshot(deps.projectDb, pageId, 'Read the page before writing prompts.')
  const profile = getLatestBuyerProfile(deps.projectDb, pageId)
  if (profile === null) {
    throw new PipelineError('Write the buyer profile before the prompts.', {
      code: 'not_found',
      nextStep: 'Generate the buyer profile, then write the prompts.'
    })
  }
  const page = requirePage(deps.projectDb, pageId, deps.projectId)
  const markets = marketsForPage(deps.projectDb, pageId, page.defaultMarketId)
  const primary = markets[0]
  if (primary === undefined) {
    throw new PipelineError('Add a market before writing prompts.', {
      code: 'not_found',
      nextStep: 'Add a market on the page, then write the prompts.'
    })
  }
  const template = loadGenerationTemplate(
    deps.appDb,
    'buyer_prompts',
    options?.templateId,
    'prompts:generate',
    deps.projectDb
  )
  const hash = templateHash(template.body)
  const primaryDrafts = await promptsForMarket(deps, {
    snapshot,
    pageId,
    market: primary,
    brands,
    count: template.settings.promptCount ?? page.promptCount,
    profile,
    canonical: null,
    canonicalLanguage: primary.language,
    templateId: template.id,
    templateHash: hash,
    template,
    force: options?.rewrite ?? false
  })
  const canonical = primaryDrafts
  const byMarket = new Map<string, PromptDraft[]>()
  byMarket.set(primary.id, primaryDrafts)
  for (const market of markets.slice(1)) {
    const variant = await promptsForMarket(deps, {
      snapshot,
      pageId,
      market,
      brands,
      count: template.settings.promptCount ?? page.promptCount,
      profile,
      canonical,
      canonicalLanguage: primary.language,
      templateId: template.id,
      templateHash: hash,
      template,
      force: options?.rewrite ?? false
    })
    byMarket.set(market.id, variant)
  }
  return insertPromptSet(
    deps.projectDb,
    {
      id: `pset-${randomUUID()}`,
      pageId,
      version: nextPromptSetVersion(deps.projectDb, pageId),
      savedAt: (deps.now ?? (() => new Date().toISOString()))(),
      icpId: profile.id,
      templateId: template.id,
      templateName: template.name,
      templateHash: hash,
      templateUpdatedAt: template.updatedAt,
      prompts: primaryDrafts.map((prompt, index) => ({
        id: `prompt-${randomUUID()}`,
        position: index + 1,
        label: prompt.label,
        source: prompt.source,
        intentStage: prompt.intentStage,
        mappedElement: prompt.mappedElement,
        enabled: true,
        variants: markets.map((market) => {
          const draft = byMarket.get(market.id)?.[index]
          if (draft === undefined) {
            throw new PipelineError('A market is missing a prompt.', {
              code: 'schema_validation',
              nextStep: 'Write the prompts again.'
            })
          }
          return {
            marketId: market.id,
            language: market.language,
            text: draft.text,
            originalText: null
          }
        })
      }))
    },
    brands
  )
}

/** Saving an edit creates the next version. The previous version stays as it was. */
export function savePromptEdits(
  db: SqliteDatabase,
  pageId: string,
  prompts: readonly BuyerPrompt[],
  options: { projectId: string; now?: () => string }
): PromptSetView {
  const profile = getLatestBuyerProfile(db, pageId)
  if (profile === null) {
    throw new PipelineError('Write the buyer profile before saving prompts.', {
      code: 'not_found',
      nextStep: 'Generate the buyer profile, then save the prompts.'
    })
  }
  const brands = requireProfile(db).brandNames
  const page = requirePage(db, pageId, options.projectId)
  const markets = marketsForPage(db, pageId, page.defaultMarketId)
  const problem = validateBuyerPrompts(
    {
      prompts: prompts.map((prompt) => ({
        text: prompt.variants[0]?.text ?? '',
        label: prompt.label,
        source: prompt.source,
        intentStage: prompt.intentStage,
        mappedElement: prompt.mappedElement
      }))
    },
    {
      count: prompts.length,
      brands,
      canonical: null,
      language: markets[0]?.language ?? 'en',
      canonicalLanguage: markets[0]?.language ?? 'en'
    }
  )
  if (problem !== null) {
    throw new PipelineError(problem.message, {
      code: problem.code,
      nextStep:
        problem.code === 'brand_in_prompt'
          ? 'Remove the brand name from the prompt and save again.'
          : 'Fix the prompt and save again.'
    })
  }
  for (const prompt of prompts) {
    for (const variant of prompt.variants) {
      const brand = brands.find((name) => variant.text.toLowerCase().includes(name.toLowerCase()))
      if (brand !== undefined) {
        throw new PipelineError(`A buyer prompt contains the brand name "${brand}".`, {
          code: 'brand_in_prompt',
          nextStep: 'Remove the brand name from the prompt and save again.'
        })
      }
    }
  }
  const previous = getLatestPromptSet(db, pageId, brands)
  return insertPromptSet(
    db,
    {
      id: `pset-${randomUUID()}`,
      pageId,
      version: nextPromptSetVersion(db, pageId),
      savedAt: (options?.now ?? (() => new Date().toISOString()))(),
      icpId: profile.id,
      templateId: previous?.templateId ?? null,
      templateName: previous?.templateName ?? null,
      templateHash: previous?.templateHash ?? null,
      templateUpdatedAt: previous?.templateUpdatedAt ?? null,
      prompts: prompts.map((prompt, index) => ({
        ...prompt,
        id: `prompt-${randomUUID()}`,
        position: index + 1
      }))
    },
    brands
  )
}

export function readPromptSetVersion(
  db: SqliteDatabase,
  pageId: string,
  version: number
): PromptSetView {
  const brands = requireProfile(db).brandNames
  const set = getPromptSetVersion(db, pageId, version, brands)
  if (set === null) {
    throw new PipelineError(`Question set version ${version} is not saved.`, {
      code: 'not_found',
      nextStep: 'Save the prompts, then open that version.'
    })
  }
  return set
}

async function promptsForMarket(
  deps: PageSetupDeps,
  input: {
    snapshot: StoredSnapshot
    pageId: string
    market: Market
    brands: readonly string[]
    count: number
    profile: BuyerProfile
    canonical: readonly CanonicalPrompt[] | null
    canonicalLanguage: string
    templateId: string
    templateHash: string
    template: GenerationTemplate
    force: boolean
  }
): Promise<PromptDraft[]> {
  const suffix = marketPromptSuffix(input.market, input.profile, input.canonical, input.count)
  const prompt = renderPagePrompt(deps, input.template, input.snapshot, input.pageId, suffix, {
    market: input.market
  })
  const lists = promptCompetitorLists(deps.projectDb, input.pageId)
  const result = await completeStructured({
    db: deps.projectDb,
    pageId: input.pageId,
    provider: deps.provider,
    logger: deps.logger,
    kind: 'buyer_prompts',
    templateId: input.templateId,
    templateHash: input.templateHash,
    prompt,
    schema: BUYER_PROMPTS_SCHEMA,
    model: modelFor(input.template.settings, deps.model),
    inputHash: llmInputHash({
      templateHash: input.templateHash,
      prompt,
      schema: BUYER_PROMPTS_SCHEMA
    }),
    validate: (value) =>
      validateBuyerPrompts(value, {
        count: input.count,
        brands: input.brands,
        canonical: input.canonical,
        language: input.template.settings.language ?? input.market.language,
        canonicalLanguage: input.template.settings.language ?? input.canonicalLanguage,
        lists
      }),
    secrets: deps.secrets,
    now: deps.now,
    trace: { source: 'pipeline', projectId: deps.projectId },
    force: input.force
  })
  const drafts = (result.value as { prompts: PromptDraft[] }).prompts
  warnUnlisted(deps, input.snapshot, drafts, lists)
  return drafts
}

/** The page's competitor lists, as the buyer-prompt checks read them (contract C1). */
export function promptCompetitorLists(db: SqliteDatabase, pageId: string): PromptCompetitorLists {
  const context = competitorContext(db, { pageId })
  return {
    competitors: [...context.direct, ...context.partial].flatMap((item) =>
      item.domain === null ? [item.name] : [item.name, item.domain]
    ),
    switchingFrom: context.switchingFrom,
    integrations: context.integrations
  }
}

/**
 * Logs product-like names a prompt uses that are on no list and not on the page, so
 * a reviewer can add a real competitor the project has not saved. Not a failure.
 */
function warnUnlisted(
  deps: PageSetupDeps,
  snapshot: StoredSnapshot,
  drafts: readonly PromptDraft[],
  lists: PromptCompetitorLists
): void {
  const known = [...lists.competitors, ...lists.switchingFrom, ...lists.integrations]
  const pageText = pageBlob(snapshot)
  const names = [
    ...new Set(drafts.flatMap((draft) => unlistedCompanies(draft.text, known, pageText)))
  ]
  if (names.length > 0) {
    deps.logger.warn('buyer prompts name companies not on the competitor list', { names })
  }
}

/**
 * Lines after the buyer prompts template for one market (also read by Try it). The
 * market, competitors, switch-from options and tools come in the template's blocks.
 */
export function marketPromptSuffix(
  market: Market,
  profile: BuyerProfile,
  canonical: readonly CanonicalPrompt[] | null,
  count?: number
): string {
  return [
    ...smallSetNote(count),
    `Market language: ${market.language}`,
    `Market country: ${market.country}`,
    `Market location: ${market.location ?? ''}`,
    `Local wording: ${market.localWording ? 'true' : 'false'}`,
    'Write the prompts in the market language. Do not copy another market word for word.',
    'When a trigger does not exist in this country, rewrite it.',
    `Buyer profile:\n${formatBuyerProfile(profile)}`,
    `Canonical prompts:\n${canonical === null ? '' : JSON.stringify(canonical)}`
  ].join('\n')
}

/**
 * The template asks for all three sources, which 1 or 2 prompts cannot meet; without this
 * line Claude writes three prompts and the set fails "exactly N prompts".
 */
function smallSetNote(count: number | undefined): string[] {
  if (count === undefined || count < 1) return []
  const sources = requiredPromptSources(count)
  if (sources.length >= 3) return []
  const prompts = count === 1 ? '1 prompt' : `${count} prompts`
  return [
    `This set has only ${prompts}, so it cannot use every source. Write exactly ${prompts}, using ${sources.join(' then ')}.`
  ]
}

function readOptions(deps: PageSetupDeps, pageId: string, reuseStored: boolean): ReadPageOptions {
  return {
    db: deps.projectDb,
    transport: deps.transport,
    logger: deps.logger,
    secretStore: deps.secretStore,
    jinaKeychainRef: deps.jinaKeychainRef,
    ...(deps.jinaKeys !== undefined ? { jinaKeys: deps.jinaKeys } : {}),
    ...(deps.jinaHooks !== undefined ? { jinaHooks: deps.jinaHooks } : {}),
    reader: 'auto',
    jinaMode: deps.jinaMode,
    ...(deps.dns !== undefined ? { dns: deps.dns } : {}),
    pageId,
    projectId: deps.projectId,
    reuseStored,
    now: deps.now,
    clock: deps.clock,
    sleep: deps.sleep,
    delayMs: deps.delayMs,
    secrets: deps.secrets
  }
}
