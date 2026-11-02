import type { SortProposal } from '@shared/ipc'
import { destinationKey, parseDestination } from '../grouping'
import type { MoveBatch } from '../hooks/useClusterActions'

/** Claude sorts at most this many questions in one call. */
export const SORT_MAX = 100

export interface SortChoice {
  ticked: boolean
  /** A destination key (`topic:<id>` or `new:<name>`), or '' when none fits. */
  value: string
}

/** Each proposal starts ticked with its topic, unless Claude found none. */
export function firstChoice(proposal: SortProposal): SortChoice {
  if (proposal.topicId !== null) return { ticked: true, value: `topic:${proposal.topicId}` }
  if (proposal.newTopic !== null && proposal.newTopic.trim() !== '') {
    return { ticked: true, value: `new:${proposal.newTopic.trim()}` }
  }
  return { ticked: false, value: '' }
}

/** Ticked proposals grouped by destination, one batch each. */
export function sortBatches(
  proposals: readonly SortProposal[],
  choices: readonly SortChoice[]
): MoveBatch[] {
  const byKey = new Map<string, MoveBatch>()
  proposals.forEach((proposal, index) => {
    const choice = choices[index]
    if (!choice?.ticked) return
    const to = parseDestination(choice.value)
    if (to === null) return
    const key = destinationKey(to)
    const batch = byKey.get(key) ?? { to, rows: [] }
    byKey.set(key, { to, rows: [...batch.rows, proposal] })
  })
  return [...byKey.values()]
}
