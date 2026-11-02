import type { JSX } from 'react'
import type { LoggedFix } from '@shared/domain'

/**
 * FR-14.9 hook points. The generic AI-assist machinery (another engineer) renders
 * these buttons; Progress only says where they go and what they get. Each one
 * defaults to nothing, so no Claude call happens from this feature.
 */
export interface ProgressAssists {
  /** "Check if Fix N worked in other markets": from saved checks, no new searches. */
  otherMarkets?: (context: { fix: LoggedFix }) => JSX.Element | null
  /** "Suggest next fix": reads the gap analysis and the latest check. */
  suggestNextFix?: (context: SuggestNextFixContext) => JSX.Element | null
}

export interface SuggestNextFixContext {
  fixes: readonly LoggedFix[]
  /** Opens the fix drawer prefilled, the same as "Plan as Fix N" on Results. */
  planFix: (draft: { description: string; promptIds: readonly string[] }) => void
}
