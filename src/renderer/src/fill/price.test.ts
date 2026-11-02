import { describe, expect, it } from 'vitest'
import { lowestPrices, parsePrice } from './price'

describe('parsePrice', () => {
  it('reads the unit and divides a bundle down to one unit', () => {
    expect(parsePrice('From $20/mo')).toMatchObject({ perUnit: 20, unit: 'month', currency: 'USD' })
    expect(parsePrice('$0.019/text')).toMatchObject({ perUnit: 0.019, unit: 'message' })
    expect(parsePrice('$0.0077 per SMS')).toMatchObject({ unit: 'message' })
    expect(parsePrice('$24.50 / 500 texts')).toMatchObject({ perUnit: 0.049, unit: 'message' })
    expect(parsePrice('$25/user/mo')).toMatchObject({ perUnit: 25, unit: 'user-month' })
    expect(parsePrice('$650 one-time')).toMatchObject({ perUnit: 650, unit: 'one-time' })
    expect(parsePrice('€19 per month')).toMatchObject({ currency: 'EUR', unit: 'month' })
    expect(parsePrice('$1,200/yr')).toMatchObject({ perUnit: 100, unit: 'month', plan: 1200 })
    expect(parsePrice('$5 per contact')).toMatchObject({ unit: 'other', word: 'contact' })
  })

  it('has no price for words without a number', () => {
    expect(parsePrice('Contact sales')).toBeNull()
    expect(parsePrice(null)).toBeNull()
    expect(parsePrice('')).toBeNull()
    expect(parsePrice('Free plan')).toMatchObject({ perUnit: 0, unit: 'month' })
    expect(parsePrice('Free trial')).toBeNull()
  })
})

describe('lowestPrices', () => {
  const direct = [
    { id: 'text.email', startingPrice: 'From $20/mo' },
    { id: 'smsglobal', startingPrice: '$0.019/text' },
    { id: 'clicksend', startingPrice: '$0.02/text' },
    { id: 'textmagic', startingPrice: '$24.50 / 500 texts' },
    { id: 'txtimpact', startingPrice: 'From $29/mo' },
    { id: 'sakari', startingPrice: null }
  ]

  it('marks the cheapest per unit, one mark per shared unit, with a tooltip saying so', () => {
    const marks = lowestPrices(direct, 'direct competitors')
    expect([...marks.keys()].sort()).toEqual(['smsglobal', 'text.email'])
    expect(marks.get('smsglobal')).toEqual({
      label: 'Lowest per text',
      tooltip: 'Cheapest per message among the 3 direct competitors that list a price per message.'
    })
    expect(marks.get('text.email')?.label).toBe('Lowest monthly')
  })

  it('compares plan prices when no unit is shared', () => {
    const marks = lowestPrices(
      [
        { id: 'a', startingPrice: '$650 one-time' },
        { id: 'b', startingPrice: '$25/user/mo' },
        { id: 'c', startingPrice: '$0.008/text' }
      ],
      'partial competitors'
    )
    expect([...marks.keys()]).toEqual(['c'])
    expect(marks.get('c')?.label).toBe('Lowest plan price')
    expect(marks.get('c')?.tooltip).toMatch(/units differ/)
  })

  it('marks nothing with fewer than two prices, and every competitor in a tie', () => {
    expect(lowestPrices([{ id: 'a', startingPrice: '$9/mo' }], 'x').size).toBe(0)
    const tie = lowestPrices(
      [
        { id: 'a', startingPrice: '$9/mo' },
        { id: 'b', startingPrice: '$9 a month' },
        { id: 'c', startingPrice: '$19/mo' }
      ],
      'x'
    )
    expect([...tie.keys()].sort()).toEqual(['a', 'b'])
  })
})
