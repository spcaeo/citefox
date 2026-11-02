// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConsoleLog } from './ConsoleLog'
import type { ConsoleJob, ConsoleLine } from './types'

afterEach(cleanup)

function stage(
  id: string,
  text: string,
  state: ConsoleLine['state'],
  startedAt: number
): ConsoleLine {
  return { id, kind: 'stage', stage: 'CLAUDE', text, state, detail: null, startedAt, endedAt: null }
}

function job(lines: readonly ConsoleLine[], status: ConsoleJob['status']): ConsoleJob {
  return {
    id: 'j1',
    kind: 'fill',
    title: 'Fill from textbolt.com',
    command: 'fill textbolt.com',
    status,
    startedAt: 0,
    updatedAt: 0,
    endedAt: status === 'running' ? null : 9_000,
    lines,
    progress: null,
    summary: null,
    error: null,
    retry: null,
    stop: null,
    settleMs: 60_000,
    expectedMs: null,
    background: false,
    live: null
  }
}

function renderLog(value: ConsoleJob, now: number): void {
  render(
    <ConsoleLog job={value} now={now} closingIn={null} onRetry={() => {}} onKeepOpen={() => {}} />
  )
}

describe('ConsoleLog', () => {
  it('says a running stage is working and to wait, with a spinner and no typing cursor', () => {
    renderLog(job([stage('s1', 'Asking CiteFox AI', 'running', 1_000)], 'running'), 13_000)
    const live = document.querySelector('[data-live="true"]')
    expect(live?.textContent).toContain('Asking CiteFox AI… please wait · 12 s')
    expect(live?.querySelector('svg.wc-spin')).not.toBeNull()
    expect(document.body.textContent).not.toContain('█')
  })

  it('reads a finished stage as what happened', () => {
    renderLog(
      job(
        [
          stage('s1', 'Asking CiteFox AI', 'ok', 1_000),
          stage('s2', 'Checking the answer', 'ok', 2_000)
        ],
        'done'
      ),
      9_000
    )
    expect(screen.getByText(/CiteFox AI answered/u)).toBeTruthy()
    expect(screen.getByText(/Checked the answer/u)).toBeTruthy()
    expect(document.body.textContent).not.toContain('please wait')
  })
})
