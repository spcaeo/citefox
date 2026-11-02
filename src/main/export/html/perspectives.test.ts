import { Window } from 'happy-dom'
import { afterEach, describe, expect, test } from 'vitest'
import type { ReportSectionId } from '@shared/domain'
import { CLIENT_SCRIPT, htmlReportPreviewText, renderHtmlReport } from '.'
import type { ReportModel } from '../model/types'
import { fullReportModel } from './report-model.test-helper'

/**
 * The verdict, "What changed", "How this report was made", the kind-of-site table and the earlier
 * bars in the HTML report, and the change chips run by the app script in happy-dom.
 */

const windows: Window[] = []

afterEach(() => {
  for (const window of windows.splice(0)) void window.happyDOM.close()
})

function render(model: ReportModel): string {
  return renderHtmlReport(model, { secrets: [] })
}

function open(model: ReportModel): Window['document'] {
  const window = new Window({ url: 'https://report.local/index.html', width: 1280, height: 900 })
  windows.push(window)
  window.document.write(render(model).replace(`<script>${CLIENT_SCRIPT}</script>`, ''))
  window.eval(CLIENT_SCRIPT)
  return window.document
}

function sectionOrder(html: string): string[] {
  return [...html.matchAll(/<section id="(sec-[a-z-]+)"/g)].map((match) => match[1] ?? '')
}

