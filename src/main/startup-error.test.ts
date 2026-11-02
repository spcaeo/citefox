import { describe, expect, test } from 'vitest'
import { StorageError } from './storage/errors'
import { isNewerDataError, startupErrorBox } from './startup-error'

const context = {
  logFile: '/data/CiteFox/logs/citefox.log',
  userDataDir: '/data/CiteFox',
  secrets: ['correct-horse-battery']
}

describe('startup error box', () => {
  test('explains a database from a newer CiteFox and names the data and log paths', () => {
    const error = new StorageError('Database is newer than this app and cannot be opened')
    expect(isNewerDataError(error)).toBe(true)
    const box = startupErrorBox(error, context)
    expect(box.title).toBe('CiteFox needs to be updated')
    expect(box.content).toContain('newer version of CiteFox')
    expect(box.content).toContain('Data folder: /data/CiteFox')
    expect(box.content).toContain('Log file: /data/CiteFox/logs/citefox.log')
  })

  test('treats a newer settings.json the same way', () => {
    const error = new StorageError('settings.json is newer than this app and cannot be opened')
    expect(startupErrorBox(error, context).title).toBe('CiteFox needs to be updated')
  })

  test('shows other failures with the message redacted and the log path', () => {
    const box = startupErrorBox(new Error('keychain said correct-horse-battery'), context)
    expect(box.title).toBe('CiteFox could not start')
    expect(box.content).not.toContain('correct-horse-battery')
    expect(box.content).toContain('[REDACTED]')
    expect(box.content).toContain('/data/CiteFox/logs/citefox.log')
    expect(isNewerDataError('newer than this app')).toBe(false)
  })
})
