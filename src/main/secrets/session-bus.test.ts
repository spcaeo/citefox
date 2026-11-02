import { describe, expect, test } from 'vitest'
import { sessionBusEnvPatch } from './session-bus'

describe('Linux session bus for the Secret Service', () => {
  const sockets = new Set(['/run/user/1000/bus'])
  const isSocket = (path: string): boolean => sockets.has(path)

  test('a cron environment gets the logind session bus', () => {
    expect(sessionBusEnvPatch({ platform: 'linux', env: {}, uid: 1000, isSocket })).toEqual({
      XDG_RUNTIME_DIR: '/run/user/1000',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus'
    })
  })

  test('leaves a desktop session, an existing runtime dir, and other systems alone', () => {
    const bus = 'unix:path=/tmp/dbus-abc'
    expect(
      sessionBusEnvPatch({
        platform: 'linux',
        env: { DBUS_SESSION_BUS_ADDRESS: bus },
        uid: 1000,
        isSocket
      })
    ).toEqual({})
    expect(
      sessionBusEnvPatch({
        platform: 'linux',
        env: { XDG_RUNTIME_DIR: '/run/user/1000' },
        uid: 1000,
        isSocket
      })
    ).toEqual({})
    expect(sessionBusEnvPatch({ platform: 'darwin', env: {}, uid: 1000, isSocket })).toEqual({})
    expect(sessionBusEnvPatch({ platform: 'linux', env: {}, uid: null, isSocket })).toEqual({})
  })

  test('does nothing when the user has no session bus socket', () => {
    expect(sessionBusEnvPatch({ platform: 'linux', env: {}, uid: 1001, isSocket })).toEqual({})
    expect(
      sessionBusEnvPatch({
        platform: 'linux',
        env: { DBUS_SESSION_BUS_ADDRESS: ' ' },
        uid: 1001,
        isSocket
      })
    ).toEqual({})
  })
})
