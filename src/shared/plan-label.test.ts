import { describe, expect, test } from 'vitest'
import { planLabel } from './plan-label'

describe('planLabel', () => {
  test('adds "plan" to a bare name', () => {
    expect(planLabel('Developer')).toBe('Developer plan')
    expect(planLabel('Claude Max')).toBe('Claude Max plan')
  })

  test('does not double a name that already ends in plan, in any case', () => {
    expect(planLabel('Volume Plan')).toBe('Volume Plan')
    expect(planLabel('Big Data plan')).toBe('Big Data plan')
    expect(planLabel('  Free PLAN ')).toBe('Free PLAN')
  })

  test('only a whole trailing word counts', () => {
    expect(planLabel('Airplan')).toBe('Airplan plan')
    expect(planLabel('')).toBe('')
  })
})
