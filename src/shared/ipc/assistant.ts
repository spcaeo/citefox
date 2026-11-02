/**
 * Ask CiteFox, the context-aware assistant (deep audit crosscut §3.3). The
 * renderer sends the question, what the screen shows (ids, names, numbers)
 * and the last turns; main builds a context packet from the project's stored
 * checks for those ids, routes the question to one single-purpose prompt,
 * and checks every number in the answer against the packet. It never
 * searches Google and never changes anything: actions come back as cards the
 * user confirms, which then call the existing channels.
 */

import type { AskAnswer } from './ask'
import type { AssistLabel } from './assist'
import { invokeWith, type InvokeChannelSpecs } from './contract'

/** Most characters in one question. */
export const ASSISTANT_QUESTION_MAX = 500

/** Earlier turns sent with a question (each one short). */
export const ASSISTANT_HISTORY_MAX = 3

/** The single-purpose prompt a question is routed to. */
export const ASSISTANT_INTENTS = [
  'list',
  'explain',
  'why_not_cited',
  'next_steps',
  'draft',
  'questions',
  'changes',
  'summary',
  'help'
] as const

export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number]

export const ASSISTANT_ENTITY_KINDS = [
  'project',
  'page',
  'topic',
  'question',
  'market',
  'check',
  'competitor',
  'domain',
  'fix',
  'kpi',
  'chart',
  'section',
  'setting',
  'template',
  'report',
  'community',
  'video',
  'group',
  'alert',
  'connection'
] as const

export type AssistantEntityKind = (typeof ASSISTANT_ENTITY_KINDS)[number]

export interface AssistantEntity {
  kind: AssistantEntityKind
  id: string | null
  label: string
  detail: string | null
}

/** A number the screen shows. */
export interface AssistantNumber {
  label: string
  value: string
  drill: string | null
}

export const ASSISTANT_ACTION_KINDS = [
  'add-questions',
  'create-topic',
  'draft-fix',
  'set-target',
  'open-drill',
  'start-check'
] as const

export type AssistantActionKind = (typeof ASSISTANT_ACTION_KINDS)[number]

/** What the screen shows: the ids main reads stored data for, and the names around them. */
export interface AssistantContextInput {
  /** `overview`, `topic.todo`, `page.results`, `drawer.drill`… */
  screen: string
  screenLabel: string
  crumbs: readonly string[]
  pageId: string | null
  topicId: string | null
  promptId: string | null
  marketId: string | null
  runId: string | null
  /** What a ✦ pick was about (a question row, a KPI tile). */
  about: AssistantEntity | null
  entities: readonly AssistantEntity[]
  selection: readonly AssistantEntity[]
  filters: Readonly<Record<string, string>>
  numbers: readonly AssistantNumber[]
  facts: readonly string[]
  capabilities: readonly AssistantActionKind[]
}

/** One earlier turn, as a short summary (never the rows again). */
export interface AssistantTurn {
  question: string
  answer: string
}

export interface AssistantAskRequest {
  /**
   * The open project. Null when none is open: the question is then about the
   * app itself (setting up, connections, your projects), answered from what
   * CiteFox has stored, never from a project's checks.
   */
  projectId: string | null
  question: string
  context: AssistantContextInput
  history: readonly AssistantTurn[]
}

/** Where a claim comes from: a link to the stored data. */
export interface AssistantSource {
  kind: 'check' | 'page' | 'page-read' | 'topic' | 'drill' | 'competitor'
  label: string
  pageId: string | null
  promptId: string | null
  marketId: string | null
  runId: string | null
  /** A drill id the screen registered (`open-drill`). */
  drill: string | null
  /** A competitor or cited domain. */
  domain: string | null
}

/** A proposed app action. Nothing runs until the user presses its button. */
export interface AssistantAction {
  id: string
  kind: AssistantActionKind
  /** "Add 5 questions to Replacing a carrier gateway". */
  title: string
  /** One line: what changes and what it costs. */
  detail: string
  /** The page or topic it acts on. */
  pageId: string | null
  topicId: string | null
  promptIds: readonly string[]
  marketIds: readonly string[]
  /** `add-questions`, `create-topic`: the questions. */
  questions: readonly string[]
  /** `create-topic`: the suggested name. */
  name: string | null
  /** `set-target`: the page to point the questions at. */
  targetPageId: string | null
  /** `start-check`: searches the check uses (prompts × markets). */
  searches: number | null
  /** `open-drill`: the drill id. */
  drill: string | null
}

/** A help topic an answer used (`Docs/help/<id>.md`); the drawer links "Read more: <title>". */
export interface AssistantHelpLink {
  /** The help file name without `.md` (`glossary`, `reports-impact`). */
  id: string
  title: string
}

/** One next step: the screen the help topic is about, as a link. */
export interface AssistantNextStep {
  /** A route section id (`questions`, `overview`, `reports`…). */
  section: string
  /** "Open Questions". */
  label: string
}

export interface AssistantAnswer {
  intent: AssistantIntent
  /** The question as asked. */
  question: string
  /** Plain words, every number checked against the stored data. */
  text: string
  /** A draft (an answer, a fix, a summary) when one was asked for. Unconfirmed facts in [brackets]. */
  draft: string | null
  /** Suggested or rewritten questions (`questions` intent). */
  questions: readonly string[]
  sources: readonly AssistantSource[]
  actions: readonly AssistantAction[]
  /** Parts of the question the stored data cannot answer ("Not in your saved data"). */
  unknowns: readonly string[]
  /** Numbers that were not in the stored data and were taken out. */
  flagged: readonly string[]
  /** What the answer is based on. */
  basedOn: { checkedThrough: string | null; checks: number; markets: number }
  /** The Claude label. Null when no Claude call was needed. */
  label: AssistLabel | null
  /** A list answer (`list` intent): the stored rows behind it. */
  list: AskAnswer | null
  /** Always true: Ask CiteFox never runs a search. */
  savedDataOnly: true
  /** Help topics the answer used, most relevant first. Main always fills it; optional for old literals. */
  help?: readonly AssistantHelpLink[]
  /** One next step when a help topic names a screen other than this one. */
  next?: AssistantNextStep | null
}

/** Invoke channels for this area. Each one is declared here only. */
export const assistantChannels = {
  'assistant:ask': invokeWith<AssistantAskRequest, AssistantAnswer>()
} as const satisfies InvokeChannelSpecs
