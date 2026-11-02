import { useEffect, useState, type JSX } from 'react'
import type { StartJourney } from '@shared/ipc'
import { GETTING_STARTED_STEPS, readDismissed, stripState, writeDismissed } from './stripModel'
import { IconButton } from '../ui'
import { UiIcon } from '../ui/UiIcon'
import type { StartClient } from './client'
import './extras.css'

/**
 * "Getting started" (owner feedback 4): a one-row strip over every screen until
 * the first results exist. Each step is a link to its journey screen; the strip
 * can be hidden per project.
 */
export function GettingStartedStrip({
  client,
  projectId,
  revision
}: {
  client: StartClient
  projectId: string | null
  revision: number
}): JSX.Element | null {
  const [journey, setJourney] = useState<StartJourney | null>(null)
  const [hidden, setHidden] = useState<string | null>(null)

  useEffect(() => {
    if (projectId === null) return
    let cancelled = false
    client.status({ projectId }).then(
      (next) => {
        if (!cancelled) setJourney(next)
      },
      () => {
        if (!cancelled) setJourney(null)
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, revision])

  if (projectId === null || journey === null || journey.projectId !== projectId) return null
  // Only on the journey: a project set up another way (no plan) gets no strip.
  if (!journey.hasPlan || journey.hasResults || hidden === projectId || readDismissed(projectId))
    return null

  return (
    <section className="gs" aria-label="Getting started">
      <span className="gs-title">Getting started</span>
      <ol className="gs-steps">
        {GETTING_STARTED_STEPS.map((step) => {
          const state = stripState(step.id, journey)
          return (
            <li key={step.id} className={`gs-step gs-${state}`}>
              <a href={step.href} aria-current={state === 'current' ? 'step' : undefined}>
                <span className="gs-mark" aria-hidden="true">
                  {state === 'done' ? <UiIcon name="check" size={12} /> : null}
                </span>
                {step.label}
                {state === 'done' ? <span className="sr-only"> (done)</span> : null}
              </a>
            </li>
          )
        })}
      </ol>
      <IconButton
        icon="x"
        size="sm"
        label="Hide getting started"
        data-tip="Hide getting started"
        onClick={() => {
          writeDismissed(projectId)
          setHidden(projectId)
        }}
      />
    </section>
  )
}
