import { describe, expect, test } from 'vitest'
import { uniqueIds } from './drills'

describe('link drills', () => {
  test('a link listed under two rows gets its own id, so the grid never loops', () => {
    const item = { id: 'page-1|q0|seed-1|0', primary: 'https://twilio.com/sms' }
    const items = uniqueIds([item, { ...item }, { ...item, id: 'other' }, { ...item }] as never)
    expect(items.map((row) => row.id)).toEqual([
      'page-1|q0|seed-1|0',
      'page-1|q0|seed-1|0#2',
      'other',
      'page-1|q0|seed-1|0#3'
    ])
  })
})
