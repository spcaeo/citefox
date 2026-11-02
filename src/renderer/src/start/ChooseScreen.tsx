import { useMemo, useState, type JSX } from 'react'
import { errorText } from '../components/errorText'
import { currentClientMode } from '../onboarding/flags'
import { navigateHash, sectionHash, startHash } from '../shell/routes'
import { createTopicsClient, type TopicsClient } from '../topics/wizard/client'
import { startWay } from '../topics/wizard/startWay'
import { Button, Chip, UiIcon, WayList, type WayOption } from '../ui'
import { readStartChoice, saveStartChoice, type StartChoice } from './choice'
import { takeProjectCreated } from './createdNotice'
import type { StartClient } from './client'
import { startExamples, type StartWay } from './examples'
import { StartFooter, StartFrame } from './StartFrame'
import { WAYS_TO_START_LABEL, startWayOptions } from './ways'
import type { StartProject } from './types'
import './choose.css'

const THEN = 'Then shows what it found and a starting plan. You start the first check.'

/**
 * "How do you want to start?" (`#/start/choose`, owner feedback 6): shown
 * after onboarding instead of starting setup on its own. Two equal choices,
 * each with examples from the user's own profile: CiteFox sets the site up
 * (free, no searches) or the user picks one of the ways to track (the shared
 * WayList, the same chooser as "What do you want to track?"). The choice is
 * remembered per project; coming back here is how the user changes it.
 */
export function ChooseScreen({
  client,
  project,
  searchesLeft,
  topics
}: {
  client: StartClient
  project: StartProject
  searchesLeft: number | null
  /** Tests only. Production picks the topics client from the client mode. */
  topics?: TopicsClient
}): JSX.Element {
  const examples = useMemo(() => startExamples(project), [project])
  const [choice, setChoice] = useState<StartChoice>(
    () => readStartChoice(project.id) ?? 'autopilot'
  )
  const [way, setWay] = useState<StartWay | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Shown once, right after New project → Create.
  const [created] = useState(() => takeProjectCreated())

  const ways: readonly WayOption<StartWay>[] = useMemo(() => startWayOptions(project), [project])

  const pickWay = (next: StartWay): void => {
    setWay(next)
    setChoice('self')
  }

  async function onContinue(): Promise<void> {
    setError(null)
    saveStartChoice(project.id, choice)
    if (choice === 'autopilot') {
      // The setup screen starts the homework (or follows a run already going).
      navigateHash(startHash('setup'))
      return
    }
    setBusy(true)
    try {
      // A setup started earlier stops after its current step.
      const progress = await client.progress({ projectId: project.id }).catch(() => null)
      if (progress?.phase === 'running') await client.stop({ projectId: project.id })
      if (way === null || way === 'gsc') {
        navigateHash(sectionHash('add'))
        return
      }
      const topicsClient = topics ?? createTopicsClient(currentClientMode())
      navigateHash(await startWay(topicsClient, project.id, way))
    } catch (cause) {
      setError(errorText(cause, 'Could not open that way to start.'))
    } finally {
      setBusy(false)
    }
  }

  const auto = examples.autopilot
  return (
    <StartFrame
      projectName={project.name}
      domain={project.domain}
      searchesLeft={searchesLeft}
      title="How do you want to start?"
      subtitle="Pick one. You can switch any time."
      footer={
        <StartFooter note="No searches are used until you start a check.">
          <Button
            variant="primary"
            iconEnd="arrow-right"
            busy={busy}
            onClick={() => void onContinue()}
          >
            Continue
          </Button>
        </StartFooter>
      }
    >
      {created ? (
        <p className="sf-created" role="status">
          <strong>{created} is ready.</strong> No pages yet, so nothing is scheduled. Pick how to
          start, or{' '}
          <a className="sf-link" href={sectionHash('import-pages')}>
            import pages
          </a>{' '}
          from a sitemap, a CSV file or pasted URLs.
        </p>
      ) : null}
      {error ? (
        <div className="sf-error" role="alert">
          <span>{error}</span>
        </div>
      ) : null}
      <fieldset className="ch-grid ui-cols-2">
        <legend className="sr-only">How do you want to start?</legend>
        <label className={choice === 'autopilot' ? 'ch-card on' : 'ch-card'}>
          <span className="ch-head">
            <span className="ch-icon ch-icon-ai" aria-hidden="true">
              <UiIcon name="sparkle" size={16} />
            </span>
            <span className="ch-titles">
              <span className="ch-title-row">
                <span className="ch-title" id="ch-auto-title">
                  Let CiteFox set up my site
                </span>
                <Chip tone="fox" size="sm">
                  Recommended
                </Chip>
              </span>
              <span className="ch-meta" id="ch-auto-meta">
                Free · about a minute · no searches
              </span>
            </span>
            <input
              type="radio"
              name="ch-start"
              className="ch-radio"
              checked={choice === 'autopilot'}
              onChange={() => setChoice('autopilot')}
              aria-labelledby="ch-auto-title"
              aria-describedby="ch-auto-meta"
            />
          </span>
          <span className="ch-rows" id="ch-auto-steps">
            {[auto.reads, auto.pages, auto.rivals, auto.questions, THEN].map((line, index) => (
              <span className="ch-row" key={line}>
                <span className="ch-num num" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="ch-row-text">{line}</span>
              </span>
            ))}
          </span>
          <span className="ch-foot">You can edit everything as it goes, pause or skip.</span>
        </label>

        <div className={choice === 'self' ? 'ch-card on' : 'ch-card'}>
          <label className="ch-head">
            <span className="ch-icon" aria-hidden="true">
              <UiIcon name="list" size={16} />
            </span>
            <span className="ch-titles">
              <span className="ch-title" id="ch-self-title">
                I’ll choose what to track myself
              </span>
              <span className="ch-meta" id="ch-self-meta">
                {WAYS_TO_START_LABEL} · you decide when to check
              </span>
            </span>
            <input
              type="radio"
              name="ch-start"
              className="ch-radio"
              checked={choice === 'self'}
              onChange={() => setChoice('self')}
              aria-labelledby="ch-self-title"
              aria-describedby="ch-self-meta"
            />
          </label>
          <WayList
            label="Way to start (optional)"
            role="group"
            name="ch-way"
            options={ways}
            value={choice === 'self' ? way : null}
            onChange={pickWay}
          />
          <span className="ch-foot">Pick one to go straight to it, or continue to see all.</span>
        </div>
      </fieldset>
    </StartFrame>
  )
}
