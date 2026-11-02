import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { StartProgress, StartStepItem } from '@shared/ipc'
import { clockText, etaText } from '@shared/site-start'
import { errorText } from '../components/errorText'
import { navigateHash, sectionHash, startHash } from '../shell/routes'
import { HeaderActions } from '../components/HeaderActions'
import { Button, Chip, IconButton, Panel } from '../ui'
import { UiIcon } from '../ui/UiIcon'
import { saveStartChoice } from './choice'
import type { StartClient } from './client'
import { durationText, OPEN_FOUND_AFTER_MS, setupSubtitle, stepCounts, stepLine } from './model'
import { SetupKnown } from './SetupKnown'
import { ShareBar, StartClock, StartFooter, StartFrame } from './StartFrame'
import type { StartProject } from './types'
import './setup.css'

/**
 * "Setting up example.com" (Mockups/v2/journey-a A2a/A2b): the autopilot's
 * live step list with what each step found and how long it took, retries and
 * skips inline, the clock with the time left, Pause (an icon) and ⋯ with "Skip,
 * I'll set it up myself" (stops after the current step, opens the chooser), and on the
 * right what CiteFox knows so far. Nothing here spends a search.
 */
export function SetupScreen({
  client,
  project,
  searchesLeft
}: {
  client: StartClient
  project: StartProject
  searchesLeft: number | null
}): JSX.Element {
  const [progress, setProgress] = useState<StartProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const started = useRef(false)

  const run = useCallback(
    (force: boolean) => {
      setError(null)
      client.homework({ projectId: project.id, ...(force ? { force: true } : {}) }).then(
        () => {
          window.setTimeout(() => navigateHash(startHash()), OPEN_FOUND_AFTER_MS)
        },
        (cause: unknown) => {
          void client.progress({ projectId: project.id }).then((latest) => {
            if (latest) setProgress(latest)
            if (latest?.phase !== 'stopped') setError(errorText(cause, 'Setup stopped.'))
          })
        }
      )
    },
    [client, project.id]
  )

  useEffect(
    () =>
      client.onChanged((next) => {
        if (next.projectId === project.id) setProgress(next)
      }),
    [client, project.id]
  )

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Opening setup is choosing "Let CiteFox set up my site" for this project.
    saveStartChoice(project.id, 'autopilot')
    let cancelled = false
    void Promise.all([
      client.progress({ projectId: project.id }),
      client.get({ projectId: project.id })
    ]).then(
      ([latest, plan]) => {
        if (cancelled) return
        if (latest) setProgress(latest)
        if (latest?.phase === 'running') {
          // Already running (opened again): follow it; the run's promise is shared.
          run(false)
        } else if (plan !== null && latest === null) {
          navigateHash(startHash())
        } else if (latest?.phase !== 'stopped') {
          run(false)
        }
      },
      (cause: unknown) => {
        if (!cancelled) setError(errorText(cause, 'Could not start setup.'))
      }
    )
    return () => {
      cancelled = true
      // Not started yet: let the next mount start it (StrictMode mounts twice in dev).
      started.current = false
    }
  }, [client, project.id, run])

  const running = progress?.phase === 'running'
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  const items = progress?.items ?? []
  const counts = stepCounts(items)
  const elapsed = progress
    ? running
      ? now - Date.parse(progress.startedAt)
      : progress.elapsedMs
    : 0
  const done = progress?.phase === 'done'
  const stopped = progress?.phase === 'stopped'
  const share = counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100)

  return (
    <StartFrame
      step="read"
      projectName={project.name}
      domain={project.domain}
      searchesLeft={searchesLeft}
      title={`Setting up ${project.domain}`}
      subtitle={setupSubtitle(progress)}
      aside={
        <>
          <StartClock
            clock={clockText(elapsed)}
            note={
              done
                ? 'done'
                : stopped
                  ? 'paused'
                  : `elapsed${progress?.etaSeconds != null ? ` · ${etaText(progress.etaSeconds) ?? ''}` : ''}`
            }
          />
          {stopped ? (
            <IconButton icon="play" label="Resume" data-tip="Resume" onClick={() => run(false)} />
          ) : (
            <IconButton
              icon="pause"
              label="Pause"
              data-tip="Pause"
              disabled={!running}
              onClick={() => void client.stop({ projectId: project.id }).then(setProgress)}
            />
          )}
          <HeaderActions
            moreLabel="Setup actions"
            more={[
              {
                id: 'su-skip',
                label: 'Skip, I’ll set it up myself',
                icon: 'arrow-right',
                onSelect: () => {
                  saveStartChoice(project.id, 'self')
                  void client
                    .stop({ projectId: project.id })
                    .finally(() => navigateHash(sectionHash('add')))
                }
              }
            ]}
          />
        </>
      }
      footer={
        <StartFooter
          onBack={() => navigateHash(startHash('choose'))}
          note={
            done
              ? '0 searches used · what we found opens now'
              : '0 searches used · opens on its own when done'
          }
        >
          <Button
            variant="primary"
            icon="arrow-right"
            disabled={!done}
            onClick={() => navigateHash(startHash())}
          >
            See what we found
          </Button>
        </StartFooter>
      }
    >
      {error ? (
        <div className="sf-error" role="alert">
          <span>{error}</span>
          <Button size="sm" onClick={() => run(false)}>
            Try again
          </Button>
        </div>
      ) : null}
      <div className="ui-layout-main-rail">
        <Panel
          title="What CiteFox is doing"
          padding={0}
          className="sf-flush"
          actions={
            <Chip
              size="sm"
              tone={stopped ? 'neutral' : progress?.phase === 'failed' ? 'warn' : 'ok'}
              dot={running}
            >
              {done
                ? 'Done'
                : stopped
                  ? 'Paused'
                  : progress?.phase === 'failed'
                    ? 'Stopped'
                    : 'Running'}
            </Chip>
          }
        >
          <div className="su-meter">
            <div
              role="progressbar"
              aria-label="Setup steps done"
              aria-valuemin={0}
              aria-valuemax={counts.total}
              aria-valuenow={counts.done}
            >
              <ShareBar percent={share} />
            </div>
            <p className="sf-faint su-count">{items.length > 0 ? stepLine(counts) : 'Starting…'}</p>
          </div>
          <ol className="su-steps" aria-label="Setup steps">
            {items.map((item) => (
              <StepRow key={item.id} item={item} />
            ))}
          </ol>
        </Panel>
        <SetupKnown
          progress={progress}
          client={client}
          project={project}
          onProgress={setProgress}
        />
      </div>
    </StartFrame>
  )
}

