import type { ReactNode } from 'react'
import type { SentimentClaim, SentimentView } from '@shared/domain'

/** "Overviews from" picker in the mock-up. Trend lines always use every source. */
export type SourceFilter = 'all' | 'brand' | 'buyer'

/**
 * FR-16.9 hook points. The AI-assist engineer fills these slots; by default
 * nothing renders, so no button is shown that does nothing. Each slot gets
 * the data it needs and returns its own button and in-place result (FR-25.2).
 */
export interface SentimentAssists {
  /** "Summarize what Google says about us", above the KPI row. */
  summary?: (view: SentimentView) => ReactNode
  /** "Suggest facts from my site", inside the Brand facts card. */
  suggestFacts?: (view: SentimentView) => ReactNode
  /** "Draft replies to negative sources", beside the negative sources table. */
  draftReplies?: (view: SentimentView, negative: readonly SentimentClaim[]) => ReactNode
}

/** Result of a mutating action. `message` is shown in place. */
export type ActionResult = { ok: true; message: string | null } | { ok: false; message: string }
