import type { JSX } from 'react'
import { openDrawer } from '../../shell/drawers'
import { EXPLAINERS, GUIDE_DRAWER, lessonById } from '../constants'
import { useGuideContext } from '../context'
import { lessonCounts } from '../utils/engine'

/**
 * The top bar's guide button: a small progress ring and this screen's lesson
 * progress ("2/4"), about the size of the other icon buttons; the tooltip holds the
 * overall count. It opens the guide drawer (`?drawer=guide`). Shown once a project
 * has results, until Hide guide.
 */
export function GuidePill(): JSX.Element | null {
  const guide = useGuideContext()
  if (!guide) return null
  const { progress, facts, counts, checklistOpen, lesson } = guide.api
  if (!progress || progress.hidden) return null
  const started = Object.keys(progress.steps).length > 0
  if (!facts.hasResults && !started) return null
  const paused = progress.paused !== null
  const here = lesson ? lessonCounts(lesson, progress, facts) : null
  const shown = here ?? counts
  const share = shown.total ? Math.round((shown.done / shown.total) * 100) : 0
  const overall = `${counts.done} of ${counts.total} steps done in all`
  const title = lesson ? lessonById(lesson).title : null
  // Starts with "Guide 2/4" so the spoken name holds the visible "2/4".
  const label = here
    ? `Guide ${here.done}/${here.total}: ${title}, ${here.done} of ${here.total} done; ${overall}${paused ? ', paused' : ''}`
    : `Guide: ${overall}${paused ? ', paused' : ''}`
  const tip = paused
    ? `Guide paused: continue where you left off · ${overall}`
    : here
      ? `${title}: ${here.done} of ${here.total} done · ${overall}`
      : `Guide: ${overall}`
  return (
    <button
      type="button"
      className="topbar-guide"
      aria-label={label}
      aria-expanded={checklistOpen}
      data-tip={tip}
      data-testid="guide-pill"
      data-guide="topbar-guide"
      onClick={() => openDrawer(GUIDE_DRAWER)}
    >
      <svg className="topbar-guide-ring" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle className="topbar-guide-track" cx="10" cy="10" r="7.5" />
        <circle
          className="topbar-guide-arc"
          cx="10"
          cy="10"
          r="7.5"
          pathLength={100}
          strokeDasharray={`${share} 100`}
          transform="rotate(-90 10 10)"
        />
      </svg>
      {here ? (
        <span className="topbar-guide-text num">
          {here.done}/{here.total}
        </span>
      ) : null}
      {paused ? <span className="topbar-guide-dot" aria-hidden="true" /> : null}
    </button>
  )
}

/** The "?" after the breadcrumb: "What is this page?" again, on any screen that has one. */
export function PageHelpButton(): JSX.Element | null {
  const guide = useGuideContext()
  if (!guide?.api.screen || !EXPLAINERS[guide.api.screen]) return null
  return (
    <button
      type="button"
      className="topbar-help"
      aria-label="What is this page?"
      data-tip="What is this page?"
      data-testid="guide-help"
      data-guide="topbar-help"
      onClick={guide.openExplainer}
    >
      ?
    </button>
  )
}
