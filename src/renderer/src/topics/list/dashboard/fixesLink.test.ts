import { describe, expect, test } from 'vitest'
import { fixesLink } from './fixesLink'

describe('the Topics KPI link to Fixes', () => {
  test('one topic opens Fixes cut to it, with its own count', () => {
    expect(fixesLink([{ id: 't1' }], 14, 15)).toEqual({
      href: '#/fixes?topic=t1',
      text: 'As 14 page fixes in Fixes'
    })
  })

  test('several topics name both counts when tracked pages feed Fixes too', () => {
    expect(fixesLink([{ id: 't1' }, { id: 't2' }], 14, 15)).toEqual({
      href: '#/fixes',
      text: 'As 14 of the 15 page fixes in Fixes'
    })
    expect(fixesLink([{ id: 't1' }, { id: 't2' }], 1, 1).text).toBe('As 1 page fix in Fixes')
    expect(fixesLink([{ id: 't1' }, { id: 't2' }], 3, null).text).toBe('As 3 page fixes in Fixes')
  })
})
