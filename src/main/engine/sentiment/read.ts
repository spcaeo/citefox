import type { Logger } from '../../logging/logger'
import { redactString } from '../../logging/redact'
import { llmInputHash, sha256 } from '../../pipeline/hash'
import { completeStructured, type GenerationCallCaps } from '../../pipeline/llm'
import {
  SENTIMENT_CLAIMS_V2_SCHEMA,
  SENTIMENT_FACT_CHECK_SCHEMA
} from '../../pipeline/sentiment-templates'
import { loadGenerationTemplate, renderTemplate } from '../../pipeline/templates'
import { fence } from '../../prompts/blocks'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import { listBrandFacts } from '../../storage/brand-records'
import { listStoredCheckRuns } from '../../storage/check-records'
import { getStoredSnapshot } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { getPage } from '../../storage/pages'
import { getMarket, readProjectProfile } from '../../storage/project-profile'
import {
  listSentimentReads,
  replaceSentimentRead,
  type NewSentimentClaim,
  type NewSentimentRead
} from '../../storage/sentiment-records'
import { createLimiter, type Limiter } from '../checks/check-pace'
import { filterFor } from '../checks/results'
import { settleEach } from '../parallel'
import {
  aioHash,
  applyFactChecks,
  brandKeys,
  claimsSchemaError,
  factCheckSchemaError,
  ownClaims,
  processReply,
  type ClaimsReply,
  type FactCheckReply
} from './claims'
import {
  claimsText,
  factsText,
  languageName,
  marketText,
  pageCompetitors,
  referencesText
} from './context'
import { ownExcerpts, ownPagesFor, type ExcerptPage } from './excerpts'
import { runOverviews, type RunOverview } from './overviews'

export interface SentimentReadDeps {
  /** The project database. */
  db: SqliteDatabase
  /** app.sqlite, where the sentiment templates live. */
  appDb: SqliteDatabase
  claude: ClaudeProvider
  logger: Logger
  secrets?: readonly string[]
  caps?: GenerationCallCaps
  now: () => string
  createId: () => string
  /** Checked before each Claude call. True stops the reading; what is read stays. */
  shouldStop?: () => boolean
  /**
   * Overviews are read through this limiter, side by side up to its size (the report
   * runner shares one per job). Omitted: one at a time.
   */
  limiter?: Limiter
}

export interface ReadRunResult {
  /** Overviews with text in the run. */
  overviews: number
  /** Overviews read with at least one new Claude call. */
  read: number
  /** Overviews whose stored reading or cached output was reused at no cost. */
  reused: number
  failed: number
  stopped: boolean
  /** New `sentiment_fact_check` calls: one per overview with a claim about the brand. */
  factChecks: number
}

const EMPTY: ReadRunResult = {
  overviews: 0,
  read: 0,
  reused: 0,
  failed: 0,
  stopped: false,
  factChecks: 0
}

type ReadBase = Omit<NewSentimentRead, 'ok' | 'error' | 'brandsNamed' | 'reason' | 'generationId'>

/** What every overview of one run shares. */
interface RunContext {
  pageId: string
  keys: ReturnType<typeof brandKeys>
  claimsTemplate: ReturnType<typeof loadGenerationTemplate>
  checkTemplate: ReturnType<typeof loadGenerationTemplate>
  shared: Record<string, string>
  facts: ReturnType<typeof listBrandFacts>
  factsBlock: string
  ownPages: ExcerptPage[]
  secrets: readonly string[]
}

/**
 * FR-16.2 and FR-16.8. Claude reads each overview of a finished full run in two
 * single-purpose steps (Docs/PROMPT-AUDIT.md, P6 4): `sentiment_claims_v2` pulls
 * the claims and how the overview places the brand, then `sentiment_fact_check`
 * checks the claims about the brand, only when there are some, against the brand
 * facts and the passages of the own pages that speak to them. Runs after the
 * check's searches (report runner) or on "Re-read saved overviews", never on the
 * search path. An overview whose inputs (text, sources, brands, competitors,
 * facts, own pages, templates) are unchanged keeps its stored reading (NFR-7).
 * Partial runs are not read: they never enter trends.
 */
