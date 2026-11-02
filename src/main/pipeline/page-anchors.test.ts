import { describe, expect, test } from 'vitest'
import { TEXTBOLT_HOME_HTML } from '../engine/site-outline.test-helper'
import { pageAnchors } from './page-anchors'

describe('pageAnchors', () => {
  test('links with their visible words, in page order, one per URL, no anchors or mailto', () => {
    const anchors = pageAnchors(TEXTBOLT_HOME_HTML, 'https://textbolt.com/')
    expect(anchors[0]).toEqual({ text: '', url: 'https://textbolt.com/' })
    expect(anchors).toContainEqual({
      text: 'AT&T Email to Text Alternative Complete guide for AT&T migration',
      url: 'https://textbolt.com/migration/att/'
    })
    expect(anchors).toContainEqual({ text: 'Watch the demo', url: 'https://youtu.be/Q2etQ-WSKAY' })
    expect(anchors.some((anchor) => anchor.url.startsWith('mailto:'))).toBe(false)
    expect(anchors.some((anchor) => anchor.url.includes('#'))).toBe(false)
    // <link> tags (stylesheets, icons) are not links a reader clicks.
    expect(anchors.some((anchor) => anchor.url.endsWith('.css'))).toBe(false)
    const urls = anchors.map((anchor) => anchor.url)
    expect(new Set(urls).size).toBe(urls.length)
  })
})
