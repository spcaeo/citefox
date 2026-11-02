import { useState, type JSX } from 'react'
import { Button } from '../../ui'
import { lessonById } from '../constants'
import type { LessonId, PageExplainer } from '../types'
import { FloatCard } from './FloatCard'

/**
 * "Your first results are in": offered once, on Summary or a topic, after the first
 * check. "Don't show again" turns tips off as the card closes, whichever button closes it.
 */
export function KickoffCard({
  topicName,
  onStart,
  onLater,
  onStopTips
}: {
  topicName: string | null
  onStart: () => void
  onLater: () => void
  onStopTips: () => void
}): JSX.Element {
  const [stop, setStop] = useState(false)
  const later = (): void => {
    if (stop) onStopTips()
    onLater()
  }
  const start = (): void => {
    if (stop) onStopTips()
    onStart()
  }
  return (
    <FloatCard
      icon="sparkle"
      title="Your first results are in"
      closeLabel="Not now"
      onClose={later}
      testId="guide-kickoff"
      stop={{ checked: stop, onChange: setStop }}
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={later}>
            Later
          </Button>
          <Button size="sm" variant="primary" icon="play" onClick={start}>
            Start the guide
          </Button>
        </>
      }
    >
      <p>
        {topicName ? `CiteFox has checked ${topicName}. ` : ''}Want a 3-minute tour of what the
        numbers mean and what to do next? You can stop any time and pick up where you left off.
      </p>
    </FloatCard>
  )
}

/**
 * "What is this page?": the first visit to a screen, or the "?" in the top bar. A card
 * that opened by itself offers "Don't show again" (`onStopTips`), acted on as it closes.
 */
export function ExplainerCard({
  explainer,
  canShow,
  onShowMe,
  onLearnMore,
  onClose,
  onStopTips
}: {
  explainer: PageExplainer
  /** Opens the screen's help topic. */
  onLearnMore?: () => void
  /** False when the screen's lesson is done or has nothing to show. */
  canShow: boolean
  onShowMe: () => void
  onClose: () => void
  /** Present when the card opened by itself (not from the "?"). */
  onStopTips?: () => void
}): JSX.Element {
  const [stop, setStop] = useState(false)
  const close = (): void => {
    if (stop) onStopTips?.()
    onClose()
  }
  const showMe = (): void => {
    if (stop) onStopTips?.()
    onShowMe()
  }
  return (
    <FloatCard
      icon="compass"
      title={explainer.title}
      closeLabel="Close"
      onClose={close}
      testId="guide-explainer"
      {...(onStopTips ? { stop: { checked: stop, onChange: setStop } } : {})}
      actions={
        <>
          {onLearnMore ? (
            <Button size="sm" variant="text" onClick={onLearnMore}>
              Learn more
            </Button>
          ) : null}
          <Button size="sm" variant={canShow ? 'ghost' : 'primary'} onClick={close}>
            Got it
          </Button>
          {canShow ? (
            <Button size="sm" variant="primary" icon="play" onClick={showMe}>
              Show me
            </Button>
          ) : null}
        </>
      }
    >
      <p>{explainer.body}</p>
    </FloatCard>
  )
}

/** "Lesson done", with the next lesson the data suggests. */
export function LessonEndCard({
  lesson,
  next,
  onNext,
  onClose
}: {
  lesson: LessonId
  next: LessonId | null
  onNext: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <FloatCard
      icon="check"
      title={`Lesson done: ${lessonById(lesson).title}`}
      closeLabel="Close"
      onClose={onClose}
      testId="guide-lesson-done"
      over
      actions={
        next ? (
          <>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Later
            </Button>
            <Button size="sm" variant="primary" icon="play" onClick={onNext}>
              Next lesson
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={onClose}>
            Done
          </Button>
        )
      }
    >
      <p>
        {next
          ? `Up next: ${lessonById(next).title.replace(/[^?!]$/u, '$&.')} ${lessonById(next).blurb}`
          : 'That was the last lesson. The "?" at the top explains any page again.'}
      </p>
    </FloatCard>
  )
}
