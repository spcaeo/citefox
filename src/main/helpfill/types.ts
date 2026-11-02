import type { ImportEntity } from '@shared/import-fields'
import type { HelpFillScope } from '@shared/ipc'
import type { EngineHost } from '../engine/host'
import type { SqliteDatabase } from '../storage/database'
import type { ProjectRecord } from '../storage/records'

/**
 * One place that uses "✦ Help me fill this" (Docs/HELPFILL.md): what the reply
 * holds, how the prompt asks for it, what is already tracked, and how in-app
 * Claude drafts it. Later places register one of these each (`registerHelpFillKind`);
 * the channels, the reader and the merge stay the same.
 */

/** Values of one row, by reply column id. */
export type HelpFillValues = Readonly<Record<string, string>>

/** One block of the reply. A single-section kind has one, with `title: null`. */
export interface HelpFillSection {
  /** `main` for a single-section kind; `products`, `buyers`… for a multi-section one. */
  id: string
  /** The `### TITLE` the prompt asks for. Null: the reply has no section headers. */
  title: string | null
  /** More header words that name this section, folded ("competitor", "rivals"). */
  synonyms?: readonly string[]
  /** Reply columns, in header order. The first one is the row's main value. */
  columns: readonly string[]
  /** Header words come from IMPORT_FIELDS for this entity (so paste-back and the CSV template agree). */
  entity: ImportEntity | null
  /**
   * A reply column whose IMPORT_FIELDS id differs (`city` → `location`): its header
   * words, label and value guesses come from that field.
   */
  fields?: Readonly<Record<string, string>>
  /** Set aside rows that name the brand. Default: the kind's `neutral`. */
  neutral?: boolean
}

/** The page or topic the rows are for. */
export interface HelpFillTarget {
  id: string
  kind: 'page' | 'topic'
  name: string
  /** A page's address, null for a topic. */
  url: string | null
}

/**
 * The project's context for one scope, read once and closed. Plain values only (no
 * database handle), so Describe can use it after the project file is closed.
 */
export interface HelpFillContext {
  projectId: string
  domain: string
  brands: readonly string[]
  target: HelpFillTarget | null
  /** business, product, market, buyer and competitor blocks (prompts/blocks.ts), in order. */
  blocks: readonly string[]
  /** Paths of the tracked pages (`/pricing/`), the values a `page` column may use. */
  pagePaths: readonly string[]
  /** Questions the target tracks now. */
  targetQuestions: readonly string[]
  /** Every question the project tracks (near-duplicates anywhere are merged). */
  projectQuestions: readonly string[]
  /** The question a text kind is about (`scope.promptId`), else null. */
  promptId: string | null
  /** A text kind's extra opaque id (`scope.subject`), else null. */
  subject: string | null
  /** The tracked pages (not topics) with their address and name, for a kind that picks one. */
  pages?: readonly HelpFillPage[]
  /** The project's products, for a column that names one (`competes_with`). */
  products?: readonly { id: string; name: string; job: string; buyer: string }[]
  /** The project's default market, for a kind that searches the web. */
  market?: { country: string; language: string } | null
  /** Saved competitors, for the competitors kind's tracked list. */
  competitors?: readonly { name: string; domain: string | null }[]
  /** The place's own rows the request sent (`items`, Match pages). */
  items?: readonly string[]
  /** What the kind's own `extra` read (markets, segments, topic names…), by name. */
  extra?: Readonly<Record<string, readonly string[]>>
}

/** A tracked page a row can be matched to. */
export interface HelpFillPage {
  /** `/pricing/`. */
  path: string
  url: string
  /** Its label or title, else the path. */
  name: string
}

/** What is already tracked: listed in the prompt, and merged into when a row repeats it. */
export interface HelpFillTracked {
  /** Listed in the prompt, so the chatbot does not repeat them. */
  listed: readonly string[]
  /** Values rows merge into, by section id, compared the same way as `key`. */
  merge: Readonly<Record<string, readonly string[]>>
}

/** A drafted row before ids are assigned. */
export interface HelpFillDraftRow {
  section: string | null
  values: HelpFillValues
}

