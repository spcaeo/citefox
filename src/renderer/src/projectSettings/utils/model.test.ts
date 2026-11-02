import { describe, expect, test } from 'vitest'
import type { ApiKeyMetadata } from '@shared/domain'
import {
  addUnique,
  allowanceFor,
  capRuleOptions,
  claudeFromForm,
  cleanDomain,
  connectionOptions,
  errorText,
  fallbackOptions,
  formatBytes,
  keyOptionLabel,
  monthEndLabel,
  nextCheckLabel,
  paceLine,
  parseCap,
  searchFromForm,
  usageLine,
  usagePercent,
  usesClaudeCode
} from './model'
import { formatClock, formatMoment } from '../../utils/dates'

function key(id: string, name: string, patch: Partial<ApiKeyMetadata> = {}): ApiKeyMetadata {
  return {
    id,
    provider: 'anthropic',
    name,
    keychainRef: `ref-${id}`,
    hint: '3e7d',
    rotationOrder: 0,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null,
    ...patch
  }
}

describe('project settings model', () => {
  test('error text drops the Electron wrapper and the channel prefix', () => {
    const error = new Error(
      "Error invoking remote method 'projectSettings:delete': Error: projectSettings:delete: Type the project name exactly to confirm"
    )
    expect(errorText(error)).toBe('Type the project name exactly to confirm.')
    expect(errorText('nope')).toBe('Something went wrong. Try again.')
  })

  test('cap rules name the reset day and the 10% allowance', () => {
    const options = capRuleOptions(3000, '2026-11-01')
    expect(options.map((item) => item.label)).toEqual(['Pause checks', 'Ask me', 'Allow 10% over'])
    expect(options[0]?.hint).toBe('Until the cap resets on Nov 1')
    expect(options[1]?.hint).toBe('Notify me and wait')
    expect(options[2]?.hint).toBe('Up to 3,300 this month')
    expect(capRuleOptions(null, '2026-11-01')[2]?.hint).toBe('10% more than the monthly cap')
    expect(allowanceFor(9, 'allow_10')).toBe(9)
    expect(allowanceFor(10, 'allow_10')).toBe(11)
  })

  test('usage and pace lines', () => {
    const usage = { used: 1240, allowance: 3000, projectedMonthEnd: 2020, resetsOn: '2026-11-01' }
    expect(usageLine(usage)).toBe('1,240 of 3,000')
    expect(usagePercent(usage)).toBe(41)
    expect(paceLine(usage)).toBe('At this pace, about 2,020 by Oct 31.')
    expect(monthEndLabel('2027-01-01')).toBe('Dec 31')
    expect(paceLine({ ...usage, projectedMonthEnd: null })).toBeNull()
    expect(usageLine({ ...usage, allowance: null })).toBe('1,240 · no cap')
  })

  test('cap field: blank is no cap, words are refused', () => {
    expect(parseCap('')).toEqual({ cap: null })
    expect(parseCap('3,000')).toEqual({ cap: 3000 })
    expect(parseCap('lots')).toHaveProperty('error')
    expect(searchFromForm('shared', 500, 'pause', 'key-1')).toEqual({
      source: 'shared',
      cap: 500,
      capRule: 'pause',
      dedicatedKeyId: null
    })
    expect(searchFromForm('dedicated', null, 'notify', 'key-1').dedicatedKeyId).toBe('key-1')
  })

  test('Claude fallbacks never offer the key the project already uses', () => {
    const anthropic = [key('k1', 'My key'), key('k2', 'Acme Clinics')]
    expect(connectionOptions(anthropic).map((item) => item.value)).toEqual([
      'app_default',
      'claude_code',
      'api_key:k1',
      'api_key:k2'
    ])
    const values = fallbackOptions(anthropic, 'api_key:k1').map((item) => item.value)
    expect(values).toEqual(['wait', 'switch_key:k2', 'retry_later', 'ask'])
    expect(fallbackOptions(anthropic, 'claude_code')).toHaveLength(5)
  })

  test('Claude form values become saved settings', () => {
    expect(claudeFromForm('api_key:k1', 'switch_key:k2', ' claude-opus-5-5 ')).toEqual({
      connection: 'api_key',
      keyId: 'k1',
      fallback: 'switch_key',
      fallbackKeyId: 'k2',
      model: 'claude-opus-5-5'
    })
    expect(claudeFromForm('claude_code', 'ask', '')).toEqual({
      connection: 'claude_code',
      keyId: null,
      fallback: 'ask',
      fallbackKeyId: null,
      model: null
    })
    expect(usesClaudeCode('app_default', 'claude-code')).toBe(true)
    expect(usesClaudeCode('app_default', 'anthropic-api')).toBe(false)
    expect(usesClaudeCode('api_key:k1', 'claude-code')).toBe(false)
  })

  test('small formatters', () => {
    expect(cleanDomain('https://www.TextBolt.com/pricing')).toBe('textbolt.com')
    expect(addUnique(['TextBolt'], ' textbolt ')).toEqual(['TextBolt'])
    expect(addUnique(['TextBolt'], 'Text Bolt')).toEqual(['TextBolt', 'Text Bolt'])
    expect(formatBytes(43_620_000)).toBe('41.6 MB')
    expect(
      keyOptionLabel(
        key('s1', 'My plan', {
          provider: 'serpapi',
          hint: '4f2a',
          usedThisMonth: 1240,
          cap: 5000,
          monthlyCap: 5000
        })
      )
    ).toBe('My plan · ••••4f2a · 1,240 of 5,000')
  })
})

describe('nextCheckLabel', () => {
  const now = new Date(2026, 9, 20, 8, 0, 0)

  test("names today or the day, with the time in the computer's own clock style", () => {
    const today = new Date(2026, 9, 20, 9, 0, 0).toISOString()
    const later = new Date(2026, 9, 21, 9, 0, 0).toISOString()
    expect(nextCheckLabel(today, now)).toBe(`Today ${formatClock(today)}`)
    expect(nextCheckLabel(today, now)).toMatch(/^Today 0?9:00(\sAM)?$/)
    expect(nextCheckLabel(later, now)).toBe(formatMoment(later, { now }))
    expect(nextCheckLabel(null, now)).toBe('Nothing is scheduled yet')
  })
})
