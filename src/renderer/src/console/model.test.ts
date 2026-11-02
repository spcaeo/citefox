import { describe, expect, it } from 'vitest'
import {
  activeJob,
  AUTO_CLOSE_MS,
  consolePlatform,
  consoleReducer,
  formatDuration,
  initialConsoleState,
  promptFor,
  runningJobs,
  STALE_MS,
  type ConsoleAction
} from './model'
import type { ConsoleState, ConsoleUpdate } from './types'

const T0 = 1_000_000

function update(extra: Partial<ConsoleUpdate> = {}): ConsoleAction {
  return {
    type: 'update',
    update: {
      jobId: 'check:1',
      kind: 'checks',
      title: 'Check',
      command: 'check 12 questions',
      at: T0,
      state: 'running',
      ...extra
    }
  }
}

function run(state: ConsoleState, ...actions: ConsoleAction[]): ConsoleState {
  return actions.reduce(consoleReducer, state)
}

const start = (): ConsoleState =>
  run(initialConsoleState(), update({ stage: 'SEARCH', stageText: '0 of 12 questions' }))

const done = (at = T0 + 8000): ConsoleAction =>
  update({ at, stage: 'SEARCH', stageText: '12 of 12 questions', state: 'ok', final: true })

describe('console reducer: opening', () => {
  it('stays shut for setup work while the setup screens show, but a check still opens it', () => {
    const quiet = run(initialConsoleState(), { type: 'setQuiet', value: true })
    const read = run(
      quiet,
      update({ jobId: 'ai:section', kind: 'ai', title: 'Onboarding · section run' })
    )
    expect(read.mode).toBe('hidden')
    expect(read.jobs).toHaveLength(1)
    expect(run(read, update()).mode).toBe('open')
    const after = run(
      read,
      { type: 'setQuiet', value: false },
      update({ jobId: 'ai:2', kind: 'ai' })
    )
    expect(after.mode).toBe('open')
  })

  it('keeps work the user did not start out of sight: listed, but the window stays shut', () => {
    const state = run(
      initialConsoleState(),
      update({
        jobId: 'ai:suggest',
        kind: 'topics',
        title: 'Topics · suggested start',
        background: true,
        stage: 'CLAUDE',
        stageText: 'ask CiteFox AI'
      }),
      update({
        jobId: 'ai:suggest',
        kind: 'topics',
        title: 'Topics · suggested start',
        background: true,
        at: T0 + 500,
        state: 'error',
        final: true,
        error: { message: 'CiteFox AI was not found.', nextStep: null }
      })
    )
    expect(state.mode).toBe('hidden')
    expect(state.jobs).toHaveLength(1)
    expect(state.jobs[0]?.background).toBe(true)
    // A failed background job never pins the window open later.
    expect(state.errorPending).toBe(false)
    // Work the user starts still opens the window.
    expect(run(state, update()).mode).toBe('open')
  })

  it('opens the window for new work, with one question line per stage', () => {
    const state = start()
    expect(state.mode).toBe('open')
    expect(runningJobs(state)).toHaveLength(1)
    expect(activeJob(state)?.lines.map((line) => [line.kind, line.stage, line.text])).toEqual([
      ['stage', 'SEARCH', '0 of 12 questions']
    ])
  })

  it('updates the stage line in place, and closes it when the next stage starts', () => {
    const state = run(
      initialConsoleState(),
      update({ stage: 'READ', stageText: 're-read the page' }),
      update({ stage: 'SEARCH', stageText: '1 of 12 questions', at: T0 + 1000 }),
      update({ stage: 'SEARCH', stageText: '2 of 12 questions', at: T0 + 2000 })
    )
    const lines = activeJob(state)?.lines ?? []
    expect(lines.map((line) => [line.stage, line.text, line.state])).toEqual([
      ['READ', 're-read the page', 'ok'],
      ['SEARCH', '2 of 12 questions', 'running']
    ])
  })

  it('updates a step in place by id and adds one red line per error', () => {
    const step = (state: 'running' | 'ok'): ConsoleAction =>
      update({
        stage: 'READ',
        step: {
          id: 's1',
          text: 'Reading /pricing',
          state,
          detail: null,
          startedAt: T0,
          endedAt: null
        }
      })
    const error = update({
      state: 'error',
      error: { message: 'SerpApi said no', nextStep: 'Check the key in Settings.' }
    })
    const state = run(initialConsoleState(), step('running'), step('ok'), error, error)
    const lines = activeJob(state)?.lines ?? []
    expect(lines.filter((line) => line.kind === 'step').map((line) => line.state)).toEqual(['ok'])
    expect(lines.filter((line) => line.kind === 'error')).toEqual([
      expect.objectContaining({ text: 'SerpApi said no', detail: 'Check the key in Settings.' })
    ])
  })

  it('opens the pill instead when the user minimised last time', () => {
    const state = run(
      initialConsoleState({ prefersMin: true, closeWhenDone: true, position: null }),
      update()
    )
    expect(state.mode).toBe('min')
    expect(state.attention).toBe('none')
  })

  it('starts first-run setup as the pill: its own screen shows the steps', () => {
    const state = run(
      initialConsoleState(),
      update({ jobId: 'start:p1', kind: 'start', title: 'Setting up your site' })
    )
    expect(state.mode).toBe('min')
    expect(state.prefersMin).toBe(false)
  })

  it('joins a page read’s AI steps to the running page read (attachTo)', () => {
    const state = run(
      initialConsoleState(),
      update({ jobId: 'read:p1', kind: 'pages', title: 'Page read', stage: 'FETCH' }),
      update({
        jobId: 'ai:r9',
        kind: 'pages',
        title: 'Page read',
        attachTo: 'pages',
        stage: 'CLAUDE'
      })
    )
    expect(state.jobs.map((job) => job.id)).toEqual(['read:p1'])
    expect(activeJob(state)?.lines.map((line) => line.stage)).toEqual(['FETCH', 'CLAUDE'])
  })
})