function StepRow({ item }: { item: StartStepItem }): JSX.Element {
  const running = item.state === 'running'
  return (
    <li
      className={running ? 'su-step su-step-running' : 'su-step'}
      aria-current={running ? 'step' : undefined}
    >
      <div className="su-step-main">
        <StateMark state={item.state} />
        <span className={item.state === 'pending' ? 'su-label sf-faint' : 'su-label'}>
          {item.label}
        </span>
        <span className="su-detail">
          {item.detail}
          {running && item.progress ? (
            <span className="su-inner">
              <ShareBar percent={(item.progress.done / Math.max(1, item.progress.total)) * 100} />
            </span>
          ) : null}
        </span>
        <span className="su-time num">
          {item.state === 'pending'
            ? `~${item.estimateSeconds} s`
            : running
              ? ''
              : durationText(item.durationMs)}
        </span>
      </div>
      {item.subItems.length > 0 ? (
        <ul className="su-subs">
          {item.subItems.map((sub) => (
            <li key={sub.label}>
              <span className={`su-sub-mark su-sub-${sub.state}`} aria-hidden="true">
                {sub.state === 'retried' ? '↻' : sub.state === 'skipped' ? '–' : '·'}
              </span>
              <span className="sf-mono">{sub.label}</span>
              <span className="su-detail">{sub.detail}</span>
              <Chip size="sm" tone={sub.state === 'retried' ? 'ok' : 'neutral'}>
                {sub.state === 'retried' ? 'OK' : sub.state === 'skipped' ? 'Skipped' : 'Reading'}
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function StateMark({ state }: { state: StartStepItem['state'] }): JSX.Element {
  if (state === 'ok') {
    return (
      <span className="su-mark su-mark-ok" aria-label="Done">
        <UiIcon name="check" size={12} />
      </span>
    )
  }
  if (state === 'warning' || state === 'failed') {
    return (
      <span
        className={`su-mark su-mark-${state}`}
        aria-label={state === 'failed' ? 'Failed' : 'Done with a note'}
      >
        !
      </span>
    )
  }
  if (state === 'running') return <span className="su-mark su-mark-running" aria-label="Running" />
  return <span className="su-mark su-mark-pending" aria-label="To do" />
}
