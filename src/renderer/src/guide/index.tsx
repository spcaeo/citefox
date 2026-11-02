import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import { helpDrawerReady, openHelp } from '../assistant/openHelp'
import { DrawerLevel } from '../shell/DrawerLevel'
import { useDrawerEntry, useDrawerStack } from '../shell/drawers'
import type { ShellLocation } from '../shell/routes'
import { guideClient, type GuideClient } from './client'
import { ExplainerCard, KickoffCard, LessonEndCard } from './components/Cards'
import { Coachmark } from './components/Coachmark'
import { GuideChecklist } from './components/GuideChecklist'
import { StepHint } from './components/StepHint'
import { EXPLAINERS, GUIDE_DRAWER, lessonById } from './constants'
import { GuideContext, useGuideContext, type GuideContextValue } from './context'
import { useGuide } from './hooks/useGuide'
import type { GuideScreen } from './types'
import {
  lessonFinished,
  lessonOrder,
  nextStep,
  previousStep,
  stepPosition,
  stepWhy
} from './utils/engine'
import { pressSelectors } from './utils/press'
import './guide.css'

export { GuideSettingsCard } from './components/GuideSettingsCard'
export { GuidePill, PageHelpButton } from './components/TopBarGuide'

/**
 * The guide for the open project (a step-by-step onboarding, one short lesson per
 * screen): the top bar's "2/4" pill and "?", the guide drawer with this screen's
 * lesson,
 * coachmarks on the real buttons, a "What is this page?" card on each screen's
 * first visit, and the kick-off card once the first results are in. Inside a
 * drawer a step's click opened, a small pointer takes over from the coachmark;
 * closing the drawer brings the coachmark back. Wrap the
 * shell in it; put `<GuideOverlays />` inside the app frame.
 */
export function GuideHost({
  projectId,
  location,
  revision,
  client,
  children
}: {
  projectId: string | null
  location: ShellLocation
  revision: number
  /** Tests only. */
  client?: GuideClient
  children: ReactNode
}): JSX.Element {
  const source = useMemo(() => client ?? guideClient(), [client])
  const api = useGuide({ client: source, projectId, location, revision })
  const [forced, setForced] = useState<GuideScreen | null>(null)
  const [seenScreen, setSeenScreen] = useState(api.screen)
  if (seenScreen !== api.screen) {
    setSeenScreen(api.screen)
    setForced(null)
  }
  const value = useMemo<GuideContextValue>(
    () => ({
      api,
      openExplainer: () => setForced(api.screen),
      forced,
      closeExplainer: () => setForced(null)
    }),
    [api, forced]
  )
  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>
}

/** The guide's drawer, coachmark and cards. Renders nothing outside a `GuideHost`. */
export function GuideOverlays(): JSX.Element | null {
  const guide = useGuideContext()
  const drawer = useDrawerEntry(GUIDE_DRAWER)
  const { stack } = useDrawerStack()
  const api = guide?.api
  const progress = api?.progress ?? null
  const screen = api?.screen ?? null

  const kickoffDue =
    api !== undefined &&
    progress !== null &&
    api.facts.hasResults &&
    !progress.tipsOff &&
    !progress.hidden &&
    (progress.kickoff === 'none' || progress.kickoff === 'offered') &&
    progress.current === null &&
    (screen === 'summary' || screen === 'topic')
  const setKickoff = api?.setKickoff
  const kickoff = progress?.kickoff
  useEffect(() => {
    if (kickoffDue && kickoff === 'none') setKickoff?.('offered')
  }, [kickoffDue, kickoff, setKickoff])

  if (!guide || !api || !progress) return null

  const checklist = drawer ? (
    <DrawerLevel depth={drawer.depth}>
      <GuideChecklist api={api} onClose={() => drawer.close()} />
    </DrawerLevel>
  ) : null

  const step = api.current
  if (step && stack.length === 0 && screen === step.screen) {
    const position = stepPosition(step.id)
    return (
      <>
        {checklist}
        <Coachmark
          key={step.id}
          step={step}
          index={position.index}
          total={position.total}
          lessonTitle={lessonById(step.lesson).title}
          why={stepWhy(step, progress, api.facts)}
          note={step.note?.(api.facts) ?? null}
          target={pressSelectors(step, api.facts)}
          reviewing={api.reviewing}
          canBack={previousStep(step.id, api.facts) !== null}
          onBack={api.back}
          onSkip={() => api.finish('skipped')}
          onDone={() => api.finish('done')}
          onNext={api.next}
          onPause={api.pause}
        />
      </>
    )
  }

  // A drawer the step opened (the target page picker): only a pointer, no dim.
  if (step?.hints && stack.length > 0 && !api.checklistOpen && screen === step.screen) {
    return <StepHint key={step.id} hints={step.hints} />
  }

  let card: JSX.Element | null = null
  if (api.lessonEnd) {
    // This screen's other lesson first (What to fix ends with the page fix drawer open),
    // then the suggested order.
    const here =
      api.lesson !== null &&
      api.lesson !== api.lessonEnd &&
      !lessonFinished(api.lesson, progress, api.facts)
        ? api.lesson
        : null
    const next =
      here ??
      lessonOrder(progress, api.facts).find(
        (lesson) => lesson !== api.lessonEnd && !lessonFinished(lesson, progress, api.facts)
      ) ??
      null
    card = (
      <LessonEndCard
        lesson={api.lessonEnd}
        next={next}
        onNext={() => {
          api.dismissLessonEnd()
          if (next) api.startLesson(next)
        }}
        onClose={api.dismissLessonEnd}
      />
    )
  } else if (kickoffDue) {
    card = (
      <KickoffCard
        topicName={api.facts.topic?.name ?? null}
        onStart={() => api.setKickoff('started')}
        onLater={() => api.setKickoff('later')}
        onStopTips={() => api.setTipsOff(true)}
      />
    )
  } else if (screen && EXPLAINERS[screen] && step === null) {
    const explainer = EXPLAINERS[screen]
    const auto = !progress.tipsOff && !progress.explainersSeen.includes(screen)
    if (explainer && (guide.forced === screen || auto)) {
      // "Show me" starts the lesson for what is on screen (this screen, or its part).
      const lesson = api.lesson
      const close = (): void => {
        guide.closeExplainer()
        if (auto) api.seeExplainer(screen)
      }
      card = (
        <ExplainerCard
          key={screen}
          explainer={explainer}
          {...(lesson && helpDrawerReady()
            ? { onLearnMore: () => openHelp(lessonById(lesson).help) }
            : {})}
          canShow={lesson !== null && nextStep(progress, api.facts, { lesson }) !== null}
          onShowMe={() => {
            close()
            if (lesson) api.startLesson(lesson)
          }}
          onClose={close}
          {...(auto && guide.forced !== screen ? { onStopTips: () => api.setTipsOff(true) } : {})}
        />
      )
    }
  }

  return (
    <>
      {checklist}
      {card}
    </>
  )
}
