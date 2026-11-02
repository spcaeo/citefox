import { describe, expect, it } from 'vitest'
import { tintProps } from './classes'

describe('tintProps', () => {
  it('adds the tint utility and its meaning, and leaves an untinted card alone', () => {
    expect(tintProps('ov-verdict', 'win')).toEqual({
      className: 'ov-verdict ui-tint',
      'data-tint': 'win'
    })
    expect(tintProps('tr-summary', 'attention')).toEqual({
      className: 'tr-summary ui-tint',
      'data-tint': 'attention'
    })
    expect(tintProps('ov-verdict', null)).toEqual({ className: 'ov-verdict' })
    expect(tintProps('ov-verdict', undefined)).toEqual({ className: 'ov-verdict' })
  })
})
