import type { GuideProgress, GuideSignal } from '@shared/guide'
import type { GuideUpdateRequest } from '@shared/ipc'
import { LESSONS, STEPS, lessonsOn, stepById, stepsOf } from '../constants'
import type { GuideFacts, GuideScreen, GuideStep, LessonId, StepStatus } from '../types'

/**
 * The guide's rules, without React: a step's status from the saved progress, the
 * signals seen and the project's data; which lesson and step come next; and what a
 * route change means for the step on screen (done, still on it, or paused).
 */

/** Done by a click, a real save anywhere, or the data; then skipped; then to do or nothing to show. */
export function stepStatus(
  step: GuideStep,
  progress: Pick<GuideProgress, 'steps' | 'signals'>,
  facts: GuideFacts,
  extraSignals: readonly GuideSignal[] = []
): StepStatus {
  const saved = progress.steps[step.id]
  if (saved === 'done') return 'done'
  const signals = new Set([...progress.signals, ...extraSignals])
  if (step.doneOn?.some((signal) => signals.has(signal))) return 'done'
  if (step.doneWhen?.(facts) === true) return 'done'
  if (saved === 'skipped') return 'skipped'
  return step.route(facts) === null ? 'unavailable' : 'todo'
}

/** "12 of 60": done steps over every step, in every lesson. */
export function guideCounts(
  progress: Pick<GuideProgress, 'steps' | 'signals'>,
  facts: GuideFacts
): { done: number; total: number } {
  const done = STEPS.filter((step) => stepStatus(step, progress, facts) === 'done').length
  return { done, total: STEPS.length }
}

/** "2 of 4": one lesson's done steps over its steps. */
export function lessonCounts(
  lesson: LessonId,
  progress: Pick<GuideProgress, 'steps' | 'signals'>,
  facts: GuideFacts
): { done: number; total: number } {
  const steps = stepsOf(lesson)
  const done = steps.filter((step) => stepStatus(step, progress, facts) === 'done').length
  return { done, total: steps.length }
}

/**
 * The lesson for what is on screen: the screen's lesson whose part the route is
 * (Fixes' page fix drawer, an open report), else the screen's main lesson; null on
 * a screen the guide does not teach.
 */
export function lessonFor(screen: GuideScreen | null, hash: string): LessonId | null {
  if (screen === null) return null
  const lessons = lessonsOn(screen)
  return (
    lessons.find((lesson) => lesson.part?.(hash) === true)?.id ??
    lessons.find((lesson) => lesson.part === undefined)?.id ??
    lessons[0]?.id ??
    null
  )
}

/** The data's reason to do a step now, or null (only for steps still to do). */
export function stepWhy(
  step: GuideStep,
  progress: Pick<GuideProgress, 'steps' | 'signals'>,
  facts: GuideFacts
): string | null {
  return stepStatus(step, progress, facts) === 'todo' ? (step.why?.(facts) ?? null) : null
}

export function lessonFinished(
  lesson: LessonId,
  progress: Pick<GuideProgress, 'steps' | 'signals'>,
  facts: GuideFacts
): boolean {
  return stepsOf(lesson).every((step) => stepStatus(step, progress, facts) !== 'todo')
}

/**
 * Lessons in the order to suggest them. The Summary always comes first; then a
 * lesson the data gives a reason for ("Twilio is cited but not on your list"), then
 * the default order. Finished lessons go last.
 */