export interface HelpFillDescribeInput {
  sentence: string
  count: number
}

/**
 * A text kind (Docs/HELPFILL.md "Text kinds"): the reply is one block of text (a
 * rewritten section, a pitch email, a report summary) rather than rows. The prompt
 * carries the kind's own evidence instead of a reply header and a tracked list.
 */
export interface HelpFillTextReply {
  /**
   * The evidence lines the prompt carries after the role and the context blocks: the
   * question, what Google cited, the user's section. Blank lines between groups are
   * kept; an empty group is left out by the kind. Throw `HelpFillEvidenceMissing` when
   * something it needs is not saved yet.
   */
  evidence(
    host: EngineHost,
    context: HelpFillContext
  ): readonly string[] | Promise<readonly string[]>
  /** Most characters kept from the answer (at most HELPFILL_TEXT_MAX). */
  maxChars: number
  /**
   * The kind's own check of a pasted or drafted text, against the evidence the prompt
   * carried: it may take out what is not allowed (a number not in the report) and
   * says so in `warnings`.
   */
  check?(
    text: string,
    evidence: readonly string[],
    context: HelpFillContext
  ): { text: string; warnings: string[] }
}

/** Something a text kind's evidence needs is not saved yet; the message says what to do. */
export class HelpFillEvidenceMissing extends Error {
  readonly nextStep: string | null

  constructor(message: string, nextStep: string | null = null) {
    super(message)
    this.name = 'HelpFillEvidenceMissing'
    this.nextStep = nextStep
  }
}

export interface HelpFillKindDef {
  kind: string
  /** "question" / "questions". */
  noun: readonly [string, string]
  /** `page`: the request must name a page or topic. `project`: the whole project. */
  scope: 'page' | 'project'
  /** More of the scope a request must name (a text kind's question or subject). */
  needs?: readonly Exclude<keyof HelpFillScope, 'pageId'>[]
  /** Set: a text kind (one block of text back). Absent: rows. */
  text?: HelpFillTextReply
  /** The project's context blocks (business, product, market, buyer, competitors). Default true. */
  contextBlocks?: boolean
  sections: readonly HelpFillSection[]
  /** Neutral lists (buyer questions) set aside rows that name the brand. */
  neutral: boolean
  /** Describe's count select: default and most. */
  defaultCount: number
  maxCount: number
  /** Rows the chatbot prompt asks for (it is free, so more). */
  chatbotCount: number
  /** One Describe run: Claude calls and the dollar estimate on an API key. */
  describeCost: { calls: number; usd: number }
  /** The prompt's first line: who the chatbot is helping and with what. */
  role(context: HelpFillContext): string
  /** The kind's own instructions for `count` rows: what to write and the allowed values. */
  task(context: HelpFillContext, count: number): readonly string[]
  tracked(context: HelpFillContext): HelpFillTracked
  /**
   * False: the prompt leaves out "Already tracked…" and its list (a kind that works on
   * the place's own rows instead of finding new ones). Default true.
   */
  trackedLine?: boolean
  /**
   * Reads more of the project for this kind while the file is open (the markets it
   * tracks, a page's segments…). The values land on `context.extra`.
   */
  extra?(
    db: SqliteDatabase,
    project: ProjectRecord,
    pageId: string | null
  ): Readonly<Record<string, readonly string[]>>
  /**
   * What a row is compared by. Default: the section's main value. The key goes through
   * the importer's normaliser (`questionMergeKey`), like the `merge` lists.
   */
  key?(values: HelpFillValues, section: HelpFillSection): string
  /** Tidies a row (stage words to stage ids…). Null drops it. */
  clean?(
    values: HelpFillValues,
    context: HelpFillContext,
    section: HelpFillSection
  ): HelpFillValues | null
  /** In-app Claude drafts rows from the user's sentence. Absent: Describe is not offered. */
  describe?(
    host: EngineHost,
    context: HelpFillContext,
    input: HelpFillDescribeInput
  ): Promise<readonly HelpFillDraftRow[]>
}