describe('HTML report perspectives', () => {
  const model = fullReportModel()
  const html = render(model)

  test('the verdict follows the cover, then What to do next; What changed the overview; How this report was made is last', () => {
    const order = sectionOrder(html)
    expect(order.slice(0, 5)).toEqual([
      'sec-cover',
      'sec-verdict',
      'sec-next',
      'sec-overview',
      'sec-what-changed'
    ])
    expect(order.at(-1)).toBe('sec-method')
    for (const anchor of ['sec-verdict', 'sec-next', 'sec-what-changed', 'sec-method']) {
      expect(html).toContain(`data-target="${anchor}"`)
    }
    expect(html).toContain('>Verdict</h2>')
    expect(html).toContain('>What to do next</h2>')
    expect(html).toContain('>What changed</h2>')
    expect(html).toContain('>How this report was made</h2>')
  })

  test('without the overview: no verdict, What changed sits before the trends; method always', () => {
    const trendsOnly = render({
      ...model,
      sections: ['competition', 'trends'] as ReportSectionId[]
    })
    expect(sectionOrder(trendsOnly)).toEqual([
      'sec-cover',
      'sec-competition',
      'sec-what-changed',
      'sec-trends',
      'sec-method'
    ])
    const promptsOnly = render({ ...model, sections: ['prompts'] as ReportSectionId[] })
    expect(sectionOrder(promptsOnly)).toEqual(['sec-cover', 'sec-prompts', 'sec-method'])
  })

  test('the verdict: badge, coloured lead phrases, inline numbers that drill to n prompts', () => {
    const document = open(model)
    expect(document.querySelector('[data-testid="verdict-badge"]')?.textContent).toBe(
      model.verdict.label
    )
    const findings = document.querySelectorAll('.vd-finding')
    expect(findings).toHaveLength(model.verdict.findings.length)
    expect(findings[0]?.className).toContain('vd-ok')
    expect(findings[0]?.querySelector('.vd-lead')?.textContent).toBe('More answers cite you.')
    const numbers = document.querySelectorAll('.vd-finding button.drill')
    expect(numbers.length).toBeGreaterThan(6)
    for (const number of numbers) {
      const token = number.getAttribute('data-drill') ?? ''
      expect(number.textContent).toBe(String(model.drills[token]?.length))
    }
    const gained = document.querySelector(
      '.vd-finding button.drill[data-drill="change:gained"]'
    ) as unknown as HTMLButtonElement
    gained.click()
    expect(document.querySelector('#drawer')?.hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('#drawer-title')?.textContent).toBe(
      'Gained since the 5 Oct 2026 check'
    )
    expect(document.querySelectorAll('#drawer tbody tr')).toHaveLength(model.whatChanged.gained.n)
  })

  test('What changed: chips filter the table by change, All shows every row again', () => {
    const document = open(model)
    type Row = NonNullable<ReturnType<typeof document.querySelector>>
    const rows = (): Row[] => [
      ...document.querySelectorAll('[data-table-wrap="what-changed"] tbody tr')
    ]
    expect(rows()).toHaveLength(model.whatChanged.rows.length)
    const chip = (value: string): HTMLButtonElement =>
      document.querySelector(`.seg[data-seg-value="${value}"]`) as unknown as HTMLButtonElement
    expect(chip('').getAttribute('aria-pressed')).toBe('true')
    for (const value of ['gained', 'lost', 'kept', 'never', 'none'] as const) {
      chip(value).click()
      const expected = value === 'none' ? model.whatChanged.noEarlier.n : model.whatChanged[value].n
      expect(chip(value).querySelector('.seg-n')?.textContent).toBe(String(expected))
      expect(chip(value).getAttribute('aria-pressed')).toBe('true')
      expect(chip('').getAttribute('aria-pressed')).toBe('false')
      const visible = rows().filter((row) => !row.hasAttribute('hidden'))
      expect(visible, value).toHaveLength(expected)
      expect(visible.every((row) => row.getAttribute('data-seg') === value)).toBe(true)
    }
    chip('').click()
    expect(rows().filter((row) => row.hasAttribute('hidden'))).toHaveLength(0)
    // The pills and the CSV agree with the model.
    const lost = model.whatChanged.rows.find((row) => row.change === 'lost')
    expect(html).toContain('<span class="chg chg-lost">Lost</span>')
    expect(lost?.positionBefore).toBe(1)
  })

  test('What changed: a designed empty state without an earlier full check', () => {
    const empty = render({
      ...model,
      whatChanged: {
        ...model.whatChanged,
        empty: { title: 'Nothing to compare yet', message: 'No earlier check.', nextStep: null }
      }
    })
    const section = empty.slice(empty.indexOf('id="sec-what-changed"'))
    expect(section).toContain('Nothing to compare yet')
    expect(section.slice(0, section.indexOf('</section>'))).not.toContain('data-seg-table')
  })

  test('Competition: the kind table, a Kind column and faint bars for the previous check', () => {
    expect(html).toContain('id="cp-kinds"')
    expect(html).toContain('data-table-wrap="site-kinds"')
    for (const row of model.competition.byKind) expect(html).toContain(`>${escaped(row.label)}<`)
    expect(html).toContain(
      '<th scope="col" class="nowrap"><button type="button" class="sort" data-col="2">Kind of site'
    )
    expect(html).toContain('<rect class="before"')
    expect(html).toContain('Previous full check (thin bar)')
    expect(html).toContain('was 3')
  })

  test('How this report was made: scope, source, searched, markets, dates and the fixed copy; no agreement without data', () => {
    const section = html.slice(html.indexOf('id="sec-method"'))
    expect(section).toContain(`<dt>Scope</dt><dd>${model.cover.scopeLabel}</dd>`)
    expect(section).toContain('Google AI Overviews only.')
    expect(section).not.toContain('data-testid="method-sample"')
    expect(section).toContain('Prompts searched')
    expect(section).toContain('US · EN')
    expect(section).toContain('different AI Overview')
    expect(section).not.toContain('Both checks agree')
    const agreeing = render({
      ...model,
      drills: { ...model.drills, 'agree:both': ['r1', 'r2'], 'agree:same': ['r1'] },
      method: {
        ...model.method,
        agreement: {
          total: { n: 2, drill: 'agree:both' },
          agree: { n: 1, drill: 'agree:same' },
          percent: 50
        }
      }
    })
    expect(agreeing).toMatch(
      /Both checks agree on <button[^>]+data-drill="agree:same"[^>]*>1<\/button> of <button[^>]+data-drill="agree:both"[^>]*>2<\/button> prompts \(50%\)/
    )
  })

  test('the headline sits on the cover; What to do next: Do this, Why with a drill, evidence with links', () => {
    const document = open(model)
    expect(document.querySelector('[data-testid="report-headline"]')?.textContent).toBe(
      model.headline
    )
    const recs = document.querySelectorAll('[data-testid="recommendations"] > li')
    expect(recs).toHaveLength(model.recommendations.length)
    expect(recs.length).toBeGreaterThan(0)
    expect(recs.length).toBeLessThanOrEqual(3)
    model.recommendations.forEach((item, index) => {
      const rec = recs[index]
      expect(rec?.querySelector('.rec-do')?.textContent).toBe(item.doThis)
      expect(rec?.querySelector('.rec-why')?.textContent).toBe(item.why)
      const button = rec?.querySelector('.rec-why button.drill')
      expect(button?.textContent).toBe(String(item.questions.n))
      expect(button?.getAttribute('data-drill')).toBe(item.questions.drill)
      expect(model.drills[item.questions.drill ?? '']).toHaveLength(item.questions.n)
      expect(rec?.querySelectorAll('tbody tr')).toHaveLength(item.evidence.length)
      const cited = item.evidence.find((row) => row.citedUrl !== null)
      if (cited !== undefined) {
        const anchor = rec?.querySelector(`a[href="${cited.citedUrl}"]`)
        expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer')
      }
    })
    expect(html).toContain('Competitor cited instead')
    expect(html).toContain('Page Google cited instead')
  })

  test('no evidence: no What to do next; a small sample says so under How this report was made', () => {
    const quiet = render({ ...model, recommendations: [] })
    expect(sectionOrder(quiet)).not.toContain('sec-next')
    const small = render({
      ...model,
      method: { ...model.method, sampleWarning: 'Small sample: only 4 questions were measured.' }
    })
    expect(small).toMatch(
      /data-testid="method-sample">Small sample: only 4 questions were measured\.<\/p>/
    )
  })

  test('preview text names the verdict badge and its findings', () => {
    const text = htmlReportPreviewText(model)
    expect(text).toContain(`Verdict: ${model.verdict.label}`)
    expect(text).toContain('- More answers cite you.')
    expect(text).toContain('- What changed')
    expect(text).toContain(`What to do next:\n1. ${model.recommendations[0]?.doThis ?? ''}`)
    expect(text.trimEnd()).toMatch(/- How this report was made\n\nInteractive HTML/)
  })
})

function escaped(value: string): string {
  return value.replace(/&/g, '&amp;')
}
