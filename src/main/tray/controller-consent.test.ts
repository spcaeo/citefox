import { describe, expect, test } from 'vitest'
import { createRig, flush } from './controller.test-helper'

const alert = {
  projectId: null,
  title: 'TextBolt reached its search cap',
  body: '100 of 100 searches used.',
  action: 'Open',
  hash: '#/status'
}

describe('tray: nothing reaches the system before the user agreed', () => {
  test('the login item is not added until the user turned it on', async () => {
    const consent = { loginItem: false, notifications: false }
    const rig = createRig({ consent })
    await flush()
    expect(rig.host.login).toEqual([])
    consent.loginItem = true
    rig.host.icon.open()
    expect(rig.host.login).toEqual([true])
    rig.stop()
  })

  test('a login item the system already has is left alone, and turning it off still works', async () => {
    const rig = createRig({ consent: { loginItem: false, notifications: true } })
    rig.host.loginEnabled = true
    await flush()
    expect(rig.host.login).toEqual([])
    rig.state.schedule = { ...rig.state.schedule, startAtLogin: false }
    rig.host.icon.open()
    expect(rig.host.login).toEqual([false])
    rig.stop()
  })

  test('desktop notifications wait for the user to turn them on', () => {
    const consent = { loginItem: true, notifications: false }
    const rig = createRig({ consent })
    rig.tray.notifyAlert(alert)
    expect(rig.host.notifications).toEqual([])
    consent.notifications = true
    rig.tray.notifyAlert(alert)
    expect(rig.host.notifications).toHaveLength(1)
    rig.stop()
  })
})
