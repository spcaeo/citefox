import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent
} from 'react'
import { usePrefersReducedMotion } from '../ui'
import { ConsoleLog } from './ConsoleLog'
import { activeJob, currentStage, formatDuration, promptFor, runningJobs } from './model'
import type { ConsoleStore } from './store'
import { useConsoleState } from './useConsoleState'
import type { ConsoleJob, ConsolePosition, ConsoleState } from './types'
import { useBottomClearance } from './useBottomClearance'
import { clampPosition, useDrag } from './useDrag'
import { activityHref } from '../start/activityHash'
import './console.css'

/** A clock that ticks once a second while `on`, for the elapsed times. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const tick = (): void => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [on])
  return now
}

function currentHash(): string {
  return typeof window === 'undefined' ? '#/' : window.location.hash
}

/** The sticky-footer height under the corner, as the `--wc-clear` the CSS adds to `bottom`. */
function clearStyle(clear: number): CSSProperties {
  return { '--wc-clear': `${clear}px` } as CSSProperties
}

function elapsedText(job: ConsoleJob, now: number, short: boolean): string {
  const took = formatDuration((job.endedAt ?? now) - job.startedAt)
  if (job.status !== 'running' || job.expectedMs === null) return took
  const expected = formatDuration(job.expectedMs)
  return short ? `${took} / ~${expected}` : `${took} / about ${expected}`
}

/**
 * The work console (approved mock-up, Main.dc.html and States.dc.html): one
 * floating DOS-style window over the app for every long job. Drag it by the
 * title bar; Escape or "_" minimises it to a pill in the corner; it opens for
 * new work, counts down and closes when everything is done (unless "Close when
 * done" is off or something failed), and the pill turns green or red and
 * shakes when a job ends while minimised (a still highlight with reduced motion).
 */
export function WorkConsole({ store }: { store: ConsoleStore }): JSX.Element | null {
  const state = useConsoleState(store)
  const running = runningJobs(state)
  const now = useNow(running.length > 0 || state.closingAt !== null)
  const clear = useBottomClearance(state.mode !== 'hidden')
  const job = activeJob(state)
  if (state.mode === 'hidden') return null
  if (state.mode === 'min') {
    return job ? (
      <ConsolePill
        state={state}
        job={job}
        running={running}
        now={now}
        store={store}
        clear={clear}
      />
    ) : null
  }
  return <ConsoleWindow state={state} job={job} now={now} store={store} clear={clear} />
}

