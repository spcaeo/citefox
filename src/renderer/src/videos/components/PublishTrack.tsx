import { useState, type JSX } from 'react'
import type { VideoChecklistItem, VideoIdea } from '@shared/domain'
import type { ActionState } from '../types'
import { SectionHead } from '../../ui'
import { CHECKLIST, checklistLabel, formatDate, ofAnswers, toggleChecklist } from '../utils/model'

/** FR-18.6 step 5: the checklist to go through before publishing. */
export function PublishSection({
  idea,
  checklistState,
  onChecklist
}: {
  idea: VideoIdea
  checklistState: ActionState
  onChecklist: (next: VideoChecklistItem[]) => void
}): JSX.Element {
  // Ticks show at once; the saved list replaces them when the call returns or fails.
  const base = `${idea.checklist.join(',')}|${checklistState.error ? (checklistState.message ?? '') : ''}`
  const [local, setLocal] = useState({ base, checks: idea.checklist })
  if (local.base !== base) setLocal({ base, checks: idea.checklist })
  const checks = local.base === base ? local.checks : idea.checklist
  const done = checks.length
  return (
    <section className="yt-step" id="yt-step-publish" aria-labelledby="yt-publish-h">
      <SectionHead level={3} id="yt-publish-h" title="5 · Publish" />
      <fieldset className="yt-checklist">
        <legend>
          Before you publish{' '}
          <span className="yt-muted">
            · {done} of {CHECKLIST.length} done
          </span>
        </legend>
        {CHECKLIST.map((item) => (
          <label key={item} className="yt-check">
            <input
              type="checkbox"
              checked={checks.includes(item)}
              onChange={(event) => {
                const next = toggleChecklist(checks, item, event.target.checked)
                setLocal({ base, checks: next })
                onChecklist(next)
              }}
            />
            {checklistLabel(item)}
          </label>
        ))}
        {checklistState.error ? (
          <p className="yt-error yt-small" role="alert">
            {checklistState.message}
          </p>
        ) : null}
      </fieldset>
    </section>
  )
}

/**
 * FR-18.7 step 6: the live video's link, then whether this idea's overviews
 * cite it. The drawer footer's Start tracking submits the form.
 */
export function TrackSection({
  idea,
  formId,
  url,
  missing,
  trackState,
  onUrl,
  onSubmit
}: {
  idea: VideoIdea
  formId: string
  url: string
  /** Start tracking was pressed with no link. */
  missing: boolean
  trackState: ActionState
  onUrl: (url: string) => void
  onSubmit: () => void
}): JSX.Element {
  return (
    <section className="yt-step" id="yt-step-track" aria-labelledby="yt-track-h">
      <SectionHead level={3} id="yt-track-h" title="6 · Track" />
      <form
        id={formId}
        className="stack-tight"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <p className="yt-small">
          Paste the video&apos;s link once it&apos;s live. Every scheduled check then reports
          whether this idea&apos;s overviews cite it.
        </p>
        <label className="yt-label" htmlFor={`yt-url-${idea.id}`}>
          YouTube URL
        </label>
        <input
          id={`yt-url-${idea.id}`}
          className="ui-input yt-url-input"
          type="url"
          inputMode="url"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          aria-invalid={missing || trackState.error}
          aria-describedby={`yt-url-msg-${idea.id}`}
          onChange={(event) => onUrl(event.target.value)}
        />
        <p
          id={`yt-url-msg-${idea.id}`}
          className={missing || trackState.error ? 'yt-error yt-small' : 'yt-muted yt-small'}
          role={missing || trackState.error ? 'alert' : 'status'}
        >
          {missing
            ? "Paste the video's YouTube URL first."
            : (trackState.message ??
              (idea.trackingStartedAt
                ? `Tracking since ${formatDate(idea.trackingStartedAt)}`
                : ''))}
        </p>
      </form>
      {idea.tracking ? (
        <dl className="yt-track">
          <div>
            <dt>Before you added the video</dt>
            <dd>{ofAnswers(idea.tracking.beforeCiting, idea.tracking.beforeAios)}</dd>
          </div>
          <div>
            <dt>Now · {formatDate(idea.tracking.nowAt)}</dt>
            <dd>{ofAnswers(idea.tracking.nowCiting, idea.tracking.nowAios)}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  )
}
