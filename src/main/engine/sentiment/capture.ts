import { SEARCHES_PER_PROMPT_MAX, type BrandPrompt } from '@shared/domain'
import { getLatestBrandPromptSet } from '../../storage/brand-records'
import type { SqliteDatabase } from '../../storage/database'
import { insertBrandCapture, listBrandCaptures } from '../../storage/sentiment-records'
import { CHECK_QUESTIONS_AT_ONCE, runPool } from '../checks/check-pace'
import type { ClassifyReferenceInput, ClassifiedReference } from '../checks/classify'
import type { CapGate, KeyRotation, RotatedCapture } from '../checks/key-rotation'
import type { MarketPlan } from '../checks/plan'
import { toSentimentReference } from './context'

/**
 * FR-16.1. Brand prompts are searched in every market of a full check, after
 * that market's buyer prompts, 1 sample each, in the market's language only.
 * They are stored in `brand_captures`, never in `serp_results`, so they cannot
 * enter any visibility count. Their searches count toward the job and the keys.
 */

/** The page's current brand prompts. A follow-up check (with prompt ids) searches none. */
export function brandPromptsForCheck(
  db: SqliteDatabase,
  pageId: string,
  promptIds: readonly string[] | null
): readonly BrandPrompt[] {
  if (promptIds !== null) return []
  return getLatestBrandPromptSet(db, pageId)?.prompts ?? []
}

/** The brand prompts one market searches: those written in its language. */
export function brandPromptsForMarket(
  prompts: readonly BrandPrompt[],
  market: Pick<MarketPlan, 'hl'>
): BrandPrompt[] {
  const language = market.hl.toLowerCase()
  return prompts.filter((prompt) => prompt.language === language)
}

/** Most searches the brand prompts can add to a check: 2 per prompt and market. */
export function brandSearchesMax(
  prompts: readonly BrandPrompt[],
  markets: readonly Pick<MarketPlan, 'hl'>[]
): number {
  return markets.reduce(
    (sum, market) => sum + brandPromptsForMarket(prompts, market).length * SEARCHES_PER_PROMPT_MAX,
    0
  )
}

export type BrandCaptureOutcome = 'done' | 'cancel' | 'cap' | 'keys'

export interface BrandCaptureInput {
  db: SqliteDatabase
  runId: string
  market: MarketPlan
  prompts: readonly BrandPrompt[]
  rotation: KeyRotation
  gate: CapGate
  createId: () => string
  now: () => string
  cancelled: () => boolean
  /** The classifier the buyer prompts use, so references get the same classes. */
  classify: (references: readonly ClassifyReferenceInput[]) => readonly ClassifiedReference[]
  /** Adds the searches of one capture to the job. */
  countSearches: (searches: number) => void
  /** Prices a capture (USD × 1,000,000). Omitted: 0. */
  costOf?: (keyId: string | null, searches: number, credits: number) => number
}

/**
 * Searches each brand prompt of this market once, a few at a time like the buyer
 * prompts (`CHECK_QUESTIONS_AT_ONCE`; the provider's shared limit still applies). A
 * capture already stored for the run (a resumed job) is not searched again. `cap`
 * means the project's cap stopped the brand prompts; the run still finishes, because
 * buyer prompts are done and brand prompts never change visibility. `keys` and
 * `cancel` stop the job. Once any of them happens, no new search starts.
 */
export async function captureBrandPrompts(input: BrandCaptureInput): Promise<BrandCaptureOutcome> {
  const done = new Set(listBrandCaptures(input.db, [input.runId]).map((row) => row.brandPromptId))
  const due = brandPromptsForMarket(input.prompts, input.market).filter(
    (prompt) => !done.has(prompt.id)
  )
  let outcome: BrandCaptureOutcome = 'done'
  let searched = 0
  await runPool(
    due,
    CHECK_QUESTIONS_AT_ONCE,
    () => outcome !== 'done' || input.cancelled(),
    async (prompt) => {
      searched += 1
      const captured = await input.rotation.capture(
        {
          q: prompt.text,
          gl: input.market.gl,
          hl: input.market.hl,
          location: input.market.location,
          device: input.market.device
        },
        input.gate
      )
      if (captured.exhausted) {
        if (outcome === 'done') outcome = 'keys'
        return
      }
      if (captured.halted) {
        // A started search still counts; an unfinished capture is not stored (FR-5.5).
        input.countSearches(captured.searches)
        if (outcome === 'done') {
          outcome = input.cancelled() || !input.gate.capHit() ? 'cancel' : 'cap'
        }
        return
      }
      store(input, prompt, captured)
      input.countSearches(captured.searches)
    }
  )
  if (outcome === 'done' && searched < due.length) return 'cancel'
  return outcome
}

function store(input: BrandCaptureInput, prompt: BrandPrompt, captured: RotatedCapture): void {
  const failed = captured.errorCode !== null
  const references = failed ? [] : input.classify(captured.references)
  const text = captured.aioText?.trim() ?? ''
  insertBrandCapture(input.db, {
    id: input.createId(),
    runId: input.runId,
    brandPromptId: prompt.id,
    promptText: prompt.text,
    keyId: captured.keyId,
    hasAio: captured.hasAio,
    neededFollowup: captured.neededFollowup,
    searches: captured.searches,
    status: failed ? 'error' : captured.hasAio && text.length > 0 ? 'aio' : 'no_aio',
    aioText: captured.aioText,
    references: references.map(toSentimentReference),
    errorCode: captured.errorCode,
    message: captured.message,
    rawSearchJson: captured.rawSearchJson,
    rawAioJson: captured.rawAioJson,
    capturedAt: input.now(),
    credits: captured.credits ?? 0,
    costMicros: input.costOf?.(captured.keyId, captured.searches, captured.credits ?? 0) ?? 0
  })
}