describe('console reducer: minimise, toggle, pin', () => {
  it('minimises to the pill and remembers it for next time; open brings it back', () => {
    const min = run(start(), { type: 'minimise' })
    expect(min.mode).toBe('min')
    expect(min.prefersMin).toBe(true)
    const open = run(min, { type: 'open', now: T0 })
    expect(open.mode).toBe('open')
    expect(open.prefersMin).toBe(false)
  })

  it('toggle opens a hidden console and hides an open one (the Activity button)', () => {
    const hidden = initialConsoleState()
    const open = run(hidden, { type: 'toggle', now: T0 })
    expect(open.mode).toBe('open')
    expect(run(open, { type: 'toggle', now: T0 }).mode).toBe('hidden')
    expect(run(start(), { type: 'minimise' }, { type: 'toggle', now: T0 }).mode).toBe('open')
  })

  it('keeps a pinned window open when the work is done ("Close when done" off)', () => {
    const state = run(start(), { type: 'setCloseWhenDone', value: false }, done())
    expect(state.closingAt).toBeNull()
    expect(run(state, { type: 'tick', now: T0 + 60_000 }).mode).toBe('open')
  })

  it('stops a countdown that has already started when the user pins it', () => {
    const counting = run(start(), done())
    expect(counting.closingAt).not.toBeNull()
    expect(run(counting, { type: 'setCloseWhenDone', value: false }).closingAt).toBeNull()
  })
})

