// @vitest-environment happy-dom
import {
  buildReport,
  EMPTY_EXTRAS,
  REPORT_KINDS,
  type ReportExtras,
  type ReportKind
} from '@shared/report/review'
import { describe, expect, test } from 'vitest'
import { sampleContext, sampleMetrics } from '../../../shared/report/review/sample.test-helper'
import { answerExtras } from '../../../shared/report/review/sources.test-helper'
import { CLIENT_SCRIPT } from '../html/client/app'
import { reviewDocumentHtml } from './document'
import { htmlProblems } from './quality'

/**
 * The owner's copy/open rule in the downloaded ready reports (Docs/REPORT-SPEC.md "Copy
 * and open"): no cell shows a bare web address or a `/path` without Copy, and every
 * question has Copy. The quality check still passes and the numbers stay the same.
 */

const SITE = 'https://textbolt.com'
const EXTRAS: ReportExtras = {
  ...EMPTY_EXTRAS,
  backlinks: [
    {
      url: `${SITE}/textbolt-for-schools`,
      title: 'TextBolt for schools',
      priority: 'first',
      reason: 'Not indexed',
      anchor: 'TextBolt for schools',
      anchorSaved: false,
      daysLive: 5
    }
  ],
  answers: answerExtras()
}

function file(kind: ReportKind, extras: ReportExtras = EXTRAS): string {
  const metrics = sampleMetrics(kind === 'visibility' ? { from: null } : {})
  const report = buildReport(metrics, sampleContext(kind), extras)
  return reviewDocumentHtml({
    title: report.title,
    domain: 'textbolt.com',
    scopeLabel: 'Whole project',
    marketLabel: 'US · EN',
    builtLabel: 'Nov 2',
    fileBase: `textbolt-${kind}`,
    variants: [{ view: 'all', label: 'All engines', report, metrics }]
  })
}

const SKIP = '.cp, script, style, pre, option, th, svg, .sr-only, [aria-hidden="true"]'
const ADDRESS = /https?:\/\/|^\/[\w\-.%][\w\-./%]*$/i

function bareAddresses(root: ParentNode): string[] {
  const found: string[] = []
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim()
    if (text === '' || !ADDRESS.test(text)) continue
    const parent = node.parentElement
    if (parent === null || parent.closest(SKIP) !== null) continue
    found.push(text)
  }
  return found
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('downloaded reports: Copy and Open on every address', () => {
  for (const kind of REPORT_KINDS) {
    test(`${kind}: no bare address or path; questions and addresses carry Copy`, () => {
      const html = file(kind)
      const doc = parse(html)
      const main = doc.querySelector('main') as HTMLElement
      expect(bareAddresses(main)).toEqual([])
      const copies = main.querySelectorAll('.cp .cp-copy[data-copy]')
      expect(copies.length).toBeGreaterThan(3)
      // An address opens in a new tab; a question has Copy only.
      const open = main.querySelector('.cp-url .cp-open') as HTMLAnchorElement
      expect(open.getAttribute('href')).toMatch(/^https:\/\//)
      expect(open.getAttribute('target')).toBe('_blank')
      for (const question of main.querySelectorAll('.rv-rowbtn')) {
        expect(question.closest('.cp-text'), question.textContent ?? '').not.toBeNull()
      }
      // Still passes its check; the icons are hidden in print.
      expect(htmlProblems(html, [])).toEqual([])
      expect(html).toMatch(/@media print \{ \.cp-acts \{ display: none !important; \}/)
    })
  }

  test('the copy controls add no visible words: the same text with or without them', () => {
    const html = file('impact')
    const words = (source: string): string =>
      (parse(source).querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ')
    const stripped = html.replace(/<span class="cp-acts">[\s\S]*?<\/span><\/span>/g, '</span>')
    expect(words(html)).toBe(words(stripped))
  })

  test('the report script copies the value and shows the tick', async () => {
    const html = file('impact')
    document.documentElement.innerHTML = parse(html).documentElement.innerHTML
    const writes: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => void writes.push(text) },
      configurable: true
    })
    new Function(CLIENT_SCRIPT)()
    const button = document.querySelector('.cp-url .cp-copy') as HTMLButtonElement
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(writes).toEqual([button.getAttribute('data-copy')])
    expect(button.closest('.cp')?.classList.contains('cp-done')).toBe(true)
  })
})