export async function readRunSentiment(
  deps: SentimentReadDeps,
  input: { projectId: string; runId: string }
): Promise<ReadRunResult> {
  const run = listStoredCheckRuns(
    deps.db,
    filterFor(input.projectId, null, null, input.runId)
  ).find((item) => item.id === input.runId)
  if (run === undefined || run.status !== 'finished' || run.partial) return EMPTY
  const profile = readProjectProfile(deps.db)
  const page = getPage(deps.db, run.pageId, input.projectId)
  if (page === null) return EMPTY
  // Same product, different competitors: read against the page's product's list.
  const competitors = pageCompetitors(deps.db, page.id, profile?.competitors ?? [])
  const keys = brandKeys(profile?.brandNames ?? [], competitors.keys, competitors.aliases)
  if (keys.own === null && keys.competitors.length === 0) return EMPTY
  // FR-26.8: the project's own version of each step, else the app default.
  const load = (
    kind: 'sentiment_claims_v2' | 'sentiment_fact_check'
  ): ReturnType<typeof loadGenerationTemplate> =>
    loadGenerationTemplate(deps.appDb, kind, undefined, 'templates:get', deps.db)
  const market = getMarket(deps.db, run.marketId)
  const facts = listBrandFacts(deps.db)
  const context: RunContext = {
    pageId: run.pageId,
    keys,
    claimsTemplate: load('sentiment_claims_v2'),
    checkTemplate: load('sentiment_fact_check'),
    shared: {
      url: page.url ?? '',
      title: page.title ?? '',
      brand_name: keys.aliases.join(', ') || 'none',
      competitors: keys.competitors.join(', ') || 'none',
      competitor_block: competitors.block,
      market: marketText(market),
      market_language: languageName(market?.language ?? 'en')
    },
    facts,
    factsBlock: factsText(facts),
    ownPages: ownPagesFor(
      deps.db,
      input.projectId,
      { id: page.id, url: page.url ?? '' },
      getStoredSnapshot(deps.db, run.snapshotId)
    ),
    secrets: deps.secrets ?? []
  }
  // A new brand fact, an edited own page or a new fact-check template re-checks the
  // claims; the claims call itself is then served from its cache.
  const checkInputs = sha256(
    JSON.stringify({
      template: context.checkTemplate.templateHash,
      facts: context.factsBlock,
      pages: context.ownPages.map((item) => [item.url, sha256(item.text)])
    })
  )
  const stored = new Map(
    listSentimentReads(deps.db, [run.id]).map((read) => [read.captureId, read] as const)
  )
  const result = { ...EMPTY }
  const overviews = runOverviews(deps.db, input.projectId, run).filter(
    (overview) => overview.aioText !== null
  )
  result.overviews = overviews.length
  // Each overview is its own reading (claims, then its fact check); they run side by side.
  await settleEach(overviews, deps.limiter ?? createLimiter(1), async (overview) => {
    if (result.stopped || deps.shouldStop?.() === true) {
      result.stopped = true
      return
    }
    await readOneOverview(deps, context, run, overview, checkInputs, stored, result)
  })
  return result
}

/** One overview's reading, stored (or reused) and counted in `result`. */
async function readOneOverview(
  deps: SentimentReadDeps,
  context: RunContext,
  run: { id: string; marketId: string },
  overview: RunOverview,
  checkInputs: string,
  stored: ReadonlyMap<string, { ok: boolean; inputHash: string }>,
  result: ReadRunResult
): Promise<void> {
  const aioText = overview.aioText ?? ''
  const claimsPrompt = redact(
    renderTemplate(context.claimsTemplate.body, {
      ...context.shared,
      prompt: overview.promptText,
      aio_text: fence('overview', aioText),
      aio_references: referencesText(overview.references)
    }).text,
    context.secrets
  )
  const claimsHash = llmInputHash({
    templateHash: context.claimsTemplate.templateHash,
    prompt: claimsPrompt,
    schema: SENTIMENT_CLAIMS_V2_SCHEMA
  })
  const inputHash = sha256(`${claimsHash}\n${checkInputs}`)
  const previous = stored.get(overview.captureId)
  if (previous?.ok === true && previous.inputHash === inputHash) {
    result.reused += 1
    return
  }
  const base: ReadBase = {
    id: deps.createId(),
    runId: run.id,
    marketId: run.marketId,
    source: overview.source,
    captureId: overview.captureId,
    promptId: overview.promptId,
    aioHash: aioHash(aioText, overview.references),
    inputHash,
    templateId: context.claimsTemplate.id,
    templateHash: context.claimsTemplate.templateHash,
    readAt: deps.now()
  }
  try {
    const read = await readOverview(deps, context, overview, claimsPrompt, claimsHash)
    if (read === 'stopped') {
      result.stopped = true
      return
    }
    if (read.dropped > 0) deps.logger.info('sentiment claims dropped', { count: read.dropped })
    replaceSentimentRead(
      deps.db,
      {
        ...base,
        ok: true,
        error: null,
        brandsNamed: read.brandsNamed,
        reason: read.reason,
        generationId: read.generationId
      },
      read.claims.map((claim) => ({ ...claim, id: deps.createId() }))
    )
    if (read.calls === 0) result.reused += 1
    else result.read += 1
    if (read.factChecked) result.factChecks += 1
  } catch (error) {
    result.failed += 1
    const message = redact(
      error instanceof Error ? error.message : 'CiteFox AI could not read this overview.',
      context.secrets
    )
    deps.logger.error('sentiment read failed', { message })
    // A failed re-read keeps the earlier good reading and its claims.
    if (previous?.ok === true) return
    replaceSentimentRead(
      deps.db,
      { ...base, ok: false, error: message, brandsNamed: [], reason: null, generationId: null },
      []
    )
  }
}

