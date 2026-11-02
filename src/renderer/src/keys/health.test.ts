import { describe, expect, test } from 'vitest'
import type { ApiKeyMetadata } from '@shared/domain'
import type { KeyTestResult } from '@shared/ipc'
import { statusIssueCount } from '../shell/model'
import {
  capLabel,
  connectionStateLabel,
  keyWarningReason,
  projectsLabel,
  rollUpClaudeState,
  rollUpKeyState,
  searchesLeftForKey,
  warningCopy,
  WORKING_KEY_NOTE
} from './health'

function key(overrides: Partial<ApiKeyMetadata> = {}): ApiKeyMetadata {
  return {
    id: 'key-1',
    provider: 'serpapi',
    name: 'SerpApi',
    keychainRef: 'serpapi/key-1',
    hint: 'b1f4',
    rotationOrder: 1,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: { used: 38, planLimit: 250, plan: 'Developer' },
    ...overrides
  }
}

describe('connection roll-up', () => {
  test('no key and a key the user turned off are off', () => {
    expect(rollUpKeyState(null)).toBe('off')
    expect(rollUpKeyState(undefined)).toBe('off')
    expect(rollUpKeyState(key({ on: false, state: 'ok' }))).toBe('off')
    expect(rollUpKeyState(key({ on: false, state: 'warning', lastReason: 'other' }), false)).toBe(
      'off'
    )
  })

  test('a saved untested key is unchecked, and a missing keychain item is warning', () => {
    expect(rollUpKeyState(key({ state: 'unchecked', serpapiUsage: null }))).toBe('unchecked')
    expect(rollUpKeyState(key({ state: 'ok' }), false)).toBe('warning')
    expect(rollUpKeyState(key({ state: 'warning', lastReason: 'other' }))).toBe('warning')
    expect(rollUpKeyState(key({ state: 'ok' }))).toBe('ok')
  })

  test('Claude Code is unchecked, ok, or warning from the last checkup', () => {
    expect(rollUpClaudeState(null)).toBe('unchecked')
    expect(rollUpClaudeState(undefined)).toBe('unchecked')
    expect(rollUpClaudeState({ ready: true })).toBe('ok')
    expect(rollUpClaudeState({ ready: false })).toBe('warning')
  })
})

describe('issue count', () => {
  test('counts warning states and ignores off and unchecked', () => {
    expect(
      statusIssueCount({
        serpapi: 'warning',
        claudeCode: 'ok',
        jina: 'off',
        youtube: 'unchecked'
      })
    ).toBe(1)
    expect(
      statusIssueCount({
        serpapi: 'warning',
        claudeCode: 'warning',
        jina: 'warning',
        youtube: 'warning'
      })
    ).toBe(4)
    expect(
      statusIssueCount({ serpapi: 'off', claudeCode: 'unchecked', jina: 'ok', youtube: 'off' })
    ).toBe(0)
  })
})

describe('searches left, cap, and projects', () => {
  test('uses the plan allowance, then the cap, and treats out of searches as zero', () => {
    expect(searchesLeftForKey(key())).toBe(212)
    expect(
      searchesLeftForKey(
        key({
          state: 'warning',
          lastReason: 'out_of_searches',
          serpapiUsage: { used: 250, planLimit: 250, plan: 'Developer' }
        })
      )
    ).toBe(0)
    expect(searchesLeftForKey(key({ serpapiUsage: null, cap: 80 }))).toBe(80)
    expect(
      searchesLeftForKey(
        key({ serpapiUsage: null, cap: null, state: 'warning', lastReason: 'other' })
      )
    ).toBeNull()
    expect(searchesLeftForKey(key({ state: 'unchecked', serpapiUsage: null, cap: 80 }))).toBeNull()
    expect(searchesLeftForKey(key({ on: false }))).toBeNull()
    expect(searchesLeftForKey(null)).toBeNull()
  })

  test('empty project ids are all projects and a null cap is no cap', () => {
    expect(projectsLabel([])).toBe('All projects')
    expect(projectsLabel(['acme'])).toBe('acme')
    expect(capLabel(null)).toBe('No cap')
    expect(capLabel(5000)).toBe('5,000 searches')
    expect(connectionStateLabel('unchecked')).toBe('Not tested')
  })
})

describe('warning reason', () => {
  test('reads reason and does not infer it from usage or the message', () => {
    const quota = key({
      state: 'warning',
      lastReason: 'out_of_searches',
      serpapiUsage: { used: 250, planLimit: 250, plan: 'Developer' }
    })
    const rejected = key({ state: 'warning', lastReason: 'other', serpapiUsage: null })
    const quotaResult: KeyTestResult = {
      key: quota,
      message: 'SerpApi is out of searches for this month. Raise the plan or wait until it resets.',
      reason: 'out_of_searches'
    }
    const rejectedResult: KeyTestResult = {
      key: rejected,
      message:
        'SerpApi rejected this key. Check the key on your SerpApi dashboard and paste it again.',
      reason: 'rejected'
    }
    expect(keyWarningReason(quotaResult)).toBe('out_of_searches')
    expect(keyWarningReason(rejectedResult)).toBe('rejected')
    expect(keyWarningReason({ ...quotaResult, reason: 'rejected' })).toBe('rejected')
    expect(keyWarningReason({ ...quotaResult, reason: null })).toBeNull()
    expect(keyWarningReason({ ...rejectedResult, reason: 'rate_limited' })).toBe('rate_limited')
    expect(keyWarningReason({ ...rejectedResult, reason: 'timeout' })).toBe('timeout')
    expect(keyWarningReason({ ...rejectedResult, reason: 'other' })).toBe('other')
  })

  test('out of searches copy is not the rejected-key copy', () => {
    const quota = warningCopy('serpapi', 'out_of_searches')
    const rejected = warningCopy('serpapi', 'rejected')
    expect(quota).toMatch(/out of searches/)
    expect(quota).not.toMatch(/rejected/)
    expect(rejected).toMatch(/rejected this key/)
    expect(WORKING_KEY_NOTE).toMatch(/key works/)
    expect(warningCopy('jina', 'timeout')).toMatch(/timed out/)
    expect(warningCopy('serpapi', 'rate_limited')).toMatch(/429/)
    expect(warningCopy('youtube', 'other')).toMatch(/could not read/)
  })
})
