import type { Market, PageResults, PromptCheckStatus } from '@shared/domain'

/** One market's `results:get`, or why it could not be read. */
export interface MarketResults {
  market: Market
  results: PageResults | null
  error: string | null
}

/** One cell of the prompt × market grid (FR-9.7). Null status is "not checked in that market". */
export interface MatrixCell {
  marketId: string
  /** The check the status comes from, so the cell opens Prompt detail at that check. */
  runId: string | null
  status: PromptCheckStatus | null
  position: number | null
}

export interface MatrixRow {
  promptId: string
  position: number
  label: string
  text: string
  cells: readonly MatrixCell[]
  /** True when two checked markets disagree on the status. */
  differs: boolean
}

/** The add-market form (FR-9.6). `location` is free text; the engine matches it on save. */
export interface MarketForm {
  country: string
  language: string
  location: string
  device: Market['device']
  localWording: boolean
}
