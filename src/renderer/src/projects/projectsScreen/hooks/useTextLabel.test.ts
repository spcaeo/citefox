import { describe, expect, test } from 'vitest'
import { labelWithText } from './useTextLabel'

describe('labelWithText (WCAG 2.5.3 label in name)', () => {
  test('leads with the visible text unless the label already has it', () => {
    expect(labelWithText('Avg score of Alpha: show each page', '67')).toBe(
      '67 — Avg score of Alpha: show each page'
    )
    expect(labelWithText('17 pages tracked: show each project', '17')).toBe(
      '17 pages tracked: show each project'
    )
    expect(labelWithText('Open Page B', 'page b')).toBe('Open Page B')
    expect(labelWithText(undefined, '3')).toBeUndefined()
    expect(labelWithText('Open', '')).toBe('Open')
  })
})
