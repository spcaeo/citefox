/**
 * First run "guided autopilot" (owner feedback 4, journey A). Right after
 * onboarding CiteFox already knows the domain: it reads the homepage, the
 * sitemap and the key pages, groups the pages by section, asks Claude which
 * pages are likely to matter and who the rivals are, then writes a buyer
 * profile and the first buyer questions as a topic draft and matches them to
 * pages. None of that spends a SerpApi search. The user then sees what was
 * found, picks target pages on the plan, and starts the first check, which is
 * the only step that searches. The plan is saved per project (project
 * migration 030).
 */

import type { AssistLabel } from './assist'
import { invokeWith, push, type InvokeChannelSpecs, type PushChannelSpecs } from './contract'
import type { ProjectIdRequest } from './projects'

/** What a recommended page is, from its address. */
export const START_PAGE_KINDS = [
  'pricing',
  'compare',
  'alternatives',
  'use_case',
  'feature',
  'integration',
  'guide',
  'other'
] as const

export type StartPageKind = (typeof START_PAGE_KINDS)[number]

/** One top-level section of the site (a top folder), as "What we found" lists it. */
export interface SiteStartSection {
  /** The folder, such as `/compare/`; `/` holds top-level pages. */
  key: string
  /** "Compare", "Use cases", "Top-level pages". */
  label: string
  pageCount: number
  trackedCount: number
  /** Up to three pages: money pages first, then the shortest paths. */
  samples: readonly { url: string; title: string | null }[]
  /** Picked pages in this section ("Likely to matter"). */
  likely: number
  /** The best picked page in this section, else null. */
  strongest: string | null
}

/** One page CiteFox picked as likely to matter. */
export interface SiteStartPage {
  url: string
  /** `/pricing/`. */
  path: string
  title: string | null
  /** The sitemap page row, when the sitemap listed it. */
  pageId: string | null
  kind: StartPageKind
  /** The section label ("Compare"). */
  section: string
  /** One line: why this page is likely to matter for AI Overviews. */
  reason: string
  /** Where the reason came from ("Homepage links it as Pricing", "Sitemap: 48 compare pages"). */
  evidence: string
  alreadyTracked: boolean
  /** Draft questions whose best page this is. */
  questionCount: number
}

/** One topic (a buyer problem) CiteFox recommends starting from. */
export interface SiteStartTopic {
  /** The seed in the buyer's words; never names the brand. */
  seed: string
  reason: string
  evidence: string
  /** A fact to check first, in plain words. */
  caution: string | null
}

export const START_RIVAL_KINDS = ['competitor', 'switch_from', 'partner'] as const
export type StartRivalKind = (typeof START_RIVAL_KINDS)[number]

/**
 * A company the buyer meets on the way. A competitor is picked instead of you
 * for the same job today; `switch_from` is an option buyers leave (a shut-down
 * gateway); `partner` is an integration, never a rival.
 */
export interface StartRival {
  name: string
  /** Only when the site or the project names it; never guessed. */
  domain: string | null
  kind: StartRivalKind
  reason: string
}

export interface StartBuyers {
  who: string | null
  segments: readonly string[]
  triggers: readonly string[]
}

/** One drafted buyer question. */
export interface StartQuestion {
  id: string
  text: string
  stage: string | null
  /** The page Claude matched it to; null for "no page yet". */
  targetUrl: string | null
}

/** The topic the autopilot drafted (a `topic_drafts` row). */
export interface StartTopicDraft {
  draftId: string
  name: string
  seed: string
  questionCount: number
  stageCount: number
}

/** What the plan estimate multiplies. `searchesLeft` is read live from key usage and the cap. */
export interface SiteStartBudget {
  markets: number
  promptsPerPage: number
  questionsPerTopic: number
  samples: number
  /** Null when no SerpApi key reports an allowance. */
  searchesLeft: number | null
}

