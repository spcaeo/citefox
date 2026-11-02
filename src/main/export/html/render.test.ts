import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import type { ReportSectionId } from '@shared/domain'
import { REPORT_SECTION_COPY } from '@shared/report-copy'
import { drillCounts } from '../model/consistency'
import { sampleReportModel } from '../model/sample.test-helper'
import type { ReportModel } from '../model/types'
import { readStoredZip } from '../zip'
import {
  CLIENT_SCRIPT,
  CLIENT_SCRIPT_HASH,
  folderName,
  htmlReportPreviewText,
  packageHtmlReport,
  renderHtmlReport
} from '.'
import { esc, jsonForScript, link, safeUrl } from './escape'
import { fullReportModel } from './report-model.test-helper'

const MALICIOUS =
  '</script><img src=x onerror=alert(1)> & "quoted" \u2028 \u2029 javascript:alert(2)'
const SECRET = 'sk-ant-secretvalue-0123456789'

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] }

function mutable(model: ReportModel): Mutable<ReportModel> {
  return structuredClone(model) as Mutable<ReportModel>
}

function render(model: ReportModel = fullReportModel(), secrets: readonly string[] = []): string {
  return renderHtmlReport(model, { secrets })
}

function scripts(html: string): { attrs: string; body: string }[] {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((match) => ({
    attrs: match[1] ?? '',
    body: match[2] ?? ''
  }))
}

function reportData(html: string): { raw: string; value: Record<string, unknown> } {
  const data = scripts(html).find((script) => script.attrs.includes('id="report-data"'))
  if (data === undefined) throw new Error('report-data is missing')
  return { raw: data.body, value: JSON.parse(data.body) as Record<string, unknown> }
}

