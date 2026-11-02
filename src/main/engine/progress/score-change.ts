/**
 * The "Change" of a check (FR-7.3, section 7.3): its score minus the score of
 * the previous full check of the same prompt set, in one page and market.
 * Shared by the page History tab (`history:list`) and Check history
 * (`history:listProject`), so both screens print the same number.
 */

export interface ScoredRun {
  id: string
  promptSetId: string
  /** A follow-up that asked only some questions: no change, and never a "previous". */
  partial: boolean
  score: number | null
}

/**
 * Finished runs of one page in one market, oldest first (`started_at`, then
 * insertion order). Null for a partial run, the first full run of a prompt set,
 * or when either score is missing.
 */
export function scoreChanges(runs: readonly ScoredRun[]): Map<string, number | null> {
  const lastFullScore = new Map<string, number | null>()
  const changes = new Map<string, number | null>()
  for (const run of runs) {
    const previous = lastFullScore.get(run.promptSetId)
    changes.set(
      run.id,
      run.partial || previous === undefined || previous === null || run.score === null
        ? null
        : run.score - previous
    )
    if (!run.partial) lastFullScore.set(run.promptSetId, run.score)
  }
  return changes
}

/** Section 7.2: points of the questions with an AI Overview over the most they could earn. */
export function visibilityScore(points: number, pointsPossible: number): number | null {
  return pointsPossible === 0 ? null : Math.round((points / pointsPossible) * 100)
}
