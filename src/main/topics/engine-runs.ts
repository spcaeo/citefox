import type { AnswerEngineId, EngineAnswerStatus, PromptCheckStatus } from '@shared/domain'
import type { TopicRunOutcomes } from '@shared/topic-results'
import type { ScoredReference, TopicOutcome } from '@shared/topic-scoring'
import { orderAt, type ReadableRun } from '../engine/checks/live-runs'
import { rollUpStatus } from '../engine/engines/views'
import type { SqliteDatabase } from '../storage/database'
import { listAnswerRunSamples, type AnswerRunSample } from '../storage/engine-reads'

/**
 * A topic's results on one answer engine (ChatGPT, Perplexity…), audit #4: each run's
 * stored answers as the same outcomes Google's checks give, so `assembleTopicResults`
 * scores them by the one rule: target page cited, out of the searches that got an answer.
 */

/**
 * An answer's status in the words a topic row is scored in. A cited answer's own sources
 * decide target page or another own page (`deriveRowState`); no answer reads as no AI
 * Overview; an engine that was down or failed is not checked.
 */
export function checkStatusOfAnswer(status: EngineAnswerStatus): PromptCheckStatus {
  switch (status) {
    case 'cited':
      return 'other_own_page'
    case 'named':
      return 'brand_mentioned'
    case 'not_cited':
      return 'not_cited'
    case 'no_answer':
      return 'no_aio'
    case 'unavailable':
    case 'error':
      return 'error'
  }
}

/** The sources of the samples that share the best status, each page once at its best spot. */
function referencesOf(samples: readonly AnswerRunSample[]): ScoredReference[] {
  const byUrl = new Map<string, ScoredReference>()
  for (const sample of samples) {
    for (const source of sample.sources) {
      const known = byUrl.get(source.normalizedUrl)
      if (known === undefined || source.position < known.position) {
        byUrl.set(source.normalizedUrl, source)
      }
    }
  }
  return [...byUrl.values()].sort((a, b) => a.position - b.position)
}

/** One question's samples in one run as one outcome: the best status wins, as Google's do. */
export function answerOutcome(
  samples: readonly AnswerRunSample[],
  runId: string
): TopicOutcome | null {
  const best = rollUpStatus(samples.map((sample) => sample.status))
  if (best === null) return null
  const status = checkStatusOfAnswer(best)
  const chosen = samples.filter((sample) => sample.status === best)
  const answered = status !== 'error' && status !== 'no_aio'
  return {
    status,
    references: answered ? referencesOf(chosen) : [],
    named: answered ? samples.some((sample) => sample.named) : null,
    runId,
    checkedAt: samples.reduce((at, sample) => (sample.checkedAt > at ? sample.checkedAt : at), ''),
    aioSummary: null
  }
}

/**
 * The topic's runs in one market on one answer engine, oldest first, with each
 * question's outcome by stable key. Runs that did not ask this engine are left out, so
 * Progress shows only the checks that have its answers.
 */
export function engineRunOutcomes(
  db: SqliteDatabase,
  input: { pageId: string; marketId: string; engine: AnswerEngineId },
  readable: readonly ReadableRun[],
  keys: ReadonlyMap<string, string>
): TopicRunOutcomes[] {
  const byRun = new Map<string, Map<string, AnswerRunSample[]>>()
  for (const sample of listAnswerRunSamples(db, input)) {
    const prompts = byRun.get(sample.runId) ?? new Map<string, AnswerRunSample[]>()
    prompts.set(sample.promptId, [...(prompts.get(sample.promptId) ?? []), sample])
    byRun.set(sample.runId, prompts)
  }
  const out: TopicRunOutcomes[] = []
  for (const { run, state } of readable) {
    if (state === 'finished' && run.finishedAt === null) continue
    const prompts = byRun.get(run.id)
    if (prompts === undefined) continue
    const outcomes = new Map<string, TopicOutcome>()
    for (const [promptId, samples] of prompts) {
      const key = keys.get(promptId)
      const outcome = answerOutcome(samples, run.id)
      if (key !== undefined && outcome !== null) outcomes.set(key, outcome)
    }
    if (outcomes.size === 0) continue
    out.push({
      runId: run.id,
      finishedAt: state === 'finished' ? (run.finishedAt ?? run.startedAt) : orderAt(run),
      partial: state !== 'finished' || run.partial,
      state,
      outcomes
    })
  }
  return out
}
