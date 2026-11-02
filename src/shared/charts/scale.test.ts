import { describe, expect, it } from 'vitest'
import {
  barLength,
  peakOf,
  percentShares,
  slots,
  splitWhole,
  textWidth,
  truncate,
  wrapTwo
} from './scale'

describe('report chart scales', () => {
  it('maps a value onto the span, with a floor for tiny values', () => {
    expect(barLength(50, 100, 200)).toBe(100)
    expect(barLength(100, 100, 200)).toBe(200)
    expect(barLength(1, 900, 200)).toBe(2)
    expect(barLength(150, 100, 200)).toBe(200)
  })

  it('draws nothing for zero, negative, NaN or an empty scale', () => {
    expect(barLength(0, 100, 200)).toBe(0)
    expect(barLength(-3, 100, 200)).toBe(0)
    expect(barLength(Number.NaN, 100, 200)).toBe(0)
    expect(barLength(5, 0, 200)).toBe(0)
  })

  it('finds the peak, ignoring junk', () => {
    expect(peakOf([3, 9, Number.NaN, Infinity, -2])).toBe(9)
    expect(peakOf([])).toBe(0)
  })

  it('lays out equal slots with gaps that fill the width', () => {
    const cells = slots(4, 400, 12)
    expect(cells).toHaveLength(4)
    const last = cells[3]
    expect(last && last.x + last.width).toBeCloseTo(400, 0)
    expect(slots(0, 400, 12)).toEqual([])
    expect(slots(1, 300, 12)).toEqual([{ x: 0, width: 300 }])
  })

  it('splits a width into whole parts that add up exactly', () => {
    for (const values of [
      [1, 1, 1],
      [3.3, 2.2, 7.7, 0.1],
      [10, 0, 5],
      [-2, 6]
    ]) {
      const parts = splitWhole(values, 517)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(517)
    }
    expect(splitWhole([0, 0], 100)).toEqual([0, 0])
    expect(splitWhole([5], 100)).toEqual([100])
  })

  it('gives every part above 0 its minimum, taken from the biggest', () => {
    const parts = splitWhole([1000, 1, 1], 300, 4)
    expect(parts[1]).toBe(4)
    expect(parts[2]).toBe(4)
    expect(parts.reduce((a, b) => a + b, 0)).toBe(300)
  })

  it('rounds percents so they add up to 100', () => {
    const shares = percentShares([1, 1, 1])
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100)
    expect(percentShares([0, 0, 0])).toEqual([0, 0, 0])
  })

  it('truncates long labels with an ellipsis and keeps short ones', () => {
    expect(truncate('textbolt.com', 200, 12)).toBe('textbolt.com')
    const long = 'a-very-long-domain-name-that-will-not-fit.example.com'
    const cut = truncate(long, 120, 12)
    expect(cut.endsWith('…')).toBe(true)
    expect(textWidth(cut, 12)).toBeLessThanOrEqual(120)
    expect(truncate(long, 1, 12)).toBe('…')
  })

  it('wraps a label onto two balanced lines only when it does not fit', () => {
    expect(wrapTwo('0–3 days', 200, 12)).toEqual(['0–3 days'])
    expect(wrapTwo('2 of 3 pages cited', 60, 11)).toEqual(['2 of 3', 'pages cited'])
    expect(wrapTwo('unbreakable-label', 20, 12)).toEqual(['unbreakable-label'])
  })
})
