import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  claudeCodePause,
  clearClaudeCodePause,
  onClaudeCodePauseChange,
  pauseClaudeCode
} from '../providers/claude/shared-gate'
import { cleanupHarness, harness, keyRequest, noSecret, SECRET } from './test-harness'

afterEach(cleanupHarness)

const NOW = Date.parse('2026-10-19T12:00:00.000Z')
const RESET = new Date('2026-10-19T19:00:00.000Z')

describe('claudeCode:getPause', () => {
  test('is null while Claude Code is not paused', async () => {
    const { handlers } = harness()
    expect(await handlers['claudeCode:getPause']({ projectId: null })).toBeNull()
  })

  test('names the reset and whether an Anthropic key is there to use instead', async () => {
    const { handlers, logs, storage } = harness()
    const binary = storage.readSettings().claudeBinaryPath
    pauseClaudeCode(binary ?? '/usr/local/bin/claude', { kind: 'weekly', resetsAt: RESET }, NOW)
    const paused = await handlers['claudeCode:getPause']({ projectId: null })
    expect(paused).toMatchObject({
      resetsAt: RESET.toISOString(),
      kind: 'weekly',
      hasApiKey: false
    })
    expect(Date.parse(paused?.until ?? '')).toBeGreaterThan(RESET.getTime())
    expect(paused?.availableAgain).toMatch(/at \d{1,2}:\d{2} (AM|PM)$/)

    await handlers['keys:add'](keyRequest('anthropic', SECRET))
    expect((await handlers['claudeCode:getPause']({ projectId: null }))?.hasApiKey).toBe(true)
    expect(noSecret(await handlers['claudeCode:getPause']({ projectId: null }), logs, SECRET)).toBe(
      true
    )
  })

  test('a pause with no reset time says when the pause ends', async () => {
    const { handlers } = harness()
    pauseClaudeCode('/usr/local/bin/claude', { kind: 'unknown', resetsAt: null }, NOW)
    const paused = await handlers['claudeCode:getPause']({ projectId: null })
    expect(paused?.resetsAt).toBeNull()
    expect(paused?.availableAgain).toMatch(/^today at /)
  })

  test('is null when calls go to an API key instead', async () => {
    const { handlers } = harness()
    await handlers['keys:add'](keyRequest('anthropic', SECRET))
    await handlers['settings:update']({ claudeProvider: 'anthropic-api' })
    pauseClaudeCode('/usr/local/bin/claude', { kind: 'session', resetsAt: RESET }, NOW)
    expect(await handlers['claudeCode:getPause']({ projectId: null })).toBeNull()
  })

  test('rejects a bad request', async () => {
    const { handlers } = harness()
    await expect(handlers['claudeCode:getPause']({} as never)).rejects.toThrow(
      'claudeCode:getPause: Invalid request'
    )
    await expect(
      handlers['claudeCode:getPause']({ projectId: null, extra: SECRET } as never)
    ).rejects.toThrow('claudeCode:getPause: Invalid request')
  })
})

describe('the pause tells the window when it starts and when it is lifted', () => {
  test('start and an early lift are told; a lift with no pause is not', () => {
    const heard = vi.fn()
    const stop = onClaudeCodePauseChange(heard)
    pauseClaudeCode('/bin/claude', { kind: 'session', resetsAt: RESET }, NOW)
    expect(claudeCodePause('/bin/claude', NOW)).not.toBeNull()
    clearClaudeCodePause()
    clearClaudeCodePause()
    stop()
    pauseClaudeCode('/bin/claude', { kind: 'session', resetsAt: RESET }, NOW)
    expect(heard.mock.calls).toEqual([[true], [false]])
  })

  test('a listener that throws does not stop the pause', () => {
    const stop = onClaudeCodePauseChange(() => {
      throw new Error('window gone')
    })
    pauseClaudeCode('/bin/claude', { kind: 'session', resetsAt: RESET }, NOW)
    expect(claudeCodePause('/bin/claude', NOW)).not.toBeNull()
    stop()
  })
})
