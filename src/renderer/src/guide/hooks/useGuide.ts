import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from 'react'
import type { GuideKickoff, GuideProgress, GuideSignal } from '@shared/guide'
import type { GuideUpdateRequest } from '@shared/ipc'
import { useChangeVersion } from '../../shell/changes'
import { closeDrawer, closeDrawersThen, useDrawerStack } from '../../shell/drawers'
import { drawerStack, screenHash } from '../../shell/drawerUrl'
import type { ShellLocation } from '../../shell/routes'
import type { GuideClient } from '../client'
import { GUIDE_DRAWER, stepById, stepsOf } from '../constants'
import { onGuideSignal } from '../signals'
import type { GuideFacts, GuideScreen, GuideStep, LessonId } from '../types'
import {
  applyPatch,
  finishStep,
  followingStep,
  guideCounts,
  lessonFor,
  lessonOrder,
  nextStep,
  onRoute,
  previousStep,
  stepStatus
} from '../utils/engine'
import { NO_FACTS } from '../utils/facts'
import { routeSignals, sameRoute, screenOf, screenOfHash } from '../utils/screens'

export type GuideAction = 'done' | 'skipped'

/**
 * A ref to the latest `value`, moved before any effect runs: the guide's cards
 * are children of the host, and a child's effect runs before its parent's.
 */
function useCurrent<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}

/** Everything the guide's pieces read and do. */
export interface GuideApi {
  projectId: string | null
  progress: GuideProgress | null
  facts: GuideFacts
  screen: GuideScreen | null
  counts: { done: number; total: number }
  /** The lesson for what is on screen (this screen, or its part), or null. */
  lesson: LessonId | null
  /** The running step (not paused), on its screen or on its way there. */
  current: GuideStep | null
  /**
   * True when `current` is done already and was opened again (Back, or "Show me"
   * on a done step): it stays on screen with Next instead of finishing again.
   */
  reviewing: boolean
  /** True while the checklist drawer is open over the screen. */
  checklistOpen: boolean
  /** The lesson just finished, for the "Lesson done" card. */
  lessonEnd: LessonId | null
  startLesson: (lesson: LessonId) => void
  startStep: (stepId: string) => void
  /** Continue: the paused step at its exact route, else the next suggested step. */
  continueGuide: () => void
  finish: (state: GuideAction) => void
  back: () => void
  /** Next on a step in review: the step after it, also in review when it is done. */
  next: () => void
  /** Esc, or "Pause" on a coachmark: keep the step and the route for later. */
  pause: () => void
  skipLesson: (lesson: LessonId) => void
  hide: () => void
  /** Settings › Resume guide: show the guide again and continue. */
  resume: () => void
  restart: () => Promise<void>
  setTipsOff: (off: boolean) => void
  resetExplainers: () => void
  seeExplainer: (screen: GuideScreen) => void
  setKickoff: (choice: GuideKickoff) => void
  dismissLessonEnd: () => void
}

function now(): string {
  return new Date().toISOString()
}

/** Closes the checklist drawer when it is open, leaving any drawer under it. */
function leaveChecklist(): void {
  const depth = drawerStack(window.location.hash).findIndex((entry) => entry.id === GUIDE_DRAWER)
  if (depth >= 0) closeDrawer(depth)
}

/**
 * The guide's state for the open project: its saved progress, what the data
 * says, and the step running now. A route change records what it shows (a
 * question opened), completes a step that waited for it, and pauses a step the
 * user walked away from, keeping the exact route for Continue.
 */
