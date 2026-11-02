import { describe, expect, it } from 'vitest'
import { STATUS_LABELS as TABLE_LABELS } from '../report-tables/detail'
import { statusLabel } from '../model/trends'
import { STATUS_LABELS } from './format'
import { reportCss } from './style'

/** A report reads like the screens: the app's result words and colours (owner, 2026-10-29). */
describe('report result words and colours', () => {
  it('says Target page, Your other page, Not cited and No AI Overview everywhere', () => {
    for (const labels of [STATUS_LABELS, TABLE_LABELS]) {
      expect(labels.page_cited).toBe('Target page')
      expect(labels.other_own_page).toBe('Your other page')
      expect(labels.not_cited).toBe('Not cited')
      expect(labels.no_aio).toBe('No AI Overview')
    }
    expect(statusLabel('page_cited', 2)).toBe('Target page #2')
    expect(statusLabel('other_own_page', 1)).toBe('Your other page #1')
  })

  it('draws not cited orange, your other page blue and the target page green, light and dark', () => {
    const css = reportCss('#1b7046')
    expect(css).toContain(
      '.s-none { background: var(--r-not-cited-tint); color: var(--r-not-cited); }'
    )
    expect(css).toContain('.s-own { background: var(--r-other-tint); color: var(--r-other); }')
    expect(css).toContain('.s-target { background: var(--r-target-tint); color: var(--r-target); }')
    expect(css).toMatch(/--r-not-cited: #9a3412;[\s\S]*--r-not-cited: #f0915f;/)
  })
})
