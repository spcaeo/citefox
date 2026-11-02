import type { ImportEntity } from '@shared/import-fields'
import type { SetupContext, SetupRow, SetupSectionId } from '@shared/ipc'
import type { SiteCheck } from '../../engine/site-grounding'
import type { SiteFacts } from '../../engine/site-outline'

/**
 * One section of the onboarding v2 cards (Docs/ONBOARDING.md): what Claude is asked,
 * which context lines it sees, the reply's CSV header and how a reply row becomes a
 * `SetupRow`. The registry (`registry.ts`) holds one per section; the prompt builder,
 * the reader and the merge are shared.
 */

/** A context line the prompt may carry (left out when its value is empty). */
export type SectionContextLine =
  | 'website'
  | 'market'
  | 'summary'
  | 'brands'
  | 'products'
  | 'buyers'
  | 'triggers'
  | 'competitors'
  | 'switchingFrom'
  | 'integrations'
  | 'topic'

/**
 * A block of the site digest a section's prompt carries (`prompt.ts`): the site's
 * paths with their titles, and what step 3's read found with the words that show it.
 */
export type SiteBlock =
  'paths' | 'brands' | 'quotes' | 'audiences' | 'compared' | 'switching' | 'integrations'

/** What the code checks of one reply can use: the site's paths and text, the read's finds. */
export interface SiteGround {
  check: SiteCheck | null
  facts: SiteFacts | null
}

/** Values of one reply row, by reply column id. */
export type SectionValues = Readonly<Record<string, string>>

interface SectionBase {
  id: SetupSectionId
  /** "brand name" / "brand names". */
  noun: readonly [string, string]
  /** The context lines this section's prompt carries, in order. */
  context: readonly SectionContextLine[]
  /**
   * The site digest blocks the prompt carries (`engine/site-outline.ts`), from the step 3
   * read or a read of the home page, so Claude works from the site instead of guessing.
   */
  site?: readonly SiteBlock[]
  /** True: the run may search the web (competitors only). */
  webSearch: boolean
  /** One run's dollar estimate on an API key. */
  usd: number
  /** The prompt's first line: who Claude helps and with what. */
  role(context: SetupContext): string
  /** The section's own instructions (what to write, the allowed values). */
  task(context: SetupContext, count: number): readonly string[]
}

/** A list section: the reply is one CSV. */
export interface ListSectionDef extends SectionBase {
  kind: 'list'
  /** The reply's CSV header, in order. The first column is the row's main value. */
  columns: readonly string[]
  /** Header words come from IMPORT_FIELDS for this entity (null: the column ids only). */
  entity: ImportEntity | null
  /** A column whose IMPORT_FIELDS id differs (`product` → `competes_with`). */
  fields?: Readonly<Record<string, string>>
  /** Rows asked for. */
  count: number
  /** Rows kept from one reply. */
  maxRows: number
  /** Neutral lists (buyer questions) set aside rows that name the brand. */
  neutral: boolean
  /** A reply row as a SetupRow. Null drops it (the guards live here). */
  toRow(values: SectionValues, context: SetupContext, ground: SiteGround): SetupRow | null
  /** Checks across the kept rows (order, caps, variants), with a plain warning each. */
  finish?(
    rows: readonly SetupRow[],
    context: SetupContext,
    ground: SiteGround
  ): { rows: SetupRow[]; warnings: string[] }
  /** What a row is compared by when merging near-duplicates. */
  keys(row: SetupRow): readonly string[]
  /** How a current row is listed in the prompt. */
  line(row: SetupRow): string
}

/** A text section ("What X does", the topic): the reply is one block of text. */
export interface TextSectionDef extends SectionBase {
  kind: 'text'
  /** Most characters kept from the answer. */
  maxChars: number
  /** The reply rule in place of the plain "text only" one. */
  replyLead?: string
}

export type SectionDef = ListSectionDef | TextSectionDef
