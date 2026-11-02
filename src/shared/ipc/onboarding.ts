/** First-run onboarding (section 15). */

import type { EngineId, Market, MarketDevice, ProjectSummary } from '../domain'
import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'
import type { HelpFillEstimate } from './helpfill'
import type { CompetitorTier, FillFromWebsiteResult } from './projects'

const ONBOARDING_STEPS = ['profile', 'serpapi', 'claude', 'jina'] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/** `skipped` is only used for Jina, which section 15 makes optional. */
export type OnboardingStepStatus = 'pending' | 'done' | 'skipped'

export interface OnboardingStepState {
  id: OnboardingStep
  status: OnboardingStepStatus
}

/**
 * Profile saved at step 1 (section 15, FR-1.1, FR-9.3).
 * `userName` echoes `settings.userName`. It is not a project column.
 * `project` is the website. `defaultMarket.country` and `language` are codes, not labels.
 */
export interface OnboardingProfile {
  /** Echo of `settings.userName` after the profile step. */
  userName: string
  project: ProjectSummary
  /** FR-1.1. Defaults to true. */
  includeSubdomains: boolean
  brandNames: readonly string[]
  competitors: readonly string[]
  defaultMarket: Market
  /** Options buyers switch from, kept for buyer prompts (Docs/FEEDBACK.md row 3). */
  switchingFrom?: readonly string[]
  /** Integrations and tools buyers use with it, kept for buyer prompts. */
  integrations?: readonly string[]
}

/**
 * Resume point for a first run. `currentStep` is the first step still `pending`,
 * or null once `finished` is true. It is not the page the user happens to be looking at.
 */
export interface OnboardingState {
  finished: boolean
  currentStep: OnboardingStep | null
  profile: OnboardingProfile | null
  steps: readonly OnboardingStepState[]
}

/** Arguments for `onboarding:saveProfile`. */
export interface SaveProfileRequest {
  /** "Your name" on the profile step. Written to `settings.userName`. */
  userName: string
  /** FR-1.1 project name. */
  projectName: string
  /** Registrable domain, such as `example.com`. */
  domain: string
  /** Defaults to true when the profile step does not show a control. */
  includeSubdomains: boolean
  /** At least one (the profile step blocks an empty list). */
  brandNames: readonly string[]
  /** Optional. An empty list means no competitors yet. */
  competitors: readonly string[]
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string
  /** ISO 639-1 or BCP-47. Primary subtag lowercase. */
  language: string
  /** City or region. Null when the field is left empty. */
  location: string | null
  /**
   * FR-9.1. CEO decision: `desktop` when the profile step does not ask.
   */
  device: MarketDevice
  /** Optional. "Use in buyer questions" picks from Fill from my website; never competitors. */
  switchingFrom?: readonly string[]
  /** Optional. "Note as integration" picks from Fill from my website. */
  integrations?: readonly string[]
}

/** The page an unfinished onboarding was on: the welcome screen or a step. */
export type OnboardingDraftView = 'welcome' | OnboardingStep

/**
 * The profile form as typed, before it is saved (Docs/FEEDBACK.md batch 2 row 4).
 * Select values may be `other`, with the typed code in `countryCode` or `languageCode`.
 */
export interface OnboardingProfileDraft {
  userName: string
  projectName: string
  domain: string
  brands: readonly string[]
  brandDraft: string
  competitors: readonly string[]
  competitorDraft: string
  switchingFrom: readonly string[]
  integrations: readonly string[]
  country: string
  countryCode: string
  language: string
  languageCode: string
  location: string
}

/**
 * An unfinished onboarding, kept across restarts so reopening the app lands on the
 * same step with the same data. Keys are saved by their own steps; a draft never
 * holds a secret. Cleared when onboarding finishes.
 */
