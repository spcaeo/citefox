import type { BuyerPrompt, CheckPhase, CheckStepState } from '@shared/domain'
import type { CheckJob, CheckStepSnapshot } from '@shared/ipc'

export interface RunningTableRow {
  promptId: string
  promptPosition: number
  text: string
  search: CheckStepSnapshot | null
  aio: CheckStepSnapshot | null
  analysis: CheckStepSnapshot | null
}

/** One enabled buyer prompt, in this market's wording, before a step exists. */
export interface QueuedPrompt {
  id: string
  position: number
  text: string
}

const PHASES: readonly CheckPhase[] = ['search', 'aio', 'analysis']

/**
 * Enabled prompts from `prompts:list`, limited to `promptIds` when the run is partial.
 * A prompt with no step yet is still queued. The check job does not list those rows.
 */
export function queuedPrompts(
  prompts: readonly BuyerPrompt[],
  marketId: string,
  language: string,
  promptIds: readonly string[] | null
): QueuedPrompt[] {
  const selected = promptIds === null ? null : new Set(promptIds)
  return prompts
    .filter((prompt) => prompt.enabled && (selected === null || selected.has(prompt.id)))
    .map((prompt) => ({
      id: prompt.id,
      position: prompt.position,
      text: promptWording(prompt, marketId, language)
    }))
    .sort((left, right) => left.position - right.position)
}

function promptWording(prompt: BuyerPrompt, marketId: string, language: string): string {
  const variant =
    prompt.variants.find((item) => item.marketId === marketId) ??
    prompt.variants.find((item) => item.language === language) ??
    prompt.variants[0]
  const text = variant?.text.trim() ?? ''
  return text.length > 0 ? text : prompt.label
}

export function runningRows(
  job: CheckJob,
  marketId: string,
  queued: readonly QueuedPrompt[] = []
): RunningTableRow[] {
  const grouped = new Map<string, RunningTableRow>()
  for (const step of job.steps) {
    if (step.marketId !== marketId || !PHASES.includes(step.phase)) continue
    const current = grouped.get(step.promptId) ?? {
      promptId: step.promptId,
      promptPosition: step.promptPosition,
      text: step.promptText || step.label,
      search: null,
      aio: null,
      analysis: null
    }
    if (step.promptText) current.text = step.promptText
    current.promptPosition = step.promptPosition
    if (step.phase === 'search') current.search = step
    if (step.phase === 'aio') current.aio = step
    if (step.phase === 'analysis') current.analysis = step
    grouped.set(step.promptId, current)
  }
  const fromSteps = [...grouped.values()]
  if (queued.length === 0) {
    return fromSteps.sort((left, right) => left.promptPosition - right.promptPosition)
  }
  const known = new Map(fromSteps.map((row) => [row.promptId, row]))
  const merged = queued.map((prompt) => {
    const step = known.get(prompt.id)
    if (!step) {
      return {
        promptId: prompt.id,
        promptPosition: prompt.position,
        text: prompt.text,
        search: null,
        aio: null,
        analysis: null
      }
    }
    return {
      ...step,
      promptPosition: prompt.position,
      text: step.text || prompt.text
    }
  })
  for (const row of fromSteps) {
    if (!merged.some((item) => item.promptId === row.promptId)) merged.push(row)
  }
  return merged.sort((left, right) => left.promptPosition - right.promptPosition)
}

export function stepBusy(state: CheckStepState | undefined): boolean {
  return state === 'running'
}

export function stepSettled(state: CheckStepState | undefined): boolean {
  return state === 'ok' || state === 'warning'
}

/** The shown job with `latest`'s search and month totals, or `latest` when none is shown. */
export function withTotals(shown: CheckJob | null | undefined, latest: CheckJob): CheckJob {
  if (!shown || shown.id !== latest.id) return latest
  return {
    ...shown,
    searchesUsed: latest.searchesUsed,
    searchesMax: latest.searchesMax,
    brandSearchesMax: latest.brandSearchesMax,
    monthUsed: latest.monthUsed,
    monthLimit: latest.monthLimit
  }
}
