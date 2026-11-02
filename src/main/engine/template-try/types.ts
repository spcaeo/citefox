import type { Market, PageSummary, TemplateSettings } from '@shared/domain'
import type { SqliteDatabase } from '../../storage/database'

/** What one Try it run renders from: the open project file, the page and market, the draft. */
export interface TryInput {
  db: SqliteDatabase
  projectId: string
  /** The project's domain, for the check results a summary reads. */
  domain: string
  page: PageSummary
  market: Market
  kind: string
  body: string
  /** Already limited to the settings that apply to `kind`. */
  settings: TemplateSettings
  secrets: readonly string[]
}

/** The prompt one Try it run sends, and how its reply is checked against the step's output. */
export interface TryDraft {
  prompt: string
  /** Why a parsed reply does not match the step, in a sentence, or null when it matches. */
  validate: (value: unknown) => string | null
}
