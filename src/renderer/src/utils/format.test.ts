import { describe, expect, it } from 'vitest'
import { formatClock } from './dates'
import {
  changeDirection,
  formatCount,
  formatGridDate,
  formatGridDateTitle,
  formatMoney,
  formatOutOf,
  formatPercent,
  formatPoints,
  formatRange,
  formatShare,
  formatSigned
} from './format'

describe('grid value formats (R8, R9)', () => {
  it('tells empty from a real zero', () => {
    expect(formatCount(null)).toBe('—')
    expect(formatCount(undefined)).toBe('—')
    expect(formatCount(0)).toBe('0')
    expect(formatCount(1204)).toBe('1,204')
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(0)).toBe('0%')
  })

  it('writes whole percents', () => {
    expect(formatPercent(41.6)).toBe('42%')
    expect(formatShare(1, 3)).toBe('33%')
    expect(formatShare(0, 0)).toBe('—')
  })

  it('never writes +0 for no change', () => {
    expect(formatSigned(0)).toBe('—')
    expect(formatSigned(0.2)).toBe('—')
    expect(formatSigned(null)).toBe('—')
    expect(formatSigned(3)).toBe('+3')
    expect(formatSigned(-2)).toBe('−2')
    expect(formatSigned(1500)).toBe('+1,500')
    expect(changeDirection(0)).toBe('flat')
    expect(changeDirection(4)).toBe('up')
    expect(changeDirection(-4)).toBe('down')
  })

  it('writes point changes with a real minus sign', () => {
    expect(formatPoints(11)).toBe('+11 pts')
    expect(formatPoints(-3)).toBe('−3 pts')
    expect(formatPoints(1)).toBe('+1 pt')
    expect(formatPoints(0)).toBe('—')
    expect(formatPoints(null)).toBe('—')
  })

  it('writes money in dollars and cents', () => {
    expect(formatMoney(0.03)).toBe('$0.03')
    expect(formatMoney(0)).toBe('$0.00')
    expect(formatMoney(1204.5)).toBe('$1,204.50')
    expect(formatMoney(0.001)).toBe('<$0.01')
    expect(formatMoney(null)).toBe('—')
  })

  it('writes ranges and parts as one value', () => {
    expect(formatRange(2, 4)).toBe('2–4')
    expect(formatRange(3, 3)).toBe('3')
    expect(formatRange(null, null)).toBe('—')
    expect(formatOutOf(1, 2)).toBe('1 / 2')
    expect(formatOutOf(null, 2)).toBe('—')
  })

  it('drops the year only for this year', () => {
    const now = new Date('2026-10-29T12:00:00Z')
    const options = { now, timeZone: 'UTC' }
    expect(formatGridDate('2026-10-19T09:14:00Z', options)).toBe('Oct 19')
    expect(formatGridDate('2025-10-19T09:14:00Z', options)).toBe('Oct 19, 2025')
    expect(formatGridDate(null, options)).toBe('—')
    expect(formatGridDate('not a date', options)).toBe('—')
  })

  it('puts the full date and time in the tooltip', () => {
    // The time follows the computer's clock style ("6:30 PM" or "18:30").
    const iso = '2026-10-19T18:30:00Z'
    expect(formatGridDateTitle(iso, { timeZone: 'UTC' })).toBe(
      `Oct 19, 2026, ${formatClock(iso, { timeZone: 'UTC' })}`
    )
    expect(formatGridDateTitle(iso, { timeZone: 'UTC' })).toMatch(
      /^Oct 19, 2026, (6:30\sPM|18:30)$/
    )
    expect(formatGridDateTitle(null)).toBe('')
  })
})