export interface SiteStartPlan {
  projectId: string
  domain: string
  /** Pages the sitemap lists (not removed). */
  pageCount: number
  /** Sitemaps read, and the problem when none could be found. */
  sitemapCount: number
  sitemapProblem: string | null
  /** Biggest first. */
  sections: readonly SiteStartSection[]
  /** Pages read in full, and whether each read worked. */
  pagesRead: readonly { url: string; ok: boolean }[]
  /** Reads that worked on the second try, and reads skipped. */
  retried: number
  skipped: number
  /** Up to 12 pages likely to matter, best first. */
  pages: readonly SiteStartPage[]
  /** The 3 pages ticked on the plan. */
  recommendedUrls: readonly string[]
  /** 0–2 topics; the first is the drafted one. */
  topics: readonly SiteStartTopic[]
  rivals: readonly StartRival[]
  buyers: StartBuyers
  topic: StartTopicDraft | null
  questions: readonly StartQuestion[]
  /** `rules` when Claude could not be used; pages then come from the address rules alone. */
  source: 'claude' | 'rules'
  /** Plain words when something was missing ("Claude could not be reached…"). */
  message: string | null
  /** The Claude call's label ("Claude · about 25 s"); null for a rules-only plan. */
  label: AssistLabel | null
  budget: SiteStartBudget
  /** How long the autopilot took. */
  elapsedMs: number
  /** ISO-8601 UTC. */
  builtAt: string
  /** Set once the first check started from the plan. */
  topicId: string | null
  firstCheckAt: string | null
}

export interface StartHomeworkRequest {
  projectId: string
  /** True reads everything again and asks Claude again. */
  force?: boolean
}

export interface StartSuggestUrlsRequest {
  projectId: string
  /** What the user typed: a path, words, or a full URL. Empty lists the best pages. */
  query: string
  /** 1–50, default 8. */
  limit?: number
}

export interface StartUrlSuggestion {
  url: string
  path: string
  title: string | null
  /** The section label. */
  section: string
  alreadyTracked: boolean
}

export interface StartUrlSuggestions {
  suggestions: readonly StartUrlSuggestion[]
  /** Pages that matched before the limit. */
  total: number
}

/** The autopilot steps, in order. */
export const START_STEP_IDS = [
  'home',
  'sitemap',
  'sections',
  'key_pages',
  'pick',
  'rivals',
  'profile',
  'questions',
  'plan'
] as const

export type StartStepId = (typeof START_STEP_IDS)[number]

export const START_ITEM_STATES = ['pending', 'running', 'ok', 'warning', 'failed'] as const
export type StartItemState = (typeof START_ITEM_STATES)[number]

/** One page read under "Read key pages": a retry or a skip is shown inline. */
export interface StartSubItem {
  /** The path, `/pricing`. */
  label: string
  state: 'running' | 'ok' | 'retried' | 'skipped'
  detail: string
}

export interface StartStepItem {
  id: StartStepId
  label: string
  state: StartItemState
  /** What it found or is doing ("142 pages", "6 of 10 written"). */
  detail: string | null
  /** Time it took once done. */
  durationMs: number | null
  /** Usual seconds, for the time left. */
  estimateSeconds: number
  /** Retries and skips (key pages). */
  subItems: readonly StartSubItem[]
  /** A step with parts (questions written). */
  progress: { done: number; total: number } | null
}

/** "What we know" while the autopilot runs. Fields fill in as steps finish. */
export interface StartKnown {
  pageCount: number | null
  sections: readonly { key: string; label: string; pageCount: number }[]
  rivals: readonly StartRival[]
  buyers: StartBuyers | null
  picked: number | null
  pickedPages: readonly { url: string; path: string }[]
  questions: readonly StartQuestion[]
  /** Pages queued to be read next. */
  upNext: readonly string[]
}

export const START_PHASES = ['running', 'done', 'stopped', 'failed'] as const
export type StartPhase = (typeof START_PHASES)[number]

/** Pushed on every change while the autopilot runs; also returned by `start:progress`. */
export interface StartProgress {
  projectId: string
  phase: StartPhase
  items: readonly StartStepItem[]
  /** ISO-8601 UTC. */
  startedAt: string
  elapsedMs: number
  /** Null when unknown or done. */
  etaSeconds: number | null
  /** Why it stopped or failed, in plain words. */
  message: string | null
  known: StartKnown
}

export interface StartBeginRequest {
  projectId: string
  /** Target pages ticked on the plan. Questions matched elsewhere get "no page yet". */
  targetUrls: readonly string[]
}

export interface StartBeginResult {
  topicId: string
  /** The first check job; null when it could not start (message says why). */
  jobId: string | null
  message: string
}