function unescape(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function drillButtons(html: string): { token: string; n: number; text: string }[] {
  return [
    ...html.matchAll(
      /<button type="button" class="drill[^"]*" data-drill="([^"]*)" data-n="(\d+)"[^>]*>([^<]*)<\/button>/g
    )
  ].map((match) => ({ token: unescape(match[1] ?? ''), n: Number(match[2]), text: match[3] ?? '' }))
}

describe('HTML report document', () => {
  test('a strict CSP whose hash is the inline app script, and exactly one executable script', () => {
    const html = render()
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true)
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1]
    expect(csp).toBe(
      `default-src 'none'; script-src 'sha256-${CLIENT_SCRIPT_HASH}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`
    )
    const executable = scripts(html).filter(
      (script) => !script.attrs.includes('type="application/json"')
    )
    expect(executable).toHaveLength(1)
    const body = executable[0]?.body ?? ''
    expect(body).toBe(CLIENT_SCRIPT)
    expect(createHash('sha256').update(body, 'utf8').digest('base64')).toBe(CLIENT_SCRIPT_HASH)
    expect(
      scripts(html).filter((script) => script.attrs.includes('id="report-data"'))
    ).toHaveLength(1)
  })

  test('the app script is plain, ASCII, and makes no network request or eval', () => {
    expect(CLIENT_SCRIPT).not.toMatch(/<\/script/i)
    expect(CLIENT_SCRIPT).not.toMatch(/<!--/)
    expect([...CLIENT_SCRIPT].every((char) => char === '\n' || (char >= ' ' && char <= '~'))).toBe(
      true
    )
    for (const banned of [
      'eval(',
      'new Function',
      'fetch(',
      'XMLHttpRequest',
      'import(',
      'WebSocket',
      'sendBeacon',
      'innerHTML = location'
    ]) {
      expect(CLIENT_SCRIPT).not.toContain(banned)
    }
  })

  test('embedded data parses and can never close its script element', () => {
    const model = mutable(fullReportModel())
    const row = model.rows[0]
    if (row === undefined) throw new Error('sample has no rows')
    row.text = MALICIOUS
    row.aioExcerpt = MALICIOUS
    const html = render(model as ReportModel)
    const data = reportData(html)
    expect(data.raw).not.toMatch(/[<>&\u2028\u2029]/)
    const rows = data.value.rows as { id: string; text: string }[]
    expect(rows.find((item) => item.id === row.id)?.text).toBe(MALICIOUS)
    expect(Object.keys(data.value.tables as object).length).toBeGreaterThan(10)
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('onerror=alert(1)>')
    expect(html).toContain('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;')
  })

  test('nothing loads from the network: only report links point at http(s), and they open safely', () => {
    const html = render()
    expect(html).not.toMatch(/\ssrc\s*=/i)
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''
    expect(css.length).toBeGreaterThan(1000)
    expect(css).not.toMatch(/@import|url\(/i)
    expect(html).not.toMatch(/<(img|iframe|object|embed|video|audio|source|base|form)\b/i)
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    const links = [...html.matchAll(/<link\b[^>]*>/g)].map((match) => match[0])
    expect(links).toHaveLength(1)
    expect(links[0]).toMatch(/^<link rel="icon" href="data:image\/svg\+xml,/)
    for (const match of html.matchAll(/\shref="([^"]*)"/g)) {
      const href = match[1] ?? ''
      expect(
        href.startsWith('#') || href.startsWith('data:image/svg+xml,') || /^https?:\/\//.test(href)
      ).toBe(true)
    }
    const anchors = [...html.matchAll(/<a\b[^>]*href="https?:[^>]*>/g)].map((match) => match[0])
    expect(anchors.length).toBeGreaterThan(5)
    for (const anchor of anchors) {
      expect(anchor).toContain('target="_blank"')
      expect(anchor).toContain('rel="noopener noreferrer"')
    }
  })

  test('only http and https URLs become links', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('data:text/html,hi')).toBeNull()
    expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(link('javascript:alert(1)')).toBe('javascript:alert(1)')
    expect(esc('<a href="x">\'&')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
    expect(jsonForScript({ a: '</script>&\u2028\u2029' })).toBe(
      '{"a":"\\u003c/script\\u003e\\u0026\\u2028\\u2029"}'
    )
  })
})

describe('HTML report numbers (NFR-14)', () => {
  test.each([
    ['page scope', () => fullReportModel()],
    ['project scope', () => fullReportModel({ scope: 'project', pageIds: [] })],
    ['one market', () => fullReportModel({ marketIds: ['mkt-us'] })]
  ])('%s: every drill button shows n, and its drawer lists exactly n prompts', (_name, build) => {
    const model = build()
    const html = render(model)
    const buttons = drillButtons(html)
    expect(buttons.length).toBeGreaterThan(80)
    for (const button of buttons) {
      expect(button.text).toBe(String(button.n))
      expect(model.drills[button.token]?.length, button.token).toBe(button.n)
    }
    const rendered = new Set(buttons.map((button) => button.token))
    const expected = drillCounts(model).filter((count) => count.n > 0)
    const missing = expected
      .filter((count) => !rendered.has(count.drill))
      .map((count) => count.path)
    expect(missing).toEqual([])
    const data = reportData(html).value
    const rowIds = new Set((data.rows as { id: string }[]).map((row) => row.id))
    for (const token of rendered) {
      for (const id of model.drills[token] ?? []) expect(rowIds.has(id)).toBe(true)
    }
  })

  test('counts without a drill are plain text, not buttons', () => {
    const model = mutable(fullReportModel())
    model.reputation.positive = { n: 4, drill: null }
    const html = render(model as ReportModel)
    expect(html).toContain('<span class="num">4</span>')
    expect(drillButtons(html).some((button) => button.token === 'tone:positive')).toBe(false)
  })
})

describe('HTML report sections', () => {
  test('every section in the model renders with its title, in report order', () => {
    const model = fullReportModel()
    const html = render(model)
    let last = html.indexOf('id="sec-cover"')
    expect(last).toBeGreaterThan(0)
    for (const id of model.sections) {
      const at = html.indexOf(`<section id="sec-${id.replace(/_/g, '-')}"`)
      expect(at, id).toBeGreaterThan(last)
      expect(html).toContain(`>${REPORT_SECTION_COPY[id].title}</h2>`)
      last = at
    }
    expect(html).toContain(model.overview.headline)
    expect(html).toContain('Built with CiteFox')
  })

  test('sections not in the model are absent, the cover always shows', () => {
    const model = { ...fullReportModel(), sections: ['overview', 'prompts'] as ReportSectionId[] }
    const html = render(model)
    expect(html).toContain('id="sec-cover"')
    expect(html).toContain('id="sec-overview"')
    expect(html).toContain('id="sec-prompts"')
    for (const id of [
      'pages',
      'competition',
      'reputation',
      'trends',
      'universe',
      'sources',
      'answer-shape',
      'content-gaps'
    ]) {
      expect(html).not.toContain(`id="sec-${id}"`)
      expect(html).not.toContain(`data-target="sec-${id}"`)
    }
  })

  test('an empty section shows its designed empty state', () => {
    const model = sampleReportModel()
    expect(model.reputation.empty).not.toBeNull()
    const html = render(model)
    const section = /<section id="sec-reputation"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
    expect(section).toContain('Not measured yet')
    expect(section).toContain(esc(model.reputation.empty?.message ?? ''))
    expect(section).toContain(esc(model.reputation.empty?.nextStep ?? ''))
    expect(section).not.toContain('class="kpis"')
  })

  test('content gaps appear in page scope only', () => {
    const page = render(fullReportModel())
    expect(page).toContain('data-table-wrap="coverage-matrix"')
    expect(page).toContain('5 strong, 4 partial, 1 weak')
    const project = render(fullReportModel({ scope: 'project', pageIds: [] }))
    expect(project).not.toContain('data-table-wrap="coverage-matrix"')
    expect(project).toContain('Page scope only')
    expect(project).toContain('By page')
  })

  test('plain-words copy: empty deltas, net sentiment below 5 claims, Google AI Overviews only', () => {
    const model = mutable(fullReportModel())
    model.trends.lost = { count: { n: 0, drill: null }, items: [] }
    model.reputation.net = null
    const html = render(model as ReportModel)
    expect(html).toContain('No changes in this category.')
    expect(html).toContain('Not enough data')
    expect(html).toContain('“Already winning” means')
    expect(html).toContain(esc(model.competition.authorityNote))
    expect(html).toContain(esc(model.sources.note))
    expect(html).toContain(esc(model.overview.coverageLine))
    expect(html).not.toMatch(/AI Mode/i)
    expect(html).not.toMatch(/\block(ed|s)?\b|gating/i)
  })

  test('long tables show the top rows with "Show all", and the CSV data matches the table', () => {
    const html = render(fullReportModel())
    expect(html).toMatch(
      /<span class="showing-text">Showing 15 of 20<\/span> — <button type="button" class="show-all" data-table="prompts"/
    )
    const tables = reportData(html).value.tables as Record<
      string,
      { columns: string[]; rows: unknown[][] }
    >
    expect(tables.prompts?.rows).toHaveLength(20)
    expect(html.match(/<tr class="extra">/g)?.length).toBeGreaterThanOrEqual(5)
    for (const match of html.matchAll(/class="csv-btn" data-table="([^"]+)"/g)) {
      expect(tables[match[1] ?? '']).toBeDefined()
    }
  })

  test('every table header cell has a scope', () => {
    const html = render(fullReportModel())
    for (const match of html.matchAll(/<th\b[^>]*>/g)) expect(match[0]).toMatch(/scope="(col|row)"/)
  })
})

describe('HTML report secrets and packaging', () => {
  test('secrets are removed from every string, drill tokens included, and counts still match', () => {
    const model = mutable(fullReportModel())
    const row = model.rows[0]
    const rival = model.competition.mostCited[1]
    if (row === undefined || rival === undefined) throw new Error('sample is too small')
    row.text = `Prompt with ${SECRET} inside`
    const ids = model.drills[rival.prompts.drill ?? ''] ?? []
    model.drills[`host:${SECRET}.com`] = ids
    rival.prompts.drill = `host:${SECRET}.com`
    rival.domain = `${SECRET}.com`
    model.cover.clientName = `Client ${SECRET}`
    const html = render(model as ReportModel, [SECRET])
    expect(html).not.toContain(SECRET)
    expect(html).toContain('[REDACTED]')
    const redacted = drillButtons(html).find((button) => button.token === 'host:[REDACTED].com')
    expect(redacted?.n).toBe(ids.length)
    const data = reportData(html).value as { drills: Record<string, string[]> }
    expect(data.drills['host:[REDACTED].com']).toHaveLength(ids.length)
  })

  test('zip: a dated folder with index.html and README.txt', () => {
    const model = fullReportModel()
    const html = render(model)
    const folder = 'textbolt.com-how-to-set-up-text-alerts-for-business-ai-visibility-2026-10-20'
    expect(folderName(model)).toBe(folder)
    const pkg = packageHtmlReport(model, html, 'zip')
    expect(pkg.filename).toBe(`${folder}.zip`)
    expect(pkg.contentType).toBe('application/zip')
    const entries = readStoredZip(pkg.bytes)
    expect(entries.map((entry) => entry.name)).toEqual([
      `${folder}/index.html`,
      `${folder}/README.txt`
    ])
    expect(entries[0]?.data.toString('utf8')).toBe(html)
    const readme = entries[1]?.data.toString('utf8') ?? ''
    expect(readme).toContain('double-click index.html')
    expect(readme).toContain('no network requests')
    expect(readme).toContain('opens the prompts behind it')
    expect(readme).toMatch(/Search/)
    expect(readme).toMatch(/Focus/)
    expect(readme).toMatch(/CSV/)
    expect(readme).toMatch(/PDF/)
  })

  test('file: the bare HTML under the same name; the date follows the report time zone', () => {
    const model = fullReportModel({ scope: 'project', pageIds: [] })
    const pkg = packageHtmlReport(model, render(model), 'file')
    expect(pkg.filename).toBe('textbolt.com-all-pages-ai-visibility-2026-10-20.html')
    expect(pkg.contentType).toBe('text/html; charset=utf-8')
    expect(pkg.bytes.toString('utf8').startsWith('<!doctype html>')).toBe(true)
    const tokyo = mutable(model)
    tokyo.cover.builtAt = '2026-10-20T20:00:00.000Z'
    tokyo.cover.timeZone = 'Asia/Tokyo'
    expect(folderName(tokyo as ReportModel)).toBe('textbolt.com-all-pages-ai-visibility-2026-10-21')
  })

  test('preview text: title, headline, KPI line and the section list', () => {
    const model = fullReportModel()
    const text = htmlReportPreviewText(model)
    expect(text).toContain(model.cover.title)
    expect(text).toContain(model.headline)
    // 17 of 20 tracked prompts (SRS 7.2 AIO coverage), one search failed and stated apart.
    expect(text).toContain('AI Overview appears 17 (85% of tracked) · 1 search failed')
    for (const id of model.sections) expect(text).toContain(`- ${REPORT_SECTION_COPY[id].title}`)
  })
})
