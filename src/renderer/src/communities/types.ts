import type { JSX } from 'react'
import type { CommunitiesReport } from '@shared/domain'

/** The four lists under "Cited community sources". */
export type SourceTab = 'reddit' | 'youtube' | 'linkedin' | 'forums'

/** Sections an AI-assist slot can attach to (FR-17.6 is another engineer's). */
export type AssistSection = 'mix' | 'reddit' | 'youtube' | 'linkedin' | 'forums' | 'opportunities'

export interface AssistContext {
  section: AssistSection
  report: CommunitiesReport
  /** The page the assist is about. Null on the project screen with every page in scope. */
  pageId: string | null
}

/** Optional AI-assist hook point. Renders nothing by default; never posts anything (FR-17.7). */
export type AssistSlot = (context: AssistContext) => JSX.Element | null

/** "page" follows the page header's market; "all" is every market. */
export type MarketChoice = 'header' | 'all'
