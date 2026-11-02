import { useState, type JSX } from 'react'
import { Button, Drawer } from '../../ui'
import { LESSONS, lessonById, stepById, stepsOf } from '../constants'
import type { GuideApi } from '../hooks/useGuide'
import type { GuideStep, LessonId, StepStatus } from '../types'
import {
  lessonCounts,
  lessonFinished,
  lessonOrder,
  nextStep,
  stepStatus,
  stepWhy
} from '../utils/engine'
import { helpDrawerReady, openHelp } from '../../assistant/openHelp'

const STATUS_LABEL: Readonly<Record<StepStatus, string>> = {
  done: 'Done',
  skipped: 'Skipped',
  todo: 'To do',
  unavailable: 'Nothing to show yet'
}

/**
 * The guide drawer (`?drawer=guide`), over any screen: this screen's short lesson
 * first (3 to 5 one-line steps, each with Show me, and Learn more for its help
 * topic), a paused step from elsewhere with Continue, and the overall progress as a
 * small "12 of 60" with a link to All lessons. On a screen with no lesson, All
 * lessons is open.
 */
export function GuideChecklist({
  api,
  onClose
}: {
  api: GuideApi
  onClose: () => void
}): JSX.Element | null {
  const { progress, facts, counts, lesson } = api
  const [showAll, setShowAll] = useState(lesson === null)
  if (!progress) return null
  const paused = progress.paused ? stepById(progress.paused.stepId) : null
  const status = (step: GuideStep): StepStatus => stepStatus(step, progress, facts)
  const allOpen = showAll || lesson === null

  return (
    <Drawer
      id="guide"
      title="Guide"
      subtitle="A short lesson for the screen you are on."
      className="gd-drawer"
      focusOnOpen="close"
      onClose={onClose}
      testId="guide-checklist"
      footer={{
        cancel: 'Close',
        secondary: { label: 'Hide guide', icon: 'eye', onClick: api.hide, testId: 'guide-hide' }
      }}
    >
      <div className="gd-list">
        {paused && paused.lesson !== lesson ? (
          <div className="gd-callout gd-paused" data-testid="guide-paused">
            <p className="gd-callout-text">
              <span className="gd-callout-title">Paused: {paused.title}</span>
              <span className="gd-muted"> · {lessonById(paused.lesson).title}</span>
            </p>
            <Button size="sm" variant="primary" onClick={api.continueGuide}>
              Continue
            </Button>
          </div>
        ) : null}

        {lesson ? <HereLesson id={lesson} api={api} status={status} /> : null}

        <div className="gd-overall">
          <p className="gd-muted num" data-testid="guide-overall">
            {counts.done} of {counts.total} steps done in all
          </p>
          {lesson ? (
            <Button
              size="sm"
              variant="text"
              aria-expanded={allOpen}
              aria-controls="gd-all-lessons"
              onClick={() => setShowAll((open) => !open)}
            >
              {allOpen ? 'Hide lessons' : 'All lessons'}
            </Button>
          ) : null}
        </div>

        {allOpen ? <AllLessons api={api} current={lesson} /> : null}
      </div>
    </Drawer>
  )
}

/** This screen's lesson: title, "2 of 4", its one-line steps, Start and Learn more. */
function HereLesson({
  id,
  api,
  status
}: {
  id: LessonId
  api: GuideApi
  status: (step: GuideStep) => StepStatus
}): JSX.Element | null {
  const { progress, facts } = api
  if (!progress) return null
  const lesson = lessonById(id)
  const steps = stepsOf(id)
  const { done, total } = lessonCounts(id, progress, facts)
  const finished = lessonFinished(id, progress, facts)
  // The data's first reason to do a step of this lesson now.
  const why = steps.map((step) => stepWhy(step, progress, facts)).find(Boolean) ?? null
  const pausedHere = progress.paused !== null && stepById(progress.paused.stepId)?.lesson === id
  const titleId = `gd-here-${id}`
  return (
    <section className="gd-here" aria-labelledby={titleId} data-testid="guide-here">
      <div className="gd-here-head">
        <p className="gd-eyebrow">This screen</p>
        <h3 id={titleId} className="gd-here-title">
          {lesson.title}
        </h3>
        <p className="gd-muted">
          <span className="num">
            {done} of {total} done
          </span>{' '}
          · {lesson.blurb}
        </p>
      </div>
      {why ? (
        <p className="gd-why" data-testid="guide-why">
          {why}
        </p>
      ) : null}
      <ol className="gd-steps">
        {steps.map((step) => {
          const state = status(step)
          return (
            <li key={step.id} className={`gd-step gd-step-${state}`}>
              <span className="gd-step-mark" aria-hidden="true" />
              <span className="gd-step-title">{step.title}</span>
              <span className="sr-only"> ({STATUS_LABEL[state]})</span>
              {state === 'unavailable' ? (
                <span className="gd-step-later">Later</span>
              ) : (
                <Button
                  size="sm"
                  variant="text"
                  onClick={() => api.startStep(step.id)}
                  aria-label={`Show me: ${step.title}`}
                >
                  Show me
                </Button>
              )}
            </li>
          )
        })}
      </ol>
      <div className="gd-here-actions">
        {finished ? (
          <span className="gd-muted">Lesson done. Show me opens any step again.</span>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={pausedHere ? api.continueGuide : () => api.startLesson(id)}
          >
            {done === 0 && !pausedHere ? 'Start lesson' : 'Continue'}
          </Button>
        )}
        {helpDrawerReady() ? (
          <Button size="sm" variant="text" onClick={() => openHelp(lesson.help)}>
            Learn more
          </Button>
        ) : null}
        {finished ? null : (
          <Button size="sm" variant="text" onClick={() => api.skipLesson(id)}>
            Skip lesson
          </Button>
        )}
      </div>
    </section>
  )
}

/** Every lesson, one line each: title, "2 of 4", and Open (it goes to that screen). */
function AllLessons({ api, current }: { api: GuideApi; current: LessonId | null }): JSX.Element {
  const { progress, facts } = api
  const order = progress ? lessonOrder(progress, facts) : LESSONS.map((lesson) => lesson.id)
  return (
    <ol className="gd-all" id="gd-all-lessons" aria-label="All lessons">
      {order.map((id) => {
        const lesson = lessonById(id)
        const counts = progress ? lessonCounts(id, progress, facts) : { done: 0, total: 0 }
        const finished = progress ? lessonFinished(id, progress, facts) : false
        const canStart = progress ? nextStep(progress, facts, { lesson: id }) !== null : false
        return (
          <li
            key={id}
            className={finished ? 'gd-all-row gd-all-done' : 'gd-all-row'}
            aria-current={id === current ? 'true' : undefined}
          >
            <span className="gd-step-mark" aria-hidden="true" />
            <span className="gd-all-title">{lesson.title}</span>
            <span className="gd-muted num">
              {counts.done}/{counts.total}
            </span>
            {canStart ? (
              <Button
                size="sm"
                variant="text"
                onClick={() => api.startLesson(id)}
                aria-label={`Open lesson: ${lesson.title}`}
              >
                Open
              </Button>
            ) : (
              <span className="gd-step-later">{finished ? 'Done' : 'Later'}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