describe('console reducer: done and auto-close', () => {
  it('counts down and hides a few seconds after everything is done', () => {
    const finished = run(start(), done())
    expect(activeJob(finished)?.status).toBe('done')
    expect(finished.closingAt).toBe(T0 + 8000 + AUTO_CLOSE_MS)
    expect(run(finished, { type: 'tick', now: T0 + 8000 + AUTO_CLOSE_MS - 1 }).mode).toBe('open')
    expect(run(finished, { type: 'tick', now: T0 + 8000 + AUTO_CLOSE_MS }).mode).toBe('hidden')
  })

  it('"keep open" cancels this countdown', () => {
    const kept = run(start(), done(), { type: 'keepOpen' })
    expect(kept.closingAt).toBeNull()
    expect(run(kept, { type: 'tick', now: T0 + 60_000 }).mode).toBe('open')
  })

  it('waits for every job before counting down', () => {
    const two = run(start(), update({ jobId: 'fill:a.com', kind: 'fill', title: 'Fill' }), done())
    expect(two.closingAt).toBeNull()
    const both = run(
      two,
      update({ jobId: 'fill:a.com', kind: 'fill', title: 'Fill', state: 'ok', final: true })
    )
    expect(both.closingAt).not.toBeNull()
  })

  it('never closes by itself after an error', () => {
    const failed = run(
      start(),
      update({
        state: 'error',
        final: true,
        error: { message: 'No searches left this month', nextStep: null }
      })
    )
    expect(activeJob(failed)?.status).toBe('error')
    expect(failed.errorPending).toBe(true)
    expect(failed.closingAt).toBeNull()
    expect(run(failed, { type: 'tick', now: T0 + 600_000 }).mode).toBe('open')
  })

  it('finishes a job with no end event once it has been quiet for its settle time', () => {
    const quiet = run(
      initialConsoleState(),
      update({
        jobId: 'ai:1',
        kind: 'ai',
        title: 'AI',
        stage: 'CLAUDE',
        state: 'ok',
        settleMs: 2000
      })
    )
    expect(run(quiet, { type: 'tick', now: T0 + 1999 }).jobs[0]?.status).toBe('running')
    const settled = run(quiet, { type: 'tick', now: T0 + 2000 })
    expect(settled.jobs[0]?.status).toBe('done')
    expect(settled.closingAt).toBe(T0 + 2000 + AUTO_CLOSE_MS)
  })

  it('settles a job whose last step finished: its stage line is not left running', () => {
    // An AI job's last event is a done step under a stage ("check the answer · done"),
    // with no result event. It used to keep "N running" in the bar for five minutes.
    const step = (state: 'running' | 'ok', at: number): ConsoleAction =>
      update({
        jobId: 'ai:sort',
        kind: 'topics',
        title: 'Topics · sort questions',
        at,
        stage: 'CHECK',
        stageText: 'check the answer',
        step: {
          id: 'check',
          text: 'Checking the answer',
          state,
          detail: null,
          startedAt: T0,
          endedAt: state === 'ok' ? at : null
        },
        state: state === 'ok' ? 'ok' : 'running'
      })
    const state = run(initialConsoleState(), step('running', T0), step('ok', T0 + 1000))
    expect(state.jobs[0]?.lines.every((line) => line.state !== 'running')).toBe(true)
    const settled = run(state, { type: 'tick', now: T0 + 1000 + 2500 })
    expect(settled.jobs[0]?.status).toBe('done')
    expect(runningJobs(settled)).toHaveLength(0)
  })

  it('keeps a job with a running line open until it goes stale', () => {
    const busy = start()
    expect(run(busy, { type: 'tick', now: T0 + 120_000 }).jobs[0]?.status).toBe('running')
    expect(run(busy, { type: 'tick', now: T0 + STALE_MS }).jobs[0]?.status).toBe('done')
  })
})