export interface OnboardingDraft {
  view: OnboardingDraftView
  profile: OnboardingProfileDraft
  /** The last "Fill from my website" read shown on the profile step. Null before one. */
  fill: FillFromWebsiteResult | null
  /** The SerpApi step's monthly search budget field, as typed. Not a secret. */
  budget: string
  /** Onboarding v2: the step on screen. Absent on a draft saved before v2. */
  setupView?: 'welcome' | SetupStep
  /** Onboarding v2: everything typed or confirmed so far. Absent before v2. */
  setup?: SetupDraft
}

/*
 * Onboarding v2 (owner-approved mock-up `Onboarding.dc.html`, 2026-10-24): eight short
 * steps, and every section on steps 4–8 is a card the user controls (tick, edit, remove,
 * add, ✦ Find more, ✦ Redo with their words, edit the prompt, or their own ChatGPT).
 * The profile is saved with `onboarding:saveProfile` when the user leaves step 6, so
 * steps 7 and 8 work on a real project; `onboarding:finishSetup` saves the rest.
 */

export const SETUP_STEPS = [
  'site',
  'claude',
  'read',
  'brand',
  'buyers',
  'competitors',
  'engines',
  'shapes',
  'questions'
] as const

export type SetupStep = (typeof SETUP_STEPS)[number]

export function isSetupStep(value: string): value is SetupStep {
  return SETUP_STEPS.some((item) => item === value)
}

/**
 * How a buyer asks an AI engine (owner feedback 2026-10-25): a short search as typed into
 * Google, a question, or a situation told in full the way people ask ChatGPT. To an
 * engine they are all prompts; the mix decides which of them CiteFox checks.
 */
export const PROMPT_SHAPES = ['search', 'question', 'situation'] as const

export type PromptShape = (typeof PROMPT_SHAPES)[number]

export function isPromptShape(value: unknown): value is PromptShape {
  return PROMPT_SHAPES.some((shape) => shape === value)
}

/**
 * The shape a prompt reads as, for a pasted list or a reply without a shape column:
 * two or more sentences is a situation, a question mark or a question word a question,
 * anything else a search.
 */
export function guessPromptShape(text: string): PromptShape {
  const flat = text.replace(/\s+/gu, ' ').trim()
  const sentences = flat.split(/[.!?]+\s+(?=\S)/u).filter((part) => part.trim().length > 0)
  if (sentences.length >= 2 || flat.split(' ').length > 22) return 'situation'
  if (
    /\?$/u.test(flat) ||
    /^(how|what|which|why|when|where|who|is|are|can|does|do|should|will)\b/iu.test(flat)
  ) {
    return 'question'
  }
  return 'search'
}

/** How many prompts of each shape the first topic gets. */
export type PromptMix = Readonly<Record<PromptShape, number>>

export const DEFAULT_PROMPT_MIX: PromptMix = { search: 4, question: 4, situation: 4 }

/** Most prompts of one shape a mix asks for. */
export const MAX_SHAPE_COUNT = 20

/** How many prompts a mix asks for in all. */
export function mixTotal(mix: PromptMix): number {
  return PROMPT_SHAPES.reduce((sum, shape) => sum + mix[shape], 0)
}

export function sameMix(a: PromptMix | null, b: PromptMix | null): boolean {
  if (a === null || b === null) return a === b
  return PROMPT_SHAPES.every((shape) => a[shape] === b[shape])
}

/** The list sections. Step 4: brands, products. 5: buyers, triggers. 6: competitors,
 * switchingFrom, integrations. 8: examples (one buying moment in each shape). 9: questions. */
export const SETUP_LISTS = [
  'brands',
  'products',
  'buyers',
  'triggers',
  'competitors',
  'switchingFrom',
  'integrations',
  'examples',
  'questions'
] as const

export type SetupListId = (typeof SETUP_LISTS)[number]

/** Every section Claude can fill: the lists plus two text sections ("What X does", the topic). */
export type SetupSectionId = SetupListId | 'summary' | 'topic'

