import type { GuideSignal } from '@shared/guide'
import type { HelpTopicId } from '@shared/help-topics'

export type { HelpTopicId }

/**
 * The guide's lessons: one short lesson per screen (Fixes, Reports and Settings have
 * one per part), in their default order.
 */
export type LessonId =
  | 'summary'
  | 'topics'
  | 'topic'
  | 'prompt'
  | 'questions'
  | 'competitors'
  | 'citations'
  | 'fixes'
  | 'fix-brief'
  | 'did-it-work'
  | 'pages'
  | 'history'
  | 'reports'
  | 'report'
  | 'alerts'
  | 'settings'
  | 'branding'

export interface GuideLesson {
  id: LessonId
  /** The screen every step of the lesson is on. */
  screen: GuideScreen
  title: string
  /** One plain line under the title in the checklist. */
  blurb: string
  /** The help topic "Learn more" opens. */
  help: HelpTopicId
  /**
   * On a screen with more than one lesson: true when the open route is this lesson's
   * part of it (Fixes' page fix drawer, an open report). The screen's lesson without
   * `part` is the one shown elsewhere on that screen.
   */
  part?: (hash: string) => boolean
}

/** Main screens with a lesson or a "What is this page?" card. */
export type GuideScreen =
  | 'summary'
  | 'topic'
  | 'prompt'
  | 'topics'
  | 'questions'
  | 'competitors'
  | 'citations'
  | 'fixes'
  | 'history'
  | 'reports'
  | 'alerts'
  | 'settings'
  | 'pages'

/**
 * What the guide knows about the project's real data, so it only suggests steps
 * that make sense ("6 questions cite your site but no target page is set").
 */
export interface GuideFacts {
  /** A check has finished somewhere in the project. */
  hasResults: boolean
  /** The topic the lessons use: the first-run topic, else the first checked one. */
  topic: {
    id: string
    name: string
    marketId: string | null
    targetPage: string | null
  } | null
  /** A question worth opening: an AI Overview showed, likeliest win first. */
  prompt: { id: string; label: string } | null
  /** Questions whose AI answer cites the own site. */
  citesOwn: number
  /** A question with no page that answers it yet. */
  noPage: { id: string; label: string } | null
  /** The site cited most instead of you that is not on the competitor list. */
  rival: { domain: string; answers: number; promptId: string } | null
  /** One page fix of each kind on Fixes › What to fix (ids), most searches first. */
  pageFix: { improve: string | null; owner: string | null; create: string | null }
  /** A logged fix (the newest), for the Did it work? steps. */
  loggedFix: string | null
  /** Topics in the project (not removed). */
  topics: number
  /** Saved competitors. */
  competitors: number
}

/**
 * A pointer inside what a step's click opens (a drawer, tab or menu): a small
 * bubble on the next control to use.
 */
export interface GuideHint {
  /** CSS selector of the control, usually `[data-guide="…"]`. */
  anchor: string
  /** One short line: what to do with it ("Click Save target page"). */
  text: string
  /** Where the bubble sits; it moves when there is no room. Default: below. */
  side?: 'bottom' | 'top' | 'right' | 'left'
}

/** One step: where it is, what it points at, what it says and what completes it. */
export interface GuideStep {
  id: string
  lesson: LessonId
  screen: GuideScreen
  title: string
  /** One line: what this is and why it matters (two short sentences at most). */
  body: string
  /** The real action that completes the step ("Click Set target page"). Absent: "Got it". */
  action?: string
  /** CSS selector of the real element, usually `[data-guide="…"]`. */
  anchor: string
  /**
   * The exact control to click for this project's data (the likeliest question's
   * row, the rival's button), best first. It pulses; without it, the anchor's own
   * control does.
   */
  target?: (facts: GuideFacts) => readonly string[]
  /**
   * The words of the button that does the step's first click for the user
   * ("Open it for me"): it clicks the control, so the drawer, tab or page opens.
   * Absent on a step whose click is a choice only the user can make.
   */
  press?: string
  /**
   * Pointers inside what the click opened, in the order they are used. The last
   * one on screen and enabled shows ("Pick a page", then "Click Save").
   */
  hints?: readonly GuideHint[]
  /** Where the step happens with this project's data; null when there is nothing to show. */
  route: (facts: GuideFacts) => string | null
  /**
   * True when the step needs its exact route, not just its screen (a tab, or a
   * drawer kept in the screen's URL such as Fixes' `?pf=`): starting it opens the
   * route even when the screen is already open.
   */
  exact?: boolean
  /** The element is inside a drawer: the coachmark sits over the drawer. */
  layer?: 'drawer'
  /**
   * A kind line when the project has nothing to show here yet ("No fix logged yet:
   * it shows up here once you click I published this"); null when it has.
   */
  note?: (facts: GuideFacts) => string | null
  /** Real things that complete the step, wherever they happen. */
  doneOn?: readonly GuideSignal[]
  /** True when the project's data already shows the step done. */
  doneWhen?: (facts: GuideFacts) => boolean
  /** Why this step is worth doing now, from the data; null when there is no reason. */
  why?: (facts: GuideFacts) => string | null
}

export type StepStatus = 'done' | 'skipped' | 'todo' | 'unavailable'

/**
 * "What is this page?": two sentences. Its "Show me" starts the lesson for what is
 * on screen, and "Learn more" opens that lesson's help topic.
 */
export interface PageExplainer {
  title: string
  body: string
}