/** Where the project is in the journey, for the Getting started strip and routing. */
export interface StartJourney {
  projectId: string
  /** No tracked or setting-up page, no topic and no plan: show `#/start`. */
  empty: boolean
  /** The autopilot is running now. */
  running: boolean
  hasPlan: boolean
  topicId: string | null
  checkStarted: boolean
  /** A finished check exists on the started topic (or any page). */
  hasResults: boolean
  /** The page or topic whose first results to open. */
  resultsPageId: string | null
}

/**
 * One user edit along the journey (while the autopilot runs, on "What we
 * found" and on the plan). Edits are stored (project migration 031), apply at
 * once to what the screens show, and feed the steps that have not run yet.
 */
export type StartEdit =
  | { kind: 'rival'; op: 'add'; name: string; rivalKind: StartRivalKind }
  | { kind: 'rival'; op: 'remove'; name: string }
  | { kind: 'rival'; op: 'rename'; name: string; to: string }
  | { kind: 'rival'; op: 'move'; name: string; rivalKind: StartRivalKind }
  | { kind: 'segment' | 'trigger'; op: 'add'; text: string }
  | { kind: 'segment' | 'trigger'; op: 'remove'; text: string }
  | { kind: 'segment' | 'trigger'; op: 'rename'; text: string; to: string }
  | { kind: 'who'; op: 'set'; text: string }
  | { kind: 'page'; op: 'add'; url: string }
  | { kind: 'page'; op: 'remove'; url: string }
  | { kind: 'question'; op: 'add'; text: string }
  | { kind: 'question'; op: 'remove'; id: string }
  | { kind: 'question'; op: 'edit'; id: string; text: string }

export interface StartEditRecord {
  id: string
  edit: StartEdit
  /** "Removed competitor PagerDuty". */
  summary: string
  /** ISO-8601 UTC. */
  at: string
  undoneAt: string | null
  /** A follow-up CiteFox made for this edit (a rewritten question); undone with it. */
  parentId: string | null
  /** True for a follow-up CiteFox made, false for the user's own edit. */
  system: boolean
}

export interface StartEditRequest {
  projectId: string
  edit: StartEdit
}

export interface StartUndoRequest {
  projectId: string
  editId: string
}

export interface StartEditResult {
  record: StartEditRecord
  /** What it changed further on, in plain words ("Rewrote 2 questions with your change"). Null when nothing. */
  effect: string | null
  /** The plan with every active edit applied; null while the autopilot has not finished. */
  plan: SiteStartPlan | null
  /** The live snapshot with every active edit applied; null when nothing runs. */
  progress: StartProgress | null
}

export interface StartEditList {
  edits: readonly StartEditRecord[]
}

export const startChannels = {
  /** Runs (or reuses) the autopilot. Resolves when it is done. No SerpApi search. */
  'start:homework': invokeWith<StartHomeworkRequest, SiteStartPlan>(),
  /** The saved plan with a live budget; null before the first run. */
  'start:get': invokeWith<ProjectIdRequest, SiteStartPlan | null>(),
  /** The latest progress snapshot (this session); null when nothing ran. */
  'start:progress': invokeWith<ProjectIdRequest, StartProgress | null>(),
  /** Stops the autopilot after the current step (Pause and Cancel). */
  'start:stop': invokeWith<ProjectIdRequest, StartProgress | null>(),
  /** Sets target pages and starts the first check of the drafted topic: the step that searches. */
  'start:begin': invokeWith<StartBeginRequest, StartBeginResult>(),
  'start:status': invokeWith<ProjectIdRequest, StartJourney>(),
  /** Applies one edit now (and to the steps still to run). Undoable. */
  'start:edit': invokeWith<StartEditRequest, StartEditResult>(),
  /** Undoes an edit and the follow-ups CiteFox made for it. */
  'start:undo': invokeWith<StartUndoRequest, StartEditResult>(),
  'start:edits': invokeWith<ProjectIdRequest, StartEditList>(),
  /** Sitemap pages for the Add page address box. */
  'start:suggestUrls': invokeWith<StartSuggestUrlsRequest, StartUrlSuggestions>()
} as const satisfies InvokeChannelSpecs

export const startEvents = {
  'start:changed': push<StartProgress>()
} as const satisfies PushChannelSpecs
