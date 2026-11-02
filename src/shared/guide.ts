/**
 * The first-run guide (src/renderer/src/guide): a per-project "Getting started" checklist and
 * coachmarks that teach by having the user do the real thing. Main keeps the progress
 * in the project database (migration 049); the renderer owns the steps and lessons
 * (src/renderer/src/guide/constants.ts) and only stores their ids here.
 */

/** A step's saved state. A step with no row is not started. */
export const GUIDE_STEP_STATES = ['shown', 'done', 'skipped'] as const
export type GuideStepState = (typeof GUIDE_STEP_STATES)[number]

/**
 * Real things that happened, recorded once per project. Main records the ones that
 * are saves (a target page, a competitor, a check, a fix, an alert); the renderer
 * records the ones that are only seen (a question opened, the Sources tab, a copy).
 * A step completes when one of its signals is here, even if the guide was closed.
 */
export const GUIDE_SIGNALS = [
  'target-page-set',
  'competitor-saved',
  'check-started',
  'fix-logged',
  'alert-saved',
  'prompt-opened',
  'sources-viewed',
  'fix-brief-copied',
  'celebration-previewed',
  'theme-changed',
  'search-used',
  'page-fix-opened',
  'page-edits-opened',
  'report-opened'
] as const
export type GuideSignal = (typeof GUIDE_SIGNALS)[number]

/** The "Your first results are in" card: not shown yet, shown, accepted, or put off. */
export const GUIDE_KICKOFF_STATES = ['none', 'offered', 'started', 'later'] as const
export type GuideKickoff = (typeof GUIDE_KICKOFF_STATES)[number]

/** Step, signal and screen ids: short, lowercase, dashes. */
export const GUIDE_ID = /^[a-z][a-z0-9-]{0,79}$/

/** The longest saved route (a hash such as `#/topics/<id>?drawer=topic-page`). */
export const GUIDE_ROUTE_MAX = 2000

export function isGuideSignal(value: unknown): value is GuideSignal {
  return typeof value === 'string' && (GUIDE_SIGNALS as readonly string[]).includes(value)
}

export function isGuideStepState(value: unknown): value is GuideStepState {
  return typeof value === 'string' && (GUIDE_STEP_STATES as readonly string[]).includes(value)
}

export function isGuideKickoff(value: unknown): value is GuideKickoff {
  return typeof value === 'string' && (GUIDE_KICKOFF_STATES as readonly string[]).includes(value)
}

/** A route the guide may save and reopen: an in-app hash, never a web address. */
export function isGuideRoute(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('#/') &&
    value.length <= GUIDE_ROUTE_MAX &&
    !/[\s<>"`]/u.test(value)
  )
}

/** Where the user was when they left a step half-way: "Paused: Set your target page". */
export interface GuidePause {
  stepId: string
  /** The exact hash the step was on (topic, tab, open drawer), so Continue reopens it. */
  route: string
  /** ISO-8601 UTC. */
  at: string
}

/** One project's guide progress. */
export interface GuideProgress {
  projectId: string
  /** Steps with a saved state; every other step is not started. */
  steps: Readonly<Record<string, GuideStepState>>
  /** Signals seen in this project, oldest first. */
  signals: readonly GuideSignal[]
  /** The step the guide is on, or null when it is not running. */
  current: string | null
  paused: GuidePause | null
  /** "Hide guide": the pill and the checklist stay away until Resume. */
  hidden: boolean
  /** "Turn tips off": no page explainers and no kick-off card. */
  tipsOff: boolean
  kickoff: GuideKickoff
  /** Screens whose "What is this page?" card was closed. */
  explainersSeen: readonly string[]
}

/** An empty progress: what a project starts with and what Restart leaves. */
export function emptyGuideProgress(projectId: string): GuideProgress {
  return {
    projectId,
    steps: {},
    signals: [],
    current: null,
    paused: null,
    hidden: false,
    tipsOff: false,
    kickoff: 'none',
    explainersSeen: []
  }
}
