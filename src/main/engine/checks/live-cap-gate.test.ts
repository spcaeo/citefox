import { describe, expect, test } from 'vitest'
import { createCapGate } from './key-rotation'

describe('project cap gate with live usage', () => {
  test('searches another check stores while this one runs count against the cap', async () => {
    let stored = 8
    const gate = createCapGate({ allowance: 10, used: () => stored })
    expect(await gate.allow()).toBe(true)
    // This check's search is written to key_usage, so it is now in the live total.
    stored += 1
    gate.settle?.(1)
    // A manual check of another page spends the last search in the meantime.
    stored += 1
    expect(await gate.allow()).toBe(false)
    expect(gate.capHit()).toBe(true)
  })

  test('an admitted search not yet stored still holds its place', async () => {
    const gate = createCapGate({ allowance: 2, used: () => 1 })
    expect(await gate.allow()).toBe(true)
    expect(await gate.allow()).toBe(false)
  })

  test('a fixed starting count keeps counting admissions as before', async () => {
    const gate = createCapGate({ allowance: 2, used: 1 })
    expect(await gate.allow()).toBe(true)
    gate.settle?.(1)
    expect(await gate.allow()).toBe(false)
  })
})
