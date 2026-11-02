// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistProgress } from './AssistProgress'
import { announcement, formatElapsed } from './assistProgressModel'
import { axeViolations } from './axe.test-helper'
import type { AssistProgressView, AssistStepView } from './useAssistProgress'

const NOW = Date.parse('2026-10-22T12:00:00.000Z')

function step(
  partial: Partial<AssistStepView> & Pick<AssistStepView, 'key' | 'label'>
): AssistStepView {
  return {
    kind: 'read',
    state: 'done',
    detail: null,
    startedAt: NOW - 14_000,
    endedAt: NOW - 13_000,
    ...partial
  }
}

const RUNNING: AssistProgressView = {
  running: true,
  startedAt: NOW - 14_000,
  endedAt: null,
  claude: {
    connection: 'claude-code',
    connectionText: 'CiteFox AI · on your plan',
    model: 'claude-sonnet-4-5'
  },
  steps: [
    step({ key: 's1', label: 'Reading textbolt.com', detail: 'Read directly · 812 words' }),
    step({ key: 's2', label: 'Reading /about', state: 'skipped', detail: 'Not found' }),
    step({
      key: 's3',
      kind: 'claude',
      label: 'Asking CiteFox AI to find brand names and competitors',
      state: 'running',
      startedAt: NOW - 12_000,
      endedAt: null
    })
  ]
}

let reduce = false

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
  reduce = false
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('reduce') ? reduce : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    })
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AssistProgress', () => {
  it('lists each step with its state, the running CiteFox AI timer and the connection line', () => {
    const view = render(<AssistProgress progress={RUNNING} reads="uses your site, no searches" />)
    const panel = view.getByRole('region', { name: 'What CiteFox AI is doing' })
    expect(panel.getAttribute('aria-busy')).toBe('true')
    const rows = view.getAllByRole('listitem')
    expect(rows.map((row) => row.getAttribute('data-state'))).toEqual([
      'done',
      'skipped',
      'running'
    ])
    expect(rows[0]?.textContent).toContain('Reading textbolt.com · done')
    expect(rows[1]?.textContent).toContain('skipped')
    expect(rows[2]?.textContent).toContain('12 s')
    expect(panel.textContent).toContain('CiteFox AI · on your plan · uses your site, no searches')
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(view.getAllByRole('listitem')[2]?.textContent).toContain('15 s')
  })

  it('announces the current step politely, not the timer', () => {
    const view = render(<AssistProgress progress={RUNNING} />)
    const status = view.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe('Asking CiteFox AI to find brand names and competitors…')
    expect(view.container.querySelector('.ui-progress-secs')?.getAttribute('aria-hidden')).toBe(
      'true'
    )
  })

  it('shows a starting row before the first step arrives', () => {
    const view = render(
      <AssistProgress
        progress={{ ...RUNNING, steps: [], claude: null }}
        expectedSeconds={20}
        note="about 20 s · no searches"
      />
    )
    expect(view.getByRole('listitem').textContent).toContain('Starting')
    expect(view.getByRole('listitem').textContent).toContain('Usually about 20 s')
    expect(view.container.textContent).toContain('about 20 s · no searches')
  })

  it('shows Cancel only when the call can be stopped', () => {
    const onCancel = vi.fn()
    const view = render(<AssistProgress progress={RUNNING} />)
    expect(view.queryByRole('button', { name: 'Cancel' })).toBeNull()
    view.rerender(<AssistProgress progress={RUNNING} onCancel={onCancel} />)
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('folds into one summary line when done, and opens the steps again', () => {
    const done: AssistProgressView = {
      ...RUNNING,
      running: false,
      endedAt: NOW,
      steps: RUNNING.steps.map((item) =>
        item.state === 'running' ? { ...item, state: 'done', endedAt: NOW } : item
      )
    }
    const view = render(<AssistProgress progress={done} />)
    const toggle = view.getByRole('button', {
      name: /3 steps · 1 skipped · 14 s · CiteFox AI 12 s/
    })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByRole('listitem')).toBeNull()
    fireEvent.click(toggle)
    expect(view.getAllByRole('listitem')).toHaveLength(3)
    expect(view.getByRole('status').textContent).toBe(
      'Done. Asking CiteFox AI to find brand names and competitors'
    )
  })

  it('marks a failed run in the folded line', () => {
    const failed: AssistProgressView = {
      ...RUNNING,
      running: false,
      endedAt: NOW,
      steps: [
        step({
          key: 's1',
          label: 'Asking CiteFox AI',
          kind: 'claude',
          state: 'failed',
          detail: 'Signed out'
        })
      ]
    }
    const view = render(<AssistProgress progress={failed} />)
    expect(
      view.getByRole('region', { name: 'What CiteFox AI did' }).getAttribute('data-state')
    ).toBe('failed')
    expect(view.getByRole('status').textContent).toBe('Asking CiteFox AI: failed. Signed out')
  })

  it('renders nothing when there is nothing to show', () => {
    const view = render(
      <AssistProgress progress={{ ...RUNNING, running: false, steps: [], endedAt: NOW }} />
    )
    expect(view.container.innerHTML).toBe('')
  })

  it('turns motion off when the system asks for less', () => {
    const view = render(<AssistProgress progress={RUNNING} />)
    expect(view.getByRole('region').getAttribute('data-motion')).toBe('full')
    cleanup()
    reduce = true
    const reduced = render(<AssistProgress progress={RUNNING} />)
    expect(reduced.getByRole('region').getAttribute('data-motion')).toBe('reduce')
  })

  it('has no axe violations running or folded', async () => {
    vi.useRealTimers()
    const view = render(<AssistProgress progress={RUNNING} onCancel={() => undefined} />)
    expect(await axeViolations(view.container)).toEqual([])
    view.rerender(<AssistProgress progress={{ ...RUNNING, running: false, endedAt: NOW }} />)
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('formats elapsed time and announcements', () => {
    expect(formatElapsed(400)).toBe('0 s')
    expect(formatElapsed(12_400)).toBe('12 s')
    expect(formatElapsed(65_000)).toBe('1 min 5 s')
    expect(formatElapsed(120_000)).toBe('2 min')
    expect(announcement([], true)).toBe('CiteFox AI is starting…')
    expect(announcement([], false)).toBe('')
    expect(announcement([step({ key: 'a', label: 'Reading /pricing' })], true)).toBe(
      'Reading /pricing: done'
    )
  })
})
