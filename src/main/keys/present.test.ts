import { describe, expect, test } from 'vitest'
import type { ApiKeyRecord } from '../storage/records'
import {
  describeKeyStatus,
  effectiveMonthlyLimit,
  maskedKeyFromHint,
  presentApiKey
} from './present'

describe('effective monthly limit', () => {
  test('uses the lower of the monthly cap and the plan allowance', () => {
    expect(effectiveMonthlyLimit(100, 40)).toBe(40)
    expect(effectiveMonthlyLimit(30, 250)).toBe(30)
    expect(effectiveMonthlyLimit(100, null)).toBe(100)
    expect(effectiveMonthlyLimit(null, 40)).toBe(40)
    expect(effectiveMonthlyLimit(null, null)).toBeNull()
  })
})

describe('key status detail', () => {
  test('warns near the lower limit and not the higher one', () => {
    const nearPlan = describeKeyStatus({
      state: 'ok',
      lastReason: null,
      monthlyCap: 100,
      planLimit: 40,
      usedThisMonth: 36
    })
    expect(nearPlan).toEqual({ status: 'ok', statusDetail: 'Near cap' })

    const underHigherCap = describeKeyStatus({
      state: 'ok',
      lastReason: null,
      monthlyCap: 100,
      planLimit: 250,
      usedThisMonth: 36
    })
    expect(underHigherCap).toEqual({ status: 'ok', statusDetail: null })

    const nearUserCap = describeKeyStatus({
      state: 'ok',
      lastReason: null,
      monthlyCap: 30,
      planLimit: 250,
      usedThisMonth: 28
    })
    expect(nearUserCap).toEqual({ status: 'ok', statusDetail: 'Near cap' })
  })

  test('says at cap when usage has reached the lower limit', () => {
    expect(
      describeKeyStatus({
        state: 'ok',
        lastReason: null,
        monthlyCap: 100,
        planLimit: 40,
        usedThisMonth: 40
      })
    ).toEqual({ status: 'ok', statusDetail: 'At cap' })
  })

  test('keeps the stored warning and names the last failure', () => {
    expect(
      describeKeyStatus({
        state: 'warning',
        lastReason: 'rate_limited',
        monthlyCap: 100,
        planLimit: 40,
        usedThisMonth: 36
      })
    ).toEqual({ status: 'warning', statusDetail: 'Rate limited' })
    expect(
      describeKeyStatus({
        state: 'warning',
        lastReason: 'rejected',
        monthlyCap: null,
        planLimit: null,
        usedThisMonth: 0
      })
    ).toEqual({ status: 'warning', statusDetail: 'Auth failed' })
  })
})

describe('read-only copies', () => {
  test('enabled and monthlyCap follow on and cap', () => {
    const record = {
      id: 'key-1',
      provider: 'serpapi',
      name: 'Personal',
      keychainRef: 'citefox.serpapi.key-1',
      hint: '9f3c',
      rotationOrder: 0,
      cap: 3,
      on: false,
      projectIds: [],
      state: 'ok',
      lastReason: null,
      serpapiUsage: null,
      plan: null,
      enabled: true,
      monthlyCap: 9
    } as ApiKeyRecord
    const presented = presentApiKey(record, 0)
    expect(presented.on).toBe(false)
    expect(presented.enabled).toBe(false)
    expect(presented.cap).toBe(3)
    expect(presented.monthlyCap).toBe(3)
  })
})

describe('masked key', () => {
  test('builds the mask from the hint and hides a short secret', () => {
    expect(maskedKeyFromHint('9f3c')).toBe('••••9f3c')
    expect(maskedKeyFromHint('')).toBe('')
    expect(maskedKeyFromHint('9f3c')).not.toContain('serp-live-secret-value')
  })
})
