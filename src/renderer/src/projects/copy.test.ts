import { describe, expect, test } from 'vitest'
import {
  checkSearchEstimate,
  monthlyCheckEstimate,
  pageSearchPreviewLabel,
  showingPages,
  trayDueLabel,
  trayRunningLabel
} from './copy'

describe('project copy', () => {
  test('formats tray status, page counts, and the search estimate', () => {
    expect(trayRunningLabel(false)).toBe('Not running in the tray')
    expect(trayRunningLabel(true)).toBe('Running in the tray')
    expect(trayDueLabel(0)).toBe('0 pages due today')
    expect(trayDueLabel(1)).toBe('1 page due today')
    expect(trayDueLabel(14)).toBe('14 pages due today')
    expect(showingPages(0, 0)).toBe('Showing 0 pages')
    expect(showingPages(1, 1)).toBe('Showing 1 page')
    expect(showingPages(2, 2)).toBe('Showing 2 pages')
    expect(showingPages(186, 186)).toBe('Showing 186 pages')
    expect(showingPages(0, 1)).toBe('Showing 0 of 1 page')
    expect(showingPages(1, 2)).toBe('Showing 1 of 2 pages')
    expect(showingPages(12, 186)).toBe('Showing 12 of 186 pages')
    expect(checkSearchEstimate(10, 1, 1)).toBe('With 10 questions in 1 market: 10–20 searches.')
    expect(checkSearchEstimate(1, 2, 1)).toBe('With 1 question in 2 markets: 2–4 searches.')
    expect(monthlyCheckEstimate(10, 2, 1, 14)).toBe(
      'Every 14 days that is about 2 checks a month: 40–80 searches a month for this page.'
    )
    expect(pageSearchPreviewLabel(8)).toBeNull()
    expect(pageSearchPreviewLabel(9)).toBe('Showing 8 of 9')
  })
})