export function useGuide({
  client,
  projectId,
  location,
  revision
}: {
  client: GuideClient
  projectId: string | null
  location: ShellLocation
  /** Moves when results or pages change, so the facts reload. */
  revision: number
}): GuideApi {
  const [progress, setProgress] = useState<GuideProgress | null>(null)
  const [facts, setFacts] = useState<GuideFacts>(NO_FACTS)
  const [lessonEnd, setLessonEnd] = useState<LessonId | null>(null)
  // A done step opened again (Back, "Show me"), so it is not finished a second time.
  const [review, setReview] = useState<string | null>(null)
  const { hash, stack } = useDrawerStack()
  const screen = screenOf(location)
  // A fix logged or removed anywhere: the Fix a page and Did it work? steps re-read it.
  const fixesVersion = useChangeVersion('fixes')
  // Read by handlers and route effects; `save` also moves it at once, before the render.
  const progressRef = useCurrent(progress)
  const factsRef = useCurrent(facts)
  const reviewRef = useCurrent(review)
  const lastRoute = useRef<string | null>(null)
  // Where a guide navigation is going: a route on the way there (closing a drawer
  // steps back first) is not the user walking away.
  const pendingRoute = useRef<string | null>(null)

  /**
   * Opens `route` for a step: stays when its screen is already open (for a step that
   * needs its exact route, when that route is open), else goes there.
   */
  const goTo = useCallback((route: string, step: GuideStep): void => {
    const here = window.location.hash
    if (screenOfHash(here) === step.screen && (!step.exact || sameRoute(screenHash(here), route))) {
      lastRoute.current = screenHash(here) === here ? here : lastRoute.current
      leaveChecklist()
      return
    }
    pendingRoute.current = route
    closeDrawersThen(route)
  }, [])

  useEffect(() => {
    if (projectId === null) return
    let live = true
    client.get(projectId).then(
      (next) => {
        if (live) setProgress(next)
      },
      () => {
        if (live) setProgress(null)
      }
    )
    const off = client.onChanged((next) => {
      if (next.projectId === projectId) setProgress(next)
    })
    return () => {
      live = false
      off()
      setProgress(null)
      setLessonEnd(null)
      setReview(null)
      lastRoute.current = null
    }
  }, [client, projectId])

  useEffect(() => {
    if (projectId === null) return
    let live = true
    client.facts(projectId).then(
      (next) => {
        if (live) setFacts(next)
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [client, projectId, revision, fixesVersion])

  const save = useCallback(
    (patch: Omit<GuideUpdateRequest, 'projectId'>): void => {
      const before = progressRef.current
      if (projectId === null || before === null) return
      const next = applyPatch(before, patch, now())
      progressRef.current = next
      setProgress(next)
      client.update({ projectId, ...patch }).then(
        (saved) => setProgress((current) => (current === next ? saved : current)),
        () => undefined
      )
    },
    [client, projectId, progressRef]
  )

  const record = useCallback(
    (signals: readonly GuideSignal[]): void => {
      const before = progressRef.current
      if (projectId === null || before === null) return
      const fresh = signals.filter((signal) => !before.signals.includes(signal))
      if (fresh.length === 0) return
      const next = { ...before, signals: [...before.signals, ...fresh] }
      progressRef.current = next
      setProgress(next)
      for (const signal of fresh) {
        client.signal({ projectId, signal }).then(
          (saved) => setProgress((current) => (current === next ? saved : current)),
          () => undefined
        )
      }
    },
    [client, projectId, progressRef]
  )

  /** Saves `stepId` as done or skipped and moves on in its lesson (or ends it). */
  const complete = useCallback(
    (stepId: string, state: GuideAction): void => {
      const before = progressRef.current
      if (before === null) return
      const { patch, next } = finishStep(before, factsRef.current, stepId, state)
      save(patch)
      setReview(null)
      reviewRef.current = null
      lastRoute.current = null
      if (next) {
        const route = next.route(factsRef.current)
        if (route) goTo(route, next)
      } else {
        setLessonEnd(stepById(stepId)?.lesson ?? null)
      }
    },
    [save, goTo, progressRef, factsRef, reviewRef]
  )

  /** Opens `stepId` at its route; a step already done opens in review. */
  const startStep = useCallback(
    (stepId: string): void => {
      const step = stepById(stepId)
      const route = step?.route(factsRef.current) ?? null
      const before = progressRef.current
      if (!step || route === null || before === null) return
      setLessonEnd(null)
      lastRoute.current = null
      // Moved before the save, so the done step's own effect never finishes it again.
      const done = stepStatus(step, before, factsRef.current) === 'done'
      reviewRef.current = done ? stepId : null
      setReview(done ? stepId : null)
      const saved = before.steps[stepId]
      save({
        current: stepId,
        paused: null,
        hidden: false,
        ...(saved === undefined || saved === 'skipped' ? { steps: { [stepId]: 'shown' } } : {})
      })
      goTo(route, step)
    },
    [save, goTo, progressRef, factsRef, reviewRef]
  )

  // A window-only signal (a brief copied) from any screen.
  useEffect(() => onGuideSignal((signal) => record([signal])), [record])

  const loaded = progress !== null
  // A route change: record what it shows, then complete, follow or pause the running step.
  useEffect(() => {
    const current = progressRef.current
    if (current === null) return
    // The hash, not `location`: the drawer store can move a render before the shell's route.
    const here = screenOfHash(hash)
    const signals = routeSignals(hash)
    record(signals)
    const pending = pendingRoute.current
    if (pending !== null) {
      // On the way to a step's screen: wait until it is there.
      if (screenOfHash(hash) !== screenOfHash(pending)) return
      pendingRoute.current = null
    }
    const onGuideDrawer = drawerStack(hash).some((entry) => entry.id === GUIDE_DRAWER)
    const reviewing = reviewRef.current
    if (reviewing !== null && reviewing === current.current && current.paused === null) {
      // A done step looked at again: walking away just ends the look, nothing to pause.
      if (here !== stepById(reviewing)?.screen) {
        reviewRef.current = null
        setReview(null)
        save({ current: null })
      }
      return
    }
    const outcome = onRoute({
      progress: current,
      facts: factsRef.current,
      screen: here,
      hash,
      signals,
      lastRoute: lastRoute.current
    })
    if (outcome.kind === 'on-step' && !onGuideDrawer) lastRoute.current = outcome.route
    else if (outcome.kind === 'pause')
      save({ paused: { stepId: outcome.stepId, route: outcome.route } })
    // `done` is handled below, with signals main pushes.
    // A route change runs this, and the first load (the route the step is open on);
    // progress and facts are read from refs.
  }, [hash, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // The running step completed by a real thing (a route, a save main pushed, the data).
  const currentStep = stepById(progress?.current)
  const currentDone =
    progress !== null && currentStep !== null && stepStatus(currentStep, progress, facts) === 'done'
  useEffect(() => {
    if (!currentDone || !currentStep || progress === null) return
    // Opened again on purpose (Back, "Show me"): it stays until Next.
    if (reviewRef.current === currentStep.id) return
    // Follow on only when the user is at the step (or already where the next one is);
    // done while paused or elsewhere (a save in another window), tick it quietly.
    const here = screenOfHash(window.location.hash)
    const next = finishStep(progress, facts, currentStep.id, 'done').next
    // The lesson's last step (a question opened from a topic) ends the lesson wherever it lands.
    if (
      progress.paused === null &&
      (here === currentStep.screen || here === next?.screen || next === null)
    ) {
      complete(currentStep.id, 'done')
      return
    }
    save({ steps: { [currentStep.id]: 'done' }, current: null, paused: null })
  }, [currentDone]) // eslint-disable-line react-hooks/exhaustive-deps

  const continueGuide = useCallback((): void => {
    const current = progressRef.current
    if (current === null) return
    // A pause saved on a step that no longer exists (an older guide) is forgotten.
    if (current.paused && stepById(current.paused.stepId) !== null) {
      const { stepId, route } = current.paused
      setLessonEnd(null)
      lastRoute.current = route
      save({ current: stepId, paused: null, hidden: false })
      const here = window.location.hash
      if (here === route) {
        leaveChecklist()
        return
      }
      if (screenOfHash(here) !== screenOfHash(route)) pendingRoute.current = route
      closeDrawersThen(route)
      return
    }
    const step = nextStep(current, factsRef.current)
    if (step) startStep(step.id)
  }, [save, startStep, progressRef, factsRef])

  const api = useMemo<GuideApi>(() => {
    const running =
      progress !== null && progress.paused === null && !progress.hidden ? currentStep : null
    const reviewing = running !== null && review === running.id
    return {
      projectId,
      progress,
      facts,
      screen,
      lesson: lessonFor(screen, hash),
      counts: progress ? guideCounts(progress, facts) : { done: 0, total: 0 },
      current: running && (!currentDone || reviewing) ? running : null,
      reviewing,
      checklistOpen: stack.some((entry) => entry.id === GUIDE_DRAWER),
      lessonEnd,
      startStep,
      startLesson: (lesson) => {
        const step = progress ? nextStep(progress, facts, { lesson }) : null
        if (step) startStep(step.id)
      },
      continueGuide,
      finish: (state) => {
        if (running) complete(running.id, state)
      },
      back: () => {
        const previous = running ? previousStep(running.id, facts) : null
        if (previous) startStep(previous.id)
      },
      next: () => {
        if (!running) return
        const following = followingStep(running.id, facts)
        if (following) {
          startStep(following.id)
          return
        }
        setReview(null)
        reviewRef.current = null
        save({ current: null, paused: null })
        setLessonEnd(running.lesson)
      },
      pause: () => {
        if (!running) return
        save({
          paused: { stepId: running.id, route: lastRoute.current ?? window.location.hash }
        })
      },
      skipLesson: (lesson) => {
        if (!progress) return
        const steps: Record<string, 'skipped'> = {}
        for (const step of stepsOf(lesson)) {
          if (stepStatus(step, progress, facts) === 'todo') steps[step.id] = 'skipped'
        }
        const stops = currentStep?.lesson === lesson
        save({ steps, ...(stops ? { current: null, paused: null } : {}) })
      },
      hide: () => {
        save({
          hidden: true,
          ...(running
            ? { paused: { stepId: running.id, route: lastRoute.current ?? window.location.hash } }
            : {})
        })
      },
      resume: () => {
        save({ hidden: false })
        continueGuide()
      },
      restart: async () => {
        if (projectId === null) return
        setLessonEnd(null)
        lastRoute.current = null
        setProgress(await client.restart(projectId))
      },
      setTipsOff: (off) => save({ tipsOff: off }),
      resetExplainers: () => save({ explainersReset: true }),
      seeExplainer: (seen) => save({ explainerSeen: seen }),
      setKickoff: (choice) => {
        save({ kickoff: choice })
        if (choice === 'started' && progress) {
          // The lesson for the screen the card is on (Summary or a topic), else the first.
          const first = lessonFor(screen, hash) ?? lessonOrder(progress, facts)[0]
          const step = first ? nextStep(progress, facts, { lesson: first }) : null
          if (step) startStep(step.id)
        }
      },
      dismissLessonEnd: () => setLessonEnd(null)
    }
  }, [
    client,
    projectId,
    progress,
    facts,
    screen,
    hash,
    stack,
    lessonEnd,
    review,
    reviewRef,
    currentStep,
    currentDone,
    startStep,
    continueGuide,
    complete,
    save
  ])
  return api
}
