import {
  unitsCostMicros,
  type AnswerEngineId,
  type EngineAnswerStatus,
  type PromptCheckStatus
} from '@shared/domain'
import type { SqliteDatabase } from '../../storage/database'
import { insertEngineAnswer } from '../../storage/engine-records'
import type { CaptureQuery } from './capture'
import type { ClassifiedSample, ClassifyReferenceInput } from './classify'
import type { AnswerCapture } from './cloro-capture'
import type { KeyPricing } from './engines-plan'
import type { EngineRotation, ProviderGate } from './key-rotation'

/**
 * The cited/named rule for an answer engine, from the same classifier as Google: our
 * domain among the sources is `cited`; our brand in the text with no source of ours is
 * `named`. No answer is a normal result, not an error.
 */
export function answerStatus(
  capture: Pick<AnswerCapture, 'outcome'>,
  classified: Pick<ClassifiedSample, 'status'>
): EngineAnswerStatus {
  if (capture.outcome === 'unavailable') return 'unavailable'
  if (capture.outcome === 'error') return 'error'
  if (capture.outcome === 'no_answer') {
    // A short reply can still cite us; only an answer with nothing of ours is "no answer".
    return classified.status === 'page_cited' || classified.status === 'other_own_page'
      ? 'cited'
      : 'no_answer'
  }
  return engineStatusOfSample(classified.status)
}

/** A Google AI Overview sample's status in the engine words every engine shares. */
export function engineStatusOfSample(status: PromptCheckStatus): EngineAnswerStatus {
  if (status === 'page_cited' || status === 'other_own_page') return 'cited'
  if (status === 'brand_mentioned') return 'named'
  if (status === 'no_aio') return 'no_answer'
  if (status === 'error') return 'error'
  return 'not_cited'
}

export interface AnswerStepInput {
  db: SqliteDatabase
  runId: string
  promptId: string
  sampleNo: number
  query: CaptureQuery
  engines: readonly AnswerEngineId[]
  /** `engine` keys already stored for this run, question and sample (a resume skips them). */
  stored: ReadonlySet<AnswerEngineId>
  rotation: EngineRotation
  gate: ProviderGate
  pricing: KeyPricing
  createId: () => string
  now: () => string
  /** The page's classifier (own domain, brand names, competitors, tracked pages). */
  classify: (
    failed: boolean,
    text: string | null,
    refs: readonly ClassifyReferenceInput[]
  ) => ClassifiedSample
  cancelled: () => boolean
  /** Each engine's answer as soon as it is stored, for the Check window's ticks. */
  onLanded?: (engine: AnswerEngineId, status: EngineAnswerStatus) => void
}

export interface AnswerStepResult {
  searches: number
  credits: number
  costMicros: number
  /** A call failed (not "unavailable", not "no answer"). */
  sawError: boolean
  /** Why the step stopped before every engine ran. Null when it finished. */
  stop: 'halted' | 'no_keys' | null
  /** Engines answered this step, in order, for progress lines. */
  results: readonly { engine: AnswerEngineId; status: EngineAnswerStatus; message: string | null }[]
}

/**
 * One question × market × sample on every selected answer engine, all at once (the
 * rotation's limiter keeps the provider's calls in bounds), each stored as soon as it is
 * back. An engine that is down at cloro is stored as `unavailable` (not charged) and never
 * stops the others. Results come back in engine order, however the calls finish.
 */
export async function runAnswerEngines(input: AnswerStepInput): Promise<AnswerStepResult> {
  const result = {
    searches: 0,
    credits: 0,
    costMicros: 0,
    sawError: false,
    stop: null as AnswerStepResult['stop'],
    results: [] as { engine: AnswerEngineId; status: EngineAnswerStatus; message: string | null }[]
  }
  let halted = false
  let noKeys = false
  const outcomes = await Promise.all(
    input.engines.map(async (engine) => {
      if (input.stored.has(engine)) return null
      if (input.cancelled() || input.gate.stopRequested()) {
        halted = true
        return null
      }
      const captured = await input.rotation.answer(engine, input.query, input.gate)
      if (captured.exhausted) {
        noKeys = true
        return null
      }
      if (captured.halted) {
        // A stop between retries: the attempts count, but an unfinished call stores nothing.
        result.searches += captured.searches
        halted = true
        return null
      }
      const stored = storeAnswer(input, engine, captured, result)
      input.onLanded?.(engine, stored.status)
      return stored
    })
  )
  // A cancel or the cap outranks "no cloro key": the job must stop.
  result.stop = halted ? 'halted' : noKeys ? 'no_keys' : null
  for (const outcome of outcomes) if (outcome !== null) result.results.push(outcome)
  return result
}

function storeAnswer(
  input: AnswerStepInput,
  engine: AnswerEngineId,
  captured: Awaited<ReturnType<EngineRotation['answer']>>,
  result: { searches: number; credits: number; costMicros: number; sawError: boolean }
): { engine: AnswerEngineId; status: EngineAnswerStatus; message: string | null } {
  const failed = captured.outcome === 'error' || captured.outcome === 'unavailable'
  const classified = input.classify(
    failed,
    captured.outcome === 'answer' || captured.outcome === 'no_answer' ? captured.text : null,
    captured.sources.map((source) => ({ url: source.url, title: source.title }))
  )
  const status = answerStatus(captured, classified)
  const credits = status === 'unavailable' ? 0 : captured.credits
  const costMicros = unitsCostMicros(credits, input.pricing.planFor(captured.keyId, 'cloro'))
  const byUrl = new Map(classified.references.map((reference) => [reference.url, reference]))
  insertEngineAnswer(input.db, {
    id: input.createId(),
    runId: input.runId,
    promptId: input.promptId,
    sampleNo: input.sampleNo,
    engine,
    keyId: captured.keyId,
    status,
    citedUrl: status === 'cited' ? classified.citedUrl : null,
    position: status === 'cited' ? classified.position : null,
    named: classified.named === true,
    answerText: captured.text,
    answerMarkdown: captured.markdown,
    errorCode: captured.errorCode,
    message: captured.message,
    searches: captured.searches,
    credits,
    costMicros,
    rawJson: captured.rawJson,
    checkedAt: input.now(),
    sources: captured.sources.flatMap((source) => {
      const reference = byUrl.get(source.url)
      return reference === undefined
        ? []
        : [
            {
              id: input.createId(),
              position: source.position,
              url: source.url,
              normalizedUrl: reference.normalizedUrl,
              domain: reference.domain,
              title: source.title,
              classification: reference.classification
            }
          ]
    })
  })
  result.searches += captured.searches
  result.credits += credits
  result.costMicros += costMicros
  if (status === 'error') result.sawError = true
  return { engine, status, message: captured.message }
}
