import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SITE_TONES } from '../siteIcon/tone'
import {
  contrast,
  DARK,
  hexOf,
  LIGHT,
  plain,
  RENDERER_ROOT,
  resolveHex,
  tokenBlock
} from '../styles/themeColours.test-helper'
import { RESULT_BUCKETS, RESULT_TONES } from './resultTones'

/**
 * Grid audit R15: pills, site icons and chart bars keep at least 3:1 contrast
 * in both themes, so a letter or a status never vanishes on a dark row.
 */
const THEMES = [
  ['light', LIGHT],
  ['dark', DARK]
] as const

const SITE_CSS = 'siteIcon/siteIcon.css'
const SITE_LIGHT = tokenBlock(':root {', SITE_CSS)
const SITE_DARK = tokenBlock(":root[data-theme='dark'] {", SITE_CSS)

/** The background and letter colour of `.site-icon-tone-N`. */
function siteTone(tone: number): { ground: string; ink: string } {
  const text = plain(readFileSync(join(RENDERER_ROOT, SITE_CSS), 'utf8'))
  const rule = new RegExp(`\\.site-icon-tone-${tone}\\s*\\{([^}]*)\\}`).exec(text)?.[1] ?? ''
  const ground = /background:\s*([^;]+);/.exec(rule)?.[1] ?? ''
  const ink = /(?:^|\s)color:\s*([^;]+);/.exec(rule)?.[1] ?? ''
  return { ground, ink }
}

describe('colour contrast in both themes (R15)', () => {
  it.each(Object.entries(RESULT_TONES))('the %s pill’s label reads on its ground', (_, tone) => {
    for (const [theme, block] of THEMES) {
      const ratio = contrast(hexOf(block, tone.ink), hexOf(block, tone.ground))
      // Pill labels are small text: AA, which is more than the 3:1 floor.
      expect(ratio, `${theme} ${tone.ink} on ${tone.ground}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(Array.from({ length: SITE_TONES }, (_, tone) => tone))(
    'site icon tile %i keeps its letter visible',
    (tone) => {
      const { ground, ink } = siteTone(tone)
      expect(ground, 'background').not.toBe('')
      expect(ink, 'color').not.toBe('')
      for (const [theme, block, local] of [
        ['light', LIGHT, SITE_LIGHT],
        ['dark', DARK, new Map([...SITE_LIGHT, ...SITE_DARK])]
      ] as const) {
        const ratio = contrast(resolveHex(block, ink, local), resolveHex(block, ground, local))
        expect(ratio, `${theme} tile ${tone}`).toBeGreaterThanOrEqual(3)
      }
    }
  )

  it.each(RESULT_BUCKETS.map((bucket) => [bucket.key, bucket] as const))(
    'the %s result reads as a bar on the card and as chip text on its tint',
    (_, bucket) => {
      const token = (value: string): string => /var\((--[\w-]+)\)/.exec(value)?.[1] ?? value
      for (const [theme, block] of THEMES) {
        const bar = contrast(hexOf(block, token(bucket.colour)), hexOf(block, '--surface'))
        expect(bar, `${theme} ${bucket.colour} bar`).toBeGreaterThanOrEqual(3)
        const ink = contrast(hexOf(block, token(bucket.ink)), hexOf(block, token(bucket.tint)))
        expect(ink, `${theme} ${bucket.ink} on ${bucket.tint}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it('keeps not cited orange in both themes (R7, 2026-10-29)', () => {
    expect(hexOf(LIGHT, '--result-not-cited')).toBe('#c2410c')
    expect(hexOf(LIGHT, '--result-not-cited-ink')).toBe('#9a3412')
    expect(RESULT_TONES.not_cited.mark).toBe('--result-not-cited')
  })

  it.each(Object.entries(RESULT_TONES).filter(([, tone]) => tone.mark !== null))(
    'draws the %s mark in its own colour (ui/views.css)',
    (_, tone) => {
      const css = plain(readFileSync(join(RENDERER_ROOT, 'ui/views.css'), 'utf8'))
      expect(css).toContain(`--rdot: var(${tone.mark})`)
      for (const [theme, block] of THEMES) {
        const ratio = contrast(hexOf(block, tone.mark ?? ''), hexOf(block, '--surface'))
        expect(ratio, `${theme} ${tone.mark}`).toBeGreaterThanOrEqual(3)
      }
    }
  )

  it('draws Summary’s weekly bars at 3:1 on the card', () => {
    for (const [theme, block] of THEMES) {
      for (const bar of ['--chart-past', '--chart-cited']) {
        const ratio = contrast(resolveHex(block, `var(${bar})`), hexOf(block, '--surface'))
        expect(ratio, `${theme} ${bar}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('paints "cited" in charts green, never the not-cited orange (audit #1)', () => {
    for (const [theme, block] of THEMES) {
      const cited = resolveHex(block, 'var(--chart-cited)')
      expect(cited, `${theme} --chart-cited`).not.toBe(hexOf(block, '--result-not-cited'))
      expect(cited, `${theme} --chart-cited`).not.toBe(resolveHex(block, 'var(--fox)'))
      expect(cited, `${theme} --chart-cited`).toBe(hexOf(block, '--result-target'))
    }
  })

  it('shows "selected" in green, never the Not cited orange or its tint (audit2 #4)', () => {
    for (const [theme, block] of THEMES) {
      const select = hexOf(block, '--select')
      const tint = hexOf(block, '--select-tint')
      expect(tint, `${theme} --select-tint`).not.toBe(hexOf(block, '--result-not-cited-tint'))
      expect(tint, `${theme} --select-tint`).not.toBe(hexOf(block, '--fox-tint'))
      expect(select, `${theme} --select`).not.toBe(hexOf(block, '--result-not-cited'))
      expect(select, `${theme} --select`).not.toBe(hexOf(block, '--fox'))
      // A selected count is small text on the tint: AA. The mark on the card: 3:1.
      expect(contrast(select, tint), `${theme} --select on its tint`).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(select, hexOf(block, '--surface')),
        `${theme} --select`
      ).toBeGreaterThanOrEqual(3)
    }
  })
})