/**
 * One row as Claude returns it and as the renderer sends it back as context.
 * What each field holds per section:
 * - brands, triggers, switchingFrom, integrations: `name` only (`url` = a bare host for
 *   switchingFrom and integrations when known)
 * - products: `name`, `detail` = the job it does, `url` = a path on the site or null
 * - buyers: `name` = who they are, `detail` = their situation (what happened, what they need)
 * - competitors: `name`, `url` = a bare host, `detail` = why a buyer would pick them,
 *   `tag` = the product name it competes with, `tier` = direct or partial
 * - examples: `name` = the prompt, `tag` = its shape, `detail` = what checking it would
 *   show this business, `url` = the site path that should be cited, or null
 * - questions: `name` = the prompt, `tag` = stage (`problem` | `compare` | `decide`, the
 *   topic stage ids), `detail` = its shape (`search` | `question` | `situation`) or '',
 *   `url` = the site path that should answer it, or null
 */
export interface SetupRow {
  name: string
  detail: string
  url: string | null
  tag: string | null
  tier?: CompetitorTier | null
}

/** A row in a section card. `origin: 'user'` rows (typed, or an AI row the user edited)
 * are never replaced by Find more or Redo. */
export interface SetupItem extends SetupRow {
  /** Opaque, stable within the draft. */
  id: string
  origin: 'ai' | 'user'
  /** Ticked: saved. Unticked rows stay visible and are not saved. */
  kept: boolean
  /** True when the user changed an AI row (it then counts as theirs). */
  edited: boolean
  /** Arrived with the latest ✦ Find more; shown marked "new" until the next action. */
  fresh: boolean
}

/** What Claude knows when it works on one section: the kept rows of the draft so far. */
export interface SetupContext {
  /** A bare host, such as `example.com`. */
  domain: string
  /** ISO 3166-1 alpha-2. */
  country: string
  language: string
  summary: string
  brands: readonly string[]
  products: readonly SetupRow[]
  buyers: readonly SetupRow[]
  triggers: readonly string[]
  competitors: readonly SetupRow[]
  switchingFrom: readonly string[]
  integrations: readonly string[]
  topic: string
  /** Step 8's mix: how many prompts of each shape to write. Absent: the default mix. */
  mix?: PromptMix
}

export interface SetupSectionEstimateRequest {
  section: SetupSectionId
}

/**
 * ✦ Find more (`more`: new rows only, never the ones in `current`) or ✦ Redo (`redo`: a
 * fresh list for the section, steered by `instruction`, the user's words).
 */
export interface SetupSectionRequest {
  section: SetupSectionId
  context: SetupContext
  mode: 'more' | 'redo'
  /** The user's words ("only US competitors"). Null for a plain Find more. */
  instruction: string | null
  /** The rows the section holds now, so Claude neither repeats nor contradicts them. */
  current: readonly SetupRow[]
  /**
   * Project rules saved from a Redo box so far (the draft's `rules`). Main adds the
   * project's own saved rules and puts them all in the prompt.
   */
  rules?: readonly string[]
}

/** The exact prompt one run would send, for "Edit the prompt" and "Copy for my ChatGPT". */
export interface SetupSectionPrompt {
  section: SetupSectionId
  prompt: string
  /** The reply's CSV header, in order (a text section: `text`). */
  columns: readonly string[]
  /** True when the run searches the web (competitors). */
  webSearch: boolean
}

export interface SetupSectionRunRequest extends SetupSectionRequest {
  /** The user's edited prompt. Null runs the default one. Main still adds the reply rules. */
  prompt: string | null
}

/** A chatbot's answer pasted back for one section. */
export interface SetupSectionReadRequest {
  section: SetupSectionId
  context: SetupContext
  current: readonly SetupRow[]
  text: string
}

export interface SetupSectionResult {
  section: SetupSectionId
  /** New or replacement rows, near-duplicates of `current` and of each other merged out. */
  rows: readonly SetupRow[]
  /** A text section's answer ("What X does", the topic). Null for a list. */
  text: string | null
  /** Plain warnings: nothing came back, columns missing, the web search could not run. */
  warnings: readonly string[]
}

