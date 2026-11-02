import { describe, expect, test } from 'vitest'
import { WALL_CLOCK_TICK_MS } from './controller'
import { createRig, finished, flush, queue } from './controller.test-helper'

describe('wall-clock scheduling', () => {
  test('the loop wakes on a short wall-clock tick, not one long timer to midnight', async () => {
    const rig = createRig()
    await flush()
    expect(rig.calls.checkDue).toHaveBeenCalledTimes(1)
    expect(rig.sleeps).toEqual([WALL_CLOCK_TICK_MS])
    rig.stop()
  })

  test('a later slot today is waited for exactly, when it is sooner than the tick', async () => {
    const rig = createRig({
      status: queue({ nextRunAt: new Date(Date.parse('2026-04-20T12:02:00.000Z')).toISOString() })
    })
    await flush()
    expect(rig.sleeps).toEqual([2 * 60_000])
    rig.stop()
  })

  test('waking from sleep or unlocking the screen runs a catch-up pass at once', async () => {
    const rig = createRig()
    await flush()
    expect(rig.calls.checkDue).toHaveBeenCalledTimes(1)
    rig.host.wakeUp()
    await flush()
    expect(rig.calls.checkDue).toHaveBeenCalledTimes(2)
    rig.stop()
  })

  test('the timer firing runs the next pass', async () => {
    const rig = createRig({ resolveSleeps: true })
    await flush()
    expect(rig.calls.checkDue.mock.calls.length).toBeGreaterThan(1)
    rig.stop()
  })
})

describe('start at login', () => {
  test('the login item is set only when the setting differs from the system', async () => {
    const rig = createRig()
    await flush()
    rig.host.icon.open()
    rig.host.icon.open()
    expect(rig.host.login).toEqual([true])
    rig.state.schedule = { ...rig.state.schedule, startAtLogin: false }
    rig.host.icon.open()
    rig.host.icon.open()
    expect(rig.host.login).toEqual([true, false])
    rig.stop()
  })
})

describe('notifications for a due pass', () => {
  test('a pass that checks many pages shows one summary, not one toast per page', async () => {
    const rig = createRig({ passHooks: true })
    await flush()
    for (let index = 0; index < 5; index += 1) {
      rig.tray.notifyCheckFinished(
        finished({ jobId: `due-${index}`, pageId: `page-${index}`, pageLabel: `Page ${index}` })
      )
    }
    expect(rig.host.notifications).toEqual([])
    rig.settlePass()
    expect(rig.host.notifications).toHaveLength(1)
    expect(rig.host.notifications[0]?.title).toBe('CiteFox checked 5 pages')
    rig.host.notifications[0]?.onClick()
    await flush()
    expect(rig.host.wins[0]?.shown).toBe(1)
    rig.stop()
  })

  test('a single page from a pass and a manual check each keep their own notice', async () => {
    const rig = createRig({ passHooks: true })
    await flush()
    rig.tray.notifyCheckFinished(finished({ jobId: 'due-1' }))
    rig.settlePass()
    expect(rig.host.notifications[0]?.title).toBe('Check finished: Text alerts for business')
    rig.tray.notifyCheckFinished(finished({ jobId: 'manual-job' }))
    expect(rig.host.notifications).toHaveLength(2)
    rig.stop()
  })
})
