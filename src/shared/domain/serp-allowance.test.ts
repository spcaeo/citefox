import { describe, expect, test } from 'vitest'
import { serpKeyAllowance } from './serp-allowance'

describe('serpKeyAllowance', () => {
  test('a CiteFox cap counts CiteFox searches, not the whole SerpApi account (live run)', () => {
    // The live TextBolt run: the key is shared with other traffic (161,522 used on a
    // 250,000 plan), CiteFox's budget is 60 and CiteFox counted 52.
    const allowance = serpKeyAllowance({
      cap: 60,
      usedThisMonth: 52,
      serpapiUsage: { used: 161_522, planLimit: 250_000, plan: 'Volume Plan' }
    })
    expect(allowance).toEqual({
      basis: 'cap',
      used: 52,
      limit: 60,
      left: 8,
      plan: { used: 161_522, limit: 250_000 }
    })
  })

  test('the plan still bounds what is left when it is tighter than the cap', () => {
    const allowance = serpKeyAllowance({
      cap: 1000,
      usedThisMonth: 10,
      serpapiUsage: { used: 4990, planLimit: 5000, plan: null }
    })
    expect(allowance?.left).toBe(10)
    expect(allowance?.used).toBe(10)
    expect(allowance?.limit).toBe(1000)
  })

  test('without a cap the figure is the SerpApi plan', () => {
    expect(
      serpKeyAllowance({
        cap: null,
        usedThisMonth: 3,
        serpapiUsage: { used: 18, planLimit: 250, plan: null }
      })
    ).toEqual({ basis: 'plan', used: 18, limit: 250, left: 232, plan: { used: 18, limit: 250 } })
  })

  test('a cap before any test counts CiteFox searches only', () => {
    expect(serpKeyAllowance({ cap: 30, usedThisMonth: 0, serpapiUsage: null })).toEqual({
      basis: 'cap',
      used: 0,
      limit: 30,
      left: 30,
      plan: null
    })
  })

  test('no cap and no plan is unknown', () => {
    expect(serpKeyAllowance({ cap: null, serpapiUsage: null })).toBeNull()
  })
})
