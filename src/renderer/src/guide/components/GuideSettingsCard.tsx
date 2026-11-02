import { useState, type JSX } from 'react'
import { useHashQuery } from '../../utils/hashQuery'
import { Button, Confirm, Panel } from '../../ui'
import { LESSONS, stepById } from '../constants'
import { useGuideContext } from '../context'
import { lessonFinished } from '../utils/engine'

/**
 * Settings › General (`#/settings?tab=general`): resume or restart the
 * guide (one short lesson per screen) for the open project, bring the page explainers back,
 * or turn tips off. Restart asks first (`&guide=restart`) and clears this
 * project's guide only.
 */
export function GuideSettingsCard(): JSX.Element {
  const guide = useGuideContext()
  const [query, setQuery] = useHashQuery(['guide'] as const)
  const [note, setNote] = useState('')
  const api = guide?.api
  const progress = api?.progress ?? null

  if (!api || !progress) {
    return (
      <div className="stg-grid">
        <Panel title="Getting started guide" className="stg-span-6">
          <p className="muted">Open a project to see its guide.</p>
        </Panel>
      </div>
    )
  }

  const paused = progress.paused ? stepById(progress.paused.stepId) : null
  const { done, total } = api.counts
  const asking = query.guide === 'restart'
  const lessonsDone = LESSONS.filter((lesson) =>
    lessonFinished(lesson.id, progress, api.facts)
  ).length

  return (
    <div className="stg-grid" data-guide="settings-guide">
      <Panel title="Guide" className="stg-span-6">
        <p className="gd-settings-line num" data-testid="guide-settings-progress">
          {done} of {total} steps done
          {paused ? ` · paused at “${paused.title}”` : progress.hidden ? ' · hidden' : ''}
        </p>
        <p className="muted num">
          {lessonsDone} of {LESSONS.length} lessons finished. Each screen has its own short lesson:
          open the guide in the top bar on any screen.
        </p>
        <div className="gd-settings-actions">
          <Button
            variant="primary"
            icon="play"
            onClick={() => {
              api.resume()
              setNote('')
            }}
          >
            {paused ? 'Resume guide' : done > 0 ? 'Continue guide' : 'Start guide'}
          </Button>
          <Button onClick={() => setQuery({ guide: 'restart' })}>Restart guide</Button>
        </div>
        <p role="status" aria-live="polite" className="data-note">
          {note}
        </p>
      </Panel>
      <Panel title="Page tips" className="stg-span-6">
        <label className="radio" htmlFor="stg-guide-tips">
          <input
            id="stg-guide-tips"
            type="checkbox"
            checked={!progress.tipsOff}
            aria-describedby="stg-guide-tips-h"
            onChange={(event) => api.setTipsOff(!event.target.checked)}
          />
          <span className="stack-tight">
            <span className="field-label">Show tips</span>
            <span className="hint" id="stg-guide-tips-h">
              A short “What is this page?” card the first time you open each screen.
            </span>
          </span>
        </label>
        <div className="gd-settings-actions">
          <Button
            onClick={() => {
              api.resetExplainers()
              setNote('Page explainers will show again on each screen.')
            }}
          >
            Show page explainers again
          </Button>
        </div>
      </Panel>
      {asking ? (
        <Confirm
          title="Restart the guide?"
          body="Every step goes back to not done for this project, and the page explainers show again. Your results and settings stay as they are."
          confirmLabel="Restart guide"
          tone="default"
          onCancel={() => setQuery({ guide: null })}
          onConfirm={() => {
            setQuery({ guide: null })
            void api.restart().then(() => setNote('The guide starts again from the beginning.'))
          }}
          testId="guide-restart-confirm"
        />
      ) : null}
    </div>
  )
}
