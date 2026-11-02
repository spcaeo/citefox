import { SEARCHES_PER_PROMPT_MAX, SEARCHES_PER_PROMPT_MIN } from '@shared/domain'
import { QueueError } from './errors'

/**
 * SERP-2 and FR-1.6. One prompt, in one market, at one sample, costs 1 or 2 searches.
 * Brand prompts are not added here. The caller includes them in `prompts` when
 * the check will run them (FR-16.1).
 */
export function estimateCheckSearches(input: {
  prompts: number
  markets: number
  samples: number
}): { minSearches: number; maxSearches: number } {
  const prompts = count(input.prompts, 'prompts')
  const markets = count(input.markets, 'markets')
  const samples = count(input.samples, 'samples')
  const units = prompts * markets * samples
  return {
    minSearches: units * SEARCHES_PER_PROMPT_MIN,
    maxSearches: units * SEARCHES_PER_PROMPT_MAX
  }
}

function count(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new QueueError(`${label} must be a non-negative integer`)
  }
  return value
}
