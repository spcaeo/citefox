import { describe, expect, test } from 'vitest'
import { appBuild, devAppBuild } from './build-info'

describe('build info', () => {
  test('reports the commit and time the bundle was built from', () => {
    expect(appBuild({ commit: '59f998b', builtAt: '2026-10-22T19:54:41.000Z' })).toEqual({
      commit: '59f998b',
      number: null,
      builtAt: '2026-10-22T19:54:41.000Z'
    })
  })

  test('passes the stamped build number through, and drops a broken one', () => {
    const builtAt = '2026-10-22T19:54:41.000Z'
    expect(appBuild({ commit: '59f998b', number: 1424, builtAt }).number).toBe(1424)
    expect(appBuild({ commit: '59f998b', number: '1424', builtAt }).number).toBeNull()
    expect(appBuild({ commit: '59f998b', number: -3, builtAt }).number).toBeNull()
  })

  test('a build outside git has no commit', () => {
    expect(appBuild({ commit: null, builtAt: '2026-10-22T19:54:41.000Z' }).commit).toBeNull()
    expect(appBuild({ commit: 'not a sha', builtAt: '2026-10-22T19:54:41.000Z' }).commit).toBeNull()
  })

  test('an unbundled run (this test) falls back to no commit and a valid time', () => {
    const build = appBuild()
    expect(build.commit).toBeNull()
    expect(Number.isNaN(Date.parse(build.builtAt))).toBe(false)
    expect(appBuild({ commit: 'abc1234', builtAt: 'later' }).builtAt).toBe(build.builtAt)
  })
})

describe('devAppBuild', () => {
  test('a development run names the checkout commit it started from', () => {
    const build = devAppBuild(
      '/repo',
      () => '9b520cb5\n',
      () => 1500
    )
    expect(build.commit).toBe('9b520cb5')
    expect(build.number).toBe(1500)
  })

  test('falls back to the bundled build when git is missing or answers nonsense', () => {
    expect(
      devAppBuild('/repo', () => {
        throw new Error('git: not found')
      })
    ).toEqual(appBuild())
    expect(devAppBuild('/repo', () => 'fatal: not a git repository')).toEqual(appBuild())
  })
})
