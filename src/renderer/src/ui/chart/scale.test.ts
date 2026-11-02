import { describe, expect, it } from 'vitest'
import {
  spreadLabels,
  areaPath,
  clampCard,
  countTicks,
  dayStartIso,
  linearScale,
  localDayKey,
  monotonePath,
  nearestIndex,
  rateTicks,
  segmentsOf,
  timeExtent
} from './scale'

describe('chart scales', () => {
  it('maps a domain onto a range, and a flat domain to the middle', () => {
    const scale = linearScale([0, 10], [100, 200])
    expect(scale(0)).toBe(100)
    expect(scale(5)).toBe(150)
    expect(linearScale([3, 3], [0, 50])(3)).toBe(25)
  })

  it('finds the time extent and skips dates that do not parse', () => {
    expect(timeExtent(['2026-10-02T00:00:00Z', 'nope', '2026-09-01T00:00:00Z'])).toEqual([
      Date.parse('2026-09-01T00:00:00Z'),
      Date.parse('2026-10-02T00:00:00Z')
    ])
    expect(timeExtent([])).toBeNull()
  })

  it('keeps the rate axis rule: 10% steps up to 50%, then 25% steps', () => {
    expect(rateTicks(0.2)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5])
    expect(rateTicks(0.58)).toEqual([0, 0.25, 0.5, 0.75])
    expect(rateTicks(1)).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('builds whole-number ticks that reach the peak', () => {
    expect(countTicks(11)).toEqual([0, 3, 6, 9, 12])
    expect(countTicks(0)).toEqual([0, 1])
  })
})

describe('smooth line', () => {
  it('draws a monotone curve that never overshoots a flat stretch', () => {
    const d = monotonePath([
      [0, 50],
      [10, 50],
      [20, 10]
    ])
    expect(d.startsWith('M0,50 C')).toBe(true)
    // The control points of the flat first segment stay on y = 50.
    expect(d).toContain('C3.3,50 6.7,50 10,50')
  })

  it('stays between its points when two checks are minutes apart and the next is days away', () => {
    const points = [
      [0, 100],
      [0.5, 20],
      [200, 10]
    ] as const
    const d = monotonePath(points)
    const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((match) => Number(match[2]))
    // Every control point stays inside the data's own range: no spike past the chart.
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(10)
      expect(y).toBeLessThanOrEqual(100)
    }
  })

  it('closes the area down to the baseline', () => {
    const d = areaPath(
      [
        [0, 10],
        [10, 20]
      ],
      100
    )
    expect(d.endsWith('L10,100 L0,100 Z')).toBe(true)
    expect(areaPath([[0, 1]], 100)).toBe('')
  })

  it('splits a series at its gaps', () => {
    const runs = segmentsOf([1, null, 2, 3, null, null, 4], (value) => value !== null)
    expect(runs).toEqual([[1], [2, 3], [4]])
  })
})

describe('hover and layout', () => {
  it('snaps to the nearest x', () => {
    expect(nearestIndex([0, 40, 100], 60)).toBe(1)
    expect(nearestIndex([], 5)).toBeNull()
  })

  it('keeps a card inside the chart', () => {
    expect(clampCard(10, 200, 600)).toBe(0)
    expect(clampCard(590, 200, 600)).toBe(400)
    expect(clampCard(300, 200, 600)).toBe(200)
  })

  it('reads a day in the local zone and back', () => {
    const iso = dayStartIso('2026-03-27')
    expect(localDayKey(iso)).toBe('2026-03-27')
  })
})

describe('spreadLabels', () => {
  it('leaves labels that are far apart where they are', () => {
    expect(spreadLabels([10, 50, 90], 13)).toEqual([10, 50, 90])
  })

  it('moves crowded labels apart, in order, centred on their values', () => {
    const [a, b, c] = spreadLabels([100, 40, 102], 13)
    expect(b).toBe(40)
    expect((c as number) - (a as number)).toBe(13)
    expect(((a as number) + (c as number)) / 2).toBe(101)
  })
})