function ConsoleWindow({
  state,
  job,
  now,
  store,
  clear
}: {
  state: ConsoleState
  job: ConsoleJob | null
  now: number
  store: ConsoleStore
  /** Pixels of sticky footer to stay above. */
  clear: number
}): JSX.Element {
  const frame = useRef<HTMLElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const onMove = useCallback(
    (position: ConsolePosition) => store.dispatch({ type: 'move', position }),
    [store]
  )
  const startDrag = useDrag(frame, onMove)
  const closingIn =
    state.closingAt === null ? null : Math.max(1, Math.ceil((state.closingAt - now) / 1000))

  // Newest line in view, unless the user scrolled up to read.
  const lineCount = job?.lines.length ?? 0
  useLayoutEffect(() => {
    const node = log.current
    if (!node) return
    const nearEnd = node.scrollHeight - node.scrollTop - node.clientHeight < 48
    if (nearEnd || lineCount <= 1) node.scrollTop = node.scrollHeight
  }, [lineCount, job?.id, job?.status, closingIn])

  // A window dragged to a spot that a smaller screen no longer has comes back on screen.
  useEffect(() => {
    const node = frame.current
    if (!node || state.position === null) return
    const fixed = clampPosition(
      state.position,
      { width: node.offsetWidth, height: node.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }
    )
    if (fixed.x !== state.position.x || fixed.y !== state.position.y) onMove(fixed)
  }, [state.position, onMove])

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    store.dispatch({ type: 'minimise' })
  }

  const style: CSSProperties =
    state.position === null
      ? clearStyle(clear)
      : { left: state.position.x, top: state.position.y, right: 'auto', bottom: 'auto' }
  const progress = job?.progress ?? null
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null

  return (
    <section
      ref={frame}
      className="wc"
      data-work-console
      role="dialog"
      aria-modal="false"
      aria-label="CiteFox work console"
      style={style}
      onKeyDown={onKeyDown}
      data-console-status={job?.status ?? 'idle'}
    >
      <div className="wc-bar" onPointerDown={startDrag} title="Drag to move">
        <span className="wc-glyph" aria-hidden="true">
          &gt;_
        </span>
        <span className="wc-title">{job?.title ?? 'Work console'}</span>
        {job ? <span className="wc-elapsed num">{elapsedText(job, now, false)}</span> : null}
        <button
          type="button"
          className="wc-icon"
          aria-label="Minimise the console"
          title="Minimise (Esc)"
          onClick={() => store.dispatch({ type: 'minimise' })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5 18h14" />
          </svg>
        </button>
        <button
          type="button"
          className="wc-icon"
          aria-label="Hide the console, the work keeps running"
          title="Hide"
          onClick={() => store.dispatch({ type: 'hide' })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {job && state.jobs.length > 1 ? (
        <JobTabs state={state} job={job} now={now} store={store} />
      ) : null}
      {job?.status === 'running' ? (
        <p className="wc-note" data-testid="wc-note">
          <b>Working in the background.</b> You don&apos;t need to do anything: keep using CiteFox,
          hide this window, or wait here.
        </p>
      ) : null}
      <div
        ref={log}
        className="wc-log"
        role="log"
        aria-live="polite"
        aria-label={`${job?.title ?? 'Work console'} log`}
        tabIndex={0}
      >
        {job ? (
          <ConsoleLog
            job={job}
            now={now}
            closingIn={closingIn}
            onRetry={() => store.retry(job)}
            onKeepOpen={() => store.dispatch({ type: 'keepOpen' })}
          />
        ) : (
          <>
            <p className="wc-line">
              <span className="wc-prompt">{promptFor(null, null)}</span> nothing is running
            </p>
            <p className="wc-line wc-dim">
              Checks, page reads and AI work show here, one line per stage, as they happen.
            </p>
          </>
        )}
      </div>
      <div className="wc-foot">
        {job && percent !== null && progress ? (
          <>
            <div
              className="wc-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-label={`${job.title}: ${progress.done} of ${progress.total}`}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <span className="wc-count num">
              {progress.done} of {progress.total}
            </span>
          </>
        ) : (
          <span className="wc-count wc-grow">
            {job === null
              ? 'idle'
              : job.status === 'running'
                ? `${runningJobs(state).length} running`
                : job.status === 'error'
                  ? 'stopped'
                  : 'done'}
          </span>
        )}
        <label className="wc-check">
          <input
            type="checkbox"
            checked={state.closeWhenDone}
            onChange={(event) =>
              store.dispatch({ type: 'setCloseWhenDone', value: event.target.checked })
            }
          />
          Close when done
        </label>
        <a className="wc-link wc-history" href={activityHref(currentHash())}>
          All activity
        </a>
        {job?.stop && job.status === 'running' ? (
          <button type="button" className="wc-btn" onClick={() => store.stop(job)}>
            Stop
          </button>
        ) : null}
      </div>
    </section>
  )
}

/** One tab per job: "Fill · 72 s", "Topic · 12 s". Arrow keys move between them. */
function JobTabs({
  state,
  job,
  now,
  store
}: {
  state: ConsoleState
  job: ConsoleJob
  now: number
  store: ConsoleStore
}): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const jobs = [...state.jobs].reverse().slice(0, 6)
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = jobs[(index + step + jobs.length) % jobs.length]
    if (!next) return
    store.dispatch({ type: 'select', jobId: next.id })
    refs.current[(index + step + jobs.length) % jobs.length]?.focus()
  }
  return (
    <div className="wc-tabs" role="tablist" aria-label="Jobs">
      {jobs.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => {
            refs.current[index] = node
          }}
          type="button"
          role="tab"
          aria-selected={item.id === job.id}
          tabIndex={item.id === job.id ? 0 : -1}
          className="wc-tab"
          data-status={item.status}
          onClick={() => store.dispatch({ type: 'select', jobId: item.id })}
          onKeyDown={(event) => onKey(event, index)}
        >
          <span className="wc-tab-mark" aria-hidden="true">
            {item.status === 'running' ? '▸' : item.status === 'error' ? '×' : '✓'}
          </span>
          {item.title}
          <span className="num"> · {formatDuration((item.endedAt ?? now) - item.startedAt)}</span>
        </button>
      ))}
    </div>
  )
}

/** The minimised console: the current prompt and time, green or red with a shake when a job ends. */
function ConsolePill({
  state,
  job,
  running,
  now,
  store,
  clear
}: {
  state: ConsoleState
  job: ConsoleJob
  running: readonly ConsoleJob[]
  now: number
  store: ConsoleStore
  clear: number
}): JSX.Element {
  const reduced = usePrefersReducedMotion()
  const shown = running.at(-1) ?? job
  const tone = state.attention === 'none' ? 'busy' : state.attention
  const ended = tone !== 'busy' ? job : shown
  const text =
    tone === 'busy'
      ? running.length > 1
        ? `${running.length} running · ${elapsedText(shown, now, true)}`
        : elapsedText(shown, now, true)
      : `${ended.title} ${tone === 'error' ? 'failed' : 'done'}${
          ended.summary && tone !== 'error' ? ` · ${ended.summary}` : ''
        } · ${formatDuration((ended.endedAt ?? now) - ended.startedAt)}`
  const motion =
    tone === 'busy' || state.shakeKey === 0 ? '' : reduced ? ' wc-pill-glow' : ' wc-pill-shake'
  return (
    <>
      <button
        // A new key replays the shake for each job that ends.
        key={`pill-${state.shakeKey}`}
        type="button"
        className={`wc-pill wc-pill-${tone}${motion}`}
        data-work-console
        style={clearStyle(clear)}
        aria-label={`Open the work console. ${tone === 'busy' ? `${running.length} running` : text}`}
        onClick={() => store.dispatch({ type: 'open', now: Date.now() })}
      >
        {tone === 'busy' ? (
          <svg className="wc-spin" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-9-9" />
          </svg>
        ) : (
          <span aria-hidden="true">{tone === 'error' ? '×' : '✓'}</span>
        )}
        {tone === 'busy' ? (
          <span className="wc-prompt">{promptFor(shown.kind, currentStage(shown), true)}</span>
        ) : null}
        <span className="num">{text}</span>
      </button>
      <span className="sr-only" role="status">
        {tone === 'busy' ? '' : text}
      </span>
    </>
  )
}