export function lessonOrder(
  progress: Pick<GuideProgress, 'steps' | 'signals'>,
  facts: GuideFacts
): LessonId[] {
  const rank = (id: LessonId): number => {
    if (lessonFinished(id, progress, facts)) return 3
    if (id === 'summary') return 0
    return stepsOf(id).some((step) => stepWhy(step, progress, facts) !== null) ? 1 : 2
  }
  return LESSONS.map((lesson, index) => ({ id: lesson.id, index }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.index - b.index)
    .map((item) => item.id)
}

/** The next step to do: in `lesson` when given (after `after`), else in the suggested order. */
export function nextStep(
  progress: Pick<GuideProgress, 'steps' | 'signals'>,
  facts: GuideFacts,
  options: { lesson?: LessonId; after?: string | null } = {}
): GuideStep | null {
  const lessons = options.lesson ? [options.lesson] : lessonOrder(progress, facts)
  for (const lesson of lessons) {
    const steps = stepsOf(lesson)
    const from = options.after ? steps.findIndex((step) => step.id === options.after) + 1 : 0
    const found = steps.slice(from).find((step) => stepStatus(step, progress, facts) === 'todo')
    if (found) return found
  }
  return null
}

/** The step before `stepId` in its lesson that has something to show, for Back. */
export function previousStep(stepId: string, facts: GuideFacts): GuideStep | null {
  const step = stepById(stepId)
  if (!step) return null
  const steps = stepsOf(step.lesson)
  const at = steps.findIndex((item) => item.id === stepId)
  return (
    steps
      .slice(0, Math.max(0, at))
      .reverse()
      .find((item) => item.route(facts) !== null) ?? null
  )
}

/** The step after `stepId` in its lesson that has something to show, for Next after Back. */
export function followingStep(stepId: string, facts: GuideFacts): GuideStep | null {
  const step = stepById(stepId)
  if (!step) return null
  const steps = stepsOf(step.lesson)
  const at = steps.findIndex((item) => item.id === stepId)
  return steps.slice(at + 1).find((item) => item.route(facts) !== null) ?? null
}

/** "Step 2 of 5" inside the step's lesson. */
export function stepPosition(stepId: string): { index: number; total: number } {
  const step = stepById(stepId)
  if (!step) return { index: 0, total: 0 }
  const steps = stepsOf(step.lesson)
  return { index: steps.findIndex((item) => item.id === stepId) + 1, total: steps.length }
}

export type RouteOutcome =
  /** No step running, or it is paused: nothing to do. */
  | { kind: 'idle' }
  /** The step is on this screen: remember the exact hash for a later Continue. */
  | { kind: 'on-step'; route: string }
  /** The route itself completed the step (a question opened). */
  | { kind: 'done'; stepId: string }
  /** The user went elsewhere half-way: pause quietly, keeping the step's last route. */
  | { kind: 'pause'; stepId: string; route: string }

/**
 * What a route change means for the running step. `lastRoute` is the last hash the
 * step was on screen at; the pause keeps it, so Continue reopens the same topic,
 * tab and drawer.
 */
export function onRoute(input: {
  progress: GuideProgress
  facts: GuideFacts
  screen: GuideScreen | null
  hash: string
  signals: readonly GuideSignal[]
  lastRoute: string | null
}): RouteOutcome {
  const { progress, facts } = input
  const step = stepById(progress.current)
  if (!step || progress.paused !== null) return { kind: 'idle' }
  const status = stepStatus(step, progress, facts, input.signals)
  if (status === 'done') return { kind: 'done', stepId: step.id }
  if (status !== 'todo') return { kind: 'idle' }
  if (input.screen === step.screen) return { kind: 'on-step', route: input.hash }
  const route = input.lastRoute ?? step.route(facts)
  return route ? { kind: 'pause', stepId: step.id, route } : { kind: 'idle' }
}

/** `progress` with `patch` applied, the same way main saves it (for an instant screen). */
export function applyPatch(
  progress: GuideProgress,
  patch: Omit<GuideUpdateRequest, 'projectId'>,
  now: string
): GuideProgress {
  const steps = { ...progress.steps }
  for (const [id, state] of Object.entries(patch.steps ?? {})) {
    if (state === null) delete steps[id]
    else steps[id] = state
  }
  const explainers = patch.explainersReset ? [] : [...progress.explainersSeen]
  if (patch.explainerSeen !== undefined && !explainers.includes(patch.explainerSeen)) {
    explainers.push(patch.explainerSeen)
  }
  return {
    ...progress,
    steps,
    explainersSeen: explainers.sort(),
    ...(patch.current !== undefined ? { current: patch.current } : {}),
    ...(patch.paused !== undefined
      ? { paused: patch.paused === null ? null : { ...patch.paused, at: now } }
      : {}),
    ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
    ...(patch.tipsOff !== undefined ? { tipsOff: patch.tipsOff } : {}),
    ...(patch.kickoff !== undefined ? { kickoff: patch.kickoff } : {})
  }
}

/**
 * Finishing `stepId` (done or skipped): the patch that saves it and moves on to the
 * next step of its lesson, or ends the lesson. `next` is null at the lesson's end.
 */
export function finishStep(
  progress: GuideProgress,
  facts: GuideFacts,
  stepId: string,
  state: 'done' | 'skipped'
): { patch: Omit<GuideUpdateRequest, 'projectId'>; next: GuideStep | null } {
  const step = stepById(stepId)
  const saved = { ...progress, steps: { ...progress.steps, [stepId]: state } }
  const next = step ? nextStep(saved, facts, { lesson: step.lesson, after: stepId }) : null
  return {
    patch: {
      steps: { [stepId]: state, ...(next ? { [next.id]: 'shown' as const } : {}) },
      current: next?.id ?? null,
      paused: null
    },
    next
  }
}
