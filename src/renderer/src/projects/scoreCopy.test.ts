import { describe, expect, test } from 'vitest'
import type { ProjectSchedule, QueueStatus } from '@shared/domain'
import {
  capNote,
  changeLine,
  changeTone,
  checkDueMessage,
  clockDetail,
  glanceNext,
  glanceSearchLine,
  keyStatusLine,
  resumeSentence,
  scheduleSentence,
  scoreMeterLabel,
  scoreMeterPercent,
  searchesLine,
  shareLabel
} from './scoreCopy'
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

describe('score tiles', () => {
  test('the score bar fill is the rounded score out of 100, and the label carries it', () => {
    expect(scoreMeterPercent(35)).toBe(35)
    expect(scoreMeterLabel(35)).toBe('Average score 35 of 100')
    expect(scoreMeterPercent(35.4)).toBe(35)
    expect(scoreMeterPercent(35.6)).toBe(36)
    expect(scoreMeterLabel(35.6)).toBe('Average score 36 of 100')
    expect(scoreMeterPercent(-4)).toBe(0)
    expect(scoreMeterPercent(140)).toBe(100)
    expect(scoreMeterLabel(140)).toBe('Average score 100 of 100')
  })

  test('the clock row names Paused or the next check, in the states that have a schedule', () => {
    const paused = schedule({
      projectId: 'fieldpro',
      paused: true,
      pagesDueToday: 0
    })
    const active = schedule({ projectId: 'textbolt' })
    expect(clockDetail(paused, NOW)).toBe('Paused')
    expect(scheduleSentence(paused, NOW)).toBe('Every 14 days at 09:00 · Paused')
    expect(resumeSentence(paused, NOW)).toBe(`Next check after resume: today ${NINE}`)
    expect(clockDetail(active, NOW)).toBe(`Next: today ${NINE} · 14 pages due`)
    expect(scheduleSentence(active, NOW)).toBe(
      `Every 14 days at 09:00 · Next: today ${NINE} · 14 pages due`
    )
  })

  test('the key row names a shared key and a dedicated key when the queue has them', () => {
    const shared: QueueStatus = {
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
    expect(keyStatusLine(shared, 'fieldpro')).toBe(
      'Shared keys (My plan) · AI connection from Settings'
    )
    expect(keyStatusLine(shared, 'acme')).toBe(
      'Own key "Acme Clinics (client)" · AI connection from Settings'
    )
    const plan = shared.keys[0]
    const own = shared.keys[1]
    expect(plan).toBeDefined()
    expect(own).toBeDefined()
    if (!plan || !own) return
    const named: QueueStatus = {
      ...shared,
      keys: [
        plan,
        {
          keyId: 'shared-backup',
          name: 'Backup',
          provider: 'serpapi',
          used: 18,
          cap: 250,
          planLimit: 250,
          state: 'ok'
        },
        own
      ]
    }
    expect(keyStatusLine(named, 'fieldpro')).toBe(
      'Shared keys (My plan, Backup) · AI connection from Settings'
    )
  })

  test('a paused project shows Paused and keeps the next check for after resume', () => {
    const paused = schedule({
      projectId: 'fieldpro',
      paused: true,
      pagesDueToday: 0
    })
    expect(scheduleSentence(paused, NOW)).toBe('Every 14 days at 09:00 · Paused')
    expect(resumeSentence(paused, NOW)).toBe(`Next check after resume: today ${NINE}`)
    expect(scheduleSentence(paused, NOW)).not.toContain('pages due')
  })

  test('an active project shows the next check and the pages due today', () => {
    const active = schedule({ projectId: 'textbolt' })
    expect(scheduleSentence(active, NOW)).toBe(
      `Every 14 days at 09:00 · Next: today ${NINE} · 14 pages due`
    )
    expect(resumeSentence(active, NOW)).toBeNull()
  })

  test('the glance includes a paused project in the soonest time and counts only pages due', () => {
    const textbolt = schedule({ projectId: 'textbolt', pagesDueToday: 14 })
    const fieldpro = schedule({ projectId: 'fieldpro', paused: true, pagesDueToday: 0 })
    const same = textbolt.nextCheckAt
    const glance = glanceNext(
      {
        projects: [],
        searchesUsed: 0,
        nextCheckAt: same
      },
      [fieldpro, textbolt],
      new Map([
        ['textbolt', 'TextBolt'],
        ['fieldpro', 'FieldPro HVAC']
      ]),
      NOW
    )
    expect(glance?.title).toBe(`Today ${NINE} · TextBolt`)
    expect(glance?.detail).toBe('14 pages due')
  })

  test('searches split shared keys from a project key', () => {
    const queue: QueueStatus = {
      state: 'running',
      running: 0,
      waiting: 14,
      claudeConcurrency: 2,
      claudeInFlight: 0,
      trayRunning: false,
      headlessJob: false,
      nextRunAt: null,
      pagesDue: 14,
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
    expect(glanceSearchLine(queue)).toBe(
      "1,258 used by CiteFox · caps total 5,250 on shared keys · 312 of 1,000 on Acme's own key"
    )
    expect(capNote(null)).toBe('Cap drawn from shared keys')
    expect(capNote('acme-key')).toBe("Client's own search plan, used only here")
    const own = queue.projects[0]
    expect(own).toBeDefined()
    if (!own) return
    expect(shareLabel(own, 5250)).toBe('Own key, not shared')
  })

  test('change is since the last check, and a missing cap is named', () => {
    expect(changeLine(6)).toBe('+6 since the last check')
    expect(changeLine(-2)).toBe('−2 since the last check')
    expect(changeLine(null)).toBe('No previous check')
    expect(searchesLine(18, null)).toBe('18 · no cap')
  })

  test('the change colour follows the sign', () => {
    expect(changeTone(-2)).toBe('chg-down')
    expect(changeTone(6)).toBe('chg-up')
    expect(changeTone(0)).toBe('chg-flat')
    expect(changeTone(null)).toBe('chg-flat')
  })

  test('check now starts unless the whole queue is paused or today already ran', () => {
    expect(
      checkDueMessage({ started: true, jobIds: ['check-textbolt'], pages: 0 }, 'running')
    ).toBe('Nothing was due, so no check started.')
    expect(
      checkDueMessage({ started: true, jobIds: ['check-textbolt'], pages: 1 }, 'running')
    ).toBe('Check started for 1 page.')
    expect(
      checkDueMessage({ started: true, jobIds: ['check-textbolt'], pages: 2 }, 'running')
    ).toBe('Check started for 2 pages.')
    expect(
      checkDueMessage({ started: true, jobIds: ['check-textbolt'], pages: 14 }, 'running')
    ).toBe('Check started for 14 pages.')
    expect(checkDueMessage({ started: false, jobIds: [], pages: 0 }, 'paused_all')).toBe(
      'Check now waits while checks are paused.'
    )
    expect(checkDueMessage({ started: false, jobIds: [], pages: 0 }, 'paused_today')).toBe(
      'Check now waits while checks are paused.'
    )
    expect(
      checkDueMessage({ started: false, jobIds: ['check-textbolt'], pages: 14 }, 'running')
    ).toBe("Today's check already ran.")
  })
})