export interface SetupSiteDraft {
  domain: string
  projectName: string
  userName: string
  /** A listed country code, or `other` with the code in `countryCode`. */
  country: string
  countryCode: string
  language: string
  languageCode: string
  location: string
}

export type SetupReadWay = 'claude' | 'chatgpt' | 'manual'

/** The whole v2 setup as typed and confirmed, kept across restarts. Never holds a secret. */
export interface SetupDraft {
  site: SetupSiteDraft
  /** Step 3's choice. Null until picked. */
  readWay: SetupReadWay | null
  /** True once the read finished (any way); steps 4–8 then open. */
  readDone: boolean
  summary: string
  summaryOrigin: 'ai' | 'user'
  lists: Readonly<Record<SetupListId, readonly SetupItem[]>>
  topic: string
  topicOrigin: 'ai' | 'user'
  /** The user's edited prompt per section, used for that section's later runs. */
  prompts: Readonly<Partial<Record<SetupSectionId, string>>>
  /** Step 7. */
  search: {
    provider: 'cloro' | 'serpapi'
    engines: readonly EngineId[]
    /** Days between scheduled checks. 0: on demand only. */
    everyDays: number
  }
  /** Step 8: how many prompts of each shape step 9 writes. */
  mix: PromptMix
  /** The mix step 9's prompts were last written with. Null before they were. */
  questionsMix: PromptMix | null
  /**
   * Redo words kept as project rules ("Save as a project rule"). Every later section
   * prompt carries them; Finish saves them to Project settings › Project rules.
   */
  rules?: readonly string[]
}

/** Step 8's "Finish and run the first check": saves what the profile does not hold. */
export interface FinishSetupRequest {
  summary: string
  /** Kept rows only. */
  products: readonly SetupRow[]
  competitors: readonly SetupRow[]
  buyers: readonly SetupRow[]
  triggers: readonly string[]
  topic: string
  questions: readonly SetupRow[]
  /** False: save and finish without checking now. */
  runFirstCheck: boolean
  /** The draft's project rules, saved to the project before anything else. */
  rules?: readonly string[]
}

export interface FinishSetupResult {
  state: OnboardingState
  projectId: string
  /** The first topic, or null when no topic was made. */
  topicId: string | null
  checkStarted: boolean
  /** Why the check did not start, in plain words. Null when it did (or was not asked). */
  message: string | null
}

export function isOnboardingStep(value: string): value is OnboardingStep {
  return ONBOARDING_STEPS.some((item) => item === value)
}

/** Invoke channels for this area. Each one is declared here only. */
export const onboardingChannels = {
  'onboarding:getState': invoke<OnboardingState>(),
  'onboarding:saveProfile': invokeWith<SaveProfileRequest, OnboardingState>(),
  'onboarding:finish': invoke<OnboardingState>(),
  /** Null when there is no draft or onboarding has finished. */
  'onboarding:getDraft': invoke<OnboardingDraft | null>(),
  /** Replaces the draft. `saved` is false once onboarding has finished (nothing is kept). */
  'onboarding:saveDraft': invokeWith<OnboardingDraft, { saved: boolean }>(),
  /** Onboarding v2 section cards: is Claude set up, and what one ✦ run costs. */
  'onboarding:sectionEstimate': invokeWith<SetupSectionEstimateRequest, HelpFillEstimate>(),
  'onboarding:sectionPrompt': invokeWith<SetupSectionRequest, SetupSectionPrompt>(),
  'onboarding:sectionRun': invokeWith<SetupSectionRunRequest, SetupSectionResult>(),
  'onboarding:sectionRead': invokeWith<SetupSectionReadRequest, SetupSectionResult>(),
  'onboarding:finishSetup': invokeWith<FinishSetupRequest, FinishSetupResult>()
} as const satisfies InvokeChannelSpecs
