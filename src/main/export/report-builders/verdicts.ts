import { fixVerdictLabel, type FixMarketOutcome } from '@shared/domain'
import { verdictFor } from '../../engine/progress/verdict'
import type { FixFollowUpRecord } from '../../storage/fix-follow-ups'
import type { FixVerdictKind, FixVerdictModel, ReportBuildContext } from '../model/types'

/** A logged fix with its per-market outcomes, as the Progress tab reads them (FR-14.7). */
export interface FixWithOutcomes {
  fix: Pick<FixFollowUpRecord, 'pageId' | 'number' | 'description' | 'goLiveAt'>
  markets: readonly FixMarketOutcome[]
}

/**
 * REPORT-SPEC section 6 fix verdicts from the Progress fix outcomes, so the report and
 * the Progress tab agree. Markets outside the report are left out. `prompts` drills to
 * the report rows of the targeted prompts that worked. Never claims causation.
 */
export function fixVerdictModels(
  fixes: readonly FixWithOutcomes[],
  context: ReportBuildContext
): FixVerdictModel[] {
  const tracked = new Set(
    context.pages.filter((page) => page.role === 'tracked').map((page) => page.id)
  )
  const markets = new Set(context.markets.map((market) => market.id))
  const rowId = new Map(
    context.rows.map((row) => [`${row.pageId}|${row.marketId}|${row.promptId}`, row.id])
  )
  return fixes
    .filter((item) => tracked.has(item.fix.pageId))
    .map(({ fix, markets: outcomes }) => {
      const inScope = outcomes.filter((outcome) => markets.has(outcome.marketId))
      const results = inScope.flatMap((outcome) => outcome.prompts.map((prompt) => prompt.result))
      const count = verdictFor(
        results,
        inScope.some((outcome) => outcome.afterRunId !== null)
      )
      const worked = inScope.flatMap((outcome) =>
        outcome.prompts
          .filter((prompt) => prompt.result === 'worked')
          .flatMap((prompt) => {
            const id = rowId.get(`${fix.pageId}|${outcome.marketId}|${prompt.promptId}`)
            return id === undefined ? [] : [id]
          })
      )
      return {
        number: fix.number,
        pageId: fix.pageId,
        description: fix.description,
        goLiveAt: fix.goLiveAt,
        verdict: kindOf(count.verdict),
        label: fixVerdictLabel(count.verdict, count.worked, count.compared),
        prompts: context.count(`fix:${fix.pageId}#${fix.number}`, worked)
      }
    })
    .sort((left, right) => left.goLiveAt.localeCompare(right.goLiveAt))
}

function kindOf(verdict: ReturnType<typeof verdictFor>['verdict']): FixVerdictKind {
  if (verdict === 'waiting') return 'pending'
  if (verdict === 'got_worse') return 'no_change'
  return verdict
}
