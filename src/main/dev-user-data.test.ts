import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { devUserDataDir } from './dev-user-data'

describe('dev data folder override', () => {
  it('only applies to unpackaged builds with CITEFOX_USER_DATA', () => {
    expect(devUserDataDir(false, { CITEFOX_USER_DATA: '/tmp/citefox-two' })).toBe(
      '/tmp/citefox-two'
    )
    expect(devUserDataDir(true, { CITEFOX_USER_DATA: '/tmp/citefox-two' })).toBeNull()
    expect(devUserDataDir(false, { CITEFOX_USER_DATA: ' ' })).toBeNull()
    expect(devUserDataDir(false, {})).toBeNull()
  })

  it('resolves a relative folder to an absolute one', () => {
    expect(devUserDataDir(false, { CITEFOX_USER_DATA: 'two' })).toBe(path.resolve('two'))
  })
})
