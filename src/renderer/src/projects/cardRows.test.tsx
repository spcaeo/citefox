// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import type { ProjectSchedule, QueueStatus } from '@shared/domain'
import { ClockRow, KeyRow, ScoreMeter } from './cardRows'
import { formatClock } from '../utils/dates'

const NOW = new Date(2026, 9, 20, 8, 0, 0)
/** Nine o'clock on the test day, in the computer's own clock style. */
const NINE = formatClock(new Date(2026, 9, 20, 9, 0, 0).toISOString())

function schedule(
  patch: Partial<ProjectSchedule> & Pick<ProjectSchedule, 'projectId'>
): ProjectSchedule {
  return {
    defaultIntervalDays: 14,
    dailyCheckTime: '09:00',
    quietFrom: null,
    quietUntil: null,
    spreadAcrossDay: false,
    catchUp: true,
    paused: false,
    nextCheckAt: new Date(2026, 9, 20, 9, 0, 0).toISOString(),
    pagesDueToday: 14,
    ...patch
  }
}

const QUEUE: QueueStatus = {
  state: 'running',
  running: 0,
  waiting: 0,
  claudeConcurrency: 2,
  claudeInFlight: 0,
  trayRunning: false,
  headlessJob: false,
  nextRunAt: null,
  pagesDue: 0,
  keys: [
    {
      keyId: 'shared-plan',
      name: 'My plan',
      provider: 'serpapi',
      used: 1258,
      cap: 5250,
      planLimit: 5250,
      state: 'ok'
    },
    {
      keyId: 'acme-key',
      name: 'Acme Clinics (client)',
      provider: 'serpapi',
      used: 312,
      cap: 1000,
      planLimit: 1000,
      state: 'ok'
    }
  ],
  projects: [
    {
      projectId: 'fieldpro',
      name: 'FieldPro HVAC',
      used: 18,
      cap: 500,
      capRule: 'pause',
      dedicatedKeyId: null,
      paused: true
    },
    {
      projectId: 'acme',
      name: 'Acme Clinics',
      used: 312,
      cap: 1000,
      capRule: 'pause',
      dedicatedKeyId: 'acme-key',
      paused: false
    }
  ]
}

afterEach(() => {
  cleanup()
})

describe('project card score bar and icon rows', () => {
  test('the score bar fill equals the rounded score out of 100 and the meter names it', () => {
    const view = render(<ScoreMeter score={35} />)
    const meter = view.getByRole('meter', { name: 'Average score 35 of 100' })
    expect(meter.getAttribute('aria-valuenow')).toBe('35')
    expect(meter.getAttribute('aria-valuemin')).toBe('0')
    expect(meter.getAttribute('aria-valuemax')).toBe('100')
    expect(meter.querySelector('span')?.style.width).toBe('35%')

    cleanup()
    const rounded = render(<ScoreMeter score={35.6} />)
    const again = rounded.getByRole('meter', { name: 'Average score 36 of 100' })
    expect(again.getAttribute('aria-valuenow')).toBe('36')
    expect(again.querySelector('span')?.style.width).toBe('36%')
  })

  test('the clock row shows Paused or the next check when a schedule exists', () => {
    const view = render(
      <>
        <ClockRow
          schedule={schedule({ projectId: 'fieldpro', paused: true, pagesDueToday: 0 })}
          now={NOW}
        />
        <ClockRow schedule={schedule({ projectId: 'textbolt' })} now={NOW} />
      </>
    )
    const rows = [...view.container.querySelectorAll('.prow')].map((row) =>
      (row.textContent ?? '').replace(/\s+/g, ' ').trim()
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Every 14 days at 09:00 · Paused')
    expect(rows[0]).toContain(`Next check after resume: today ${NINE}`)
    expect(rows[0]).not.toContain('pages due')
    expect(rows[1]).toBe(`Every 14 days at 09:00 · Next: today ${NINE} · 14 pages due`)
  })

  test('the key row names shared keys and a dedicated key when the queue has them', () => {
    const view = render(
      <>
        <KeyRow queue={QUEUE} projectId="fieldpro" />
        <KeyRow queue={QUEUE} projectId="acme" claudeLabel="Anthropic API · Acme Clinics" />
      </>
    )
    const rows = [...view.container.querySelectorAll('.prow')].map((row) =>
      (row.textContent ?? '').replace(/\s+/g, ' ').trim()
    )
    expect(rows[0]).toBe('Shared keys (My plan) · AI connection from Settings')
    expect(rows[1]).toBe('Own key "Acme Clinics (client)" · Anthropic API · Acme Clinics')
  })
})
