import { describe, expect, it } from 'vitest'
import { checkPlanLine } from './checkPlan'

describe('checkPlanLine', () => {
  it('multiplies questions, markets, and samples, two searches at most each', () => {
    expect(checkPlanLine(10, 4, 1)).toBe(
      'Checking 10 questions in each market · 1–2 searches per question, market and sample: up to 80 searches'
    )
  })

  it('uses singular nouns and en-US grouping', () => {
    expect(checkPlanLine(1, 1, 3)).toBe(
      'Checking 1 question in each market · 1–2 searches per question, market and sample: up to 6 searches'
    )
    expect(checkPlanLine(250, 4, 2)).toContain('up to 4,000 searches')
  })
})