interface OverviewRead {
  brandsNamed: string[]
  reason: string | null
  claims: Omit<NewSentimentClaim, 'id'>[]
  dropped: number
  generationId: string | null
  /** New Claude calls made (cache hits are free). */
  calls: number
  factChecked: boolean
}

/** Step 1, the claims; step 2, the fact check, only for claims about the brand. */
async function readOverview(
  deps: SentimentReadDeps,
  context: RunContext,
  overview: RunOverview,
  claimsPrompt: string,
  claimsHash: string
): Promise<OverviewRead | 'stopped'> {
  const reply = await completeStructured({
    db: deps.db,
    pageId: context.pageId,
    provider: deps.claude,
    logger: deps.logger,
    kind: 'sentiment_claims_v2',
    templateId: context.claimsTemplate.id,
    templateHash: context.claimsTemplate.templateHash,
    prompt: claimsPrompt,
    schema: SENTIMENT_CLAIMS_V2_SCHEMA,
    model: null,
    inputHash: claimsHash,
    validate: (value) => {
      const problem = claimsSchemaError(value)
      return problem === null ? null : { code: 'schema_validation', message: problem }
    },
    secrets: context.secrets,
    ...(deps.caps !== undefined ? { caps: deps.caps } : {})
  })
  const processed = processReply(reply.value as ClaimsReply, {
    keys: context.keys,
    aioText: overview.aioText ?? '',
    references: overview.references
  })
  const read: OverviewRead = {
    brandsNamed: processed.brandsNamed,
    reason: processed.reason,
    claims: processed.claims,
    dropped: processed.dropped,
    generationId: reply.generationId,
    calls: reply.fromCache ? 0 : 1,
    factChecked: false
  }
  const own = ownClaims(processed.claims)
  if (own.length === 0) return read
  const excerpts = ownExcerpts(context.ownPages, own, context.keys.aliases)
  // Nothing to check against: no brand facts and no own page speaks to the claims.
  if (context.facts.length === 0 && excerpts.passages === 0) return read
  if (deps.shouldStop?.() === true) return 'stopped'
  const prompt = redact(
    renderTemplate(context.checkTemplate.body, {
      brand_name: context.shared.brand_name ?? '',
      market_language: context.shared.market_language ?? '',
      claims: claimsText(own),
      brand_facts: context.factsBlock,
      own_pages: excerpts.text
    }).text,
    context.secrets
  )
  const check = await completeStructured({
    db: deps.db,
    pageId: context.pageId,
    provider: deps.claude,
    logger: deps.logger,
    kind: 'sentiment_fact_check',
    templateId: context.checkTemplate.id,
    templateHash: context.checkTemplate.templateHash,
    prompt,
    schema: SENTIMENT_FACT_CHECK_SCHEMA,
    model: null,
    inputHash: llmInputHash({
      templateHash: context.checkTemplate.templateHash,
      prompt,
      schema: SENTIMENT_FACT_CHECK_SCHEMA
    }),
    validate: (value) => {
      const problem = factCheckSchemaError(value, own.length)
      return problem === null ? null : { code: 'schema_validation', message: problem }
    },
    secrets: context.secrets,
    ...(deps.caps !== undefined ? { caps: deps.caps } : {})
  })
  return {
    ...read,
    claims: applyFactChecks(processed.claims, check.value as FactCheckReply, {
      facts: context.facts,
      references: overview.references,
      ownUrls: excerpts.urls
    }),
    calls: read.calls + (check.fromCache ? 0 : 1),
    factChecked: !check.fromCache
  }
}

function redact(text: string, secrets: readonly string[]): string {
  return redactString(text, { secrets, hexKeys: true })
}