describe('console reducer: the pill shakes when a job ends while minimised', () => {
  it('turns green and shakes on done, and waits for a click', () => {
    const min = run(start(), { type: 'minimise' })
    expect(min.attention).toBe('none')
    const finished = run(min, done())
    expect(finished.mode).toBe('min')
    expect(finished.attention).toBe('done')
    expect(finished.shakeKey).toBe(1)
    expect(finished.closingAt).toBeNull()
    expect(run(finished, { type: 'tick', now: T0 + 600_000 }).mode).toBe('min')
    const opened = run(finished, { type: 'open', now: T0 })
    expect(opened.attention).toBe('none')
  })

  it('shakes again for the next job, and turns red when one failed', () => {
    const min = run(
      start(),
      update({ jobId: 'fill:a.com', kind: 'fill', title: 'Fill' }),
      { type: 'minimise' },
      update({
        jobId: 'fill:a.com',
        kind: 'fill',
        title: 'Fill',
        state: 'error',
        final: true,
        error: { message: 'No AI is connected', nextStep: null }
      })
    )
    expect(min.attention).toBe('error')
    expect(min.shakeKey).toBe(1)
    const after = run(min, done())
    expect(after.shakeKey).toBe(2)
    // The failure stays visible until the user looks.
    expect(after.attention).toBe('error')
  })

  it('reports the job that just ended, not the one started last', () => {
    const state = run(
      start(),
      update({ jobId: 'fill:a.com', kind: 'fill', title: 'Fill' }),
      update({ jobId: 'fill:a.com', kind: 'fill', title: 'Fill', state: 'ok', final: true }),
      { type: 'minimise' },
      done()
    )
    expect(activeJob(state)?.id).toBe('check:1')
    expect(state.attention).toBe('done')
  })

  it('does not shake while the window is open', () => {
    expect(run(start(), done()).shakeKey).toBe(0)
  })
})

describe('console reducer: other actions', () => {
  it('selects only a known job, and remembers where it was dragged', () => {
    const state = start()
    expect(run(state, { type: 'select', jobId: 'nope' })).toBe(state)
    const moved = run(state, { type: 'move', position: { x: 10, y: 20 } })
    expect(moved.position).toEqual({ x: 10, y: 20 })
  })

  it('says a retry was sent and drops the retry button', () => {
    const failed = run(
      start(),
      update({
        state: 'error',
        final: true,
        error: { message: 'x', nextStep: null },
        retry: { kind: 'check', projectId: 'p', pageId: 'g' }
      })
    )
    const retried = run(failed, { type: 'retried', jobId: 'check:1', now: T0 + 9000 })
    expect(activeJob(retried)?.retry).toBeNull()
    expect(activeJob(retried)?.lines.at(-1)?.text).toBe('retry sent, a new run starts')
  })

  it('hide clears the error so the next run may close by itself', () => {
    const failed = run(
      start(),
      update({ state: 'error', final: true, error: { message: 'x', nextStep: null } }),
      { type: 'hide' }
    )
    expect(failed.errorPending).toBe(false)
    expect(failed.mode).toBe('hidden')
  })
})

describe('console words', () => {
  it('builds the DOS question per stage on Windows, short for the pill', () => {
    expect(promptFor('fill', 'READ', false, 'windows')).toBe('C:\\CITEFOX\\FILL\\READ>')
    expect(promptFor('fill', 'READ', true, 'windows')).toBe('C:\\FILL\\READ>')
    expect(promptFor(null, null, false, 'windows')).toBe('C:\\CITEFOX>')
  })

  it('builds a neutral shell question on macOS and Linux, never a drive letter', () => {
    expect(promptFor('checks', 'SEARCH', false, 'unix')).toBe('citefox/checks/search $')
    expect(promptFor('checks', 'SEARCH', true, 'unix')).toBe('checks/search $')
    expect(promptFor(null, null, false, 'unix')).toBe('citefox $')
    expect(promptFor(null, null, true, 'unix')).toBe('citefox $')
  })

  it('picks the question style from the platform', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Electron/38'
    const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Electron/38'
    const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Electron/38'
    expect(consolePlatform(mac)).toBe('unix')
    expect(consolePlatform(linux)).toBe('unix')
    expect(consolePlatform(windows)).toBe('windows')
  })

  it('formats durations', () => {
    expect(formatDuration(8_200)).toBe('8 s')
    expect(formatDuration(65_000)).toBe('1 min 5 s')
    expect(formatDuration(120_000)).toBe('2 min')
  })
})
