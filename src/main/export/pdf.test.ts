import type { PdfExportOptions } from '@shared/domain'
import type { ExportRequest } from '@shared/ipc'
import { REPORT_SECTION_COPY } from '@shared/report-copy'
import { describe, expect, test } from 'vitest'
import { sampleReportRequest } from './model/sample.test-helper'
import type { ReportModel } from './model/types'
import {
  chartOffsets,
  parsePdfLogo,
  rejectPdfRequest,
  renderReportPdf,
  reportPdfPreviewText,
  showingLine,
  type PdfLogo
} from './pdf'
import { extractPdfText, pdfMediaBox, pdfPageCount } from './pdf-inspect.test-helper'
import {
  pageModel,
  projectModel,
  squash,
  withFirstPrompt,
  withRowCount
} from './report-models.test-helper'

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const JPEG =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#c2410c"/></svg>'
).toString('base64')

function options(overrides: Partial<PdfExportOptions> = {}): PdfExportOptions {
  return { pageSize: 'letter', charts: true, preparedFor: null, hideBranding: false, ...overrides }
}

async function render(
  model: ReportModel,
  pdf: Partial<PdfExportOptions> = {},
  extra: { logo?: PdfLogo | null; secrets?: readonly string[] } = {}
): Promise<{ bytes: Buffer; text: string }> {
  const bytes = await renderReportPdf(model, {
    pdf: options(pdf),
    logo: extra.logo ?? null,
    secrets: extra.secrets ?? []
  })
  return { bytes, text: squash(extractPdfText(bytes)) }
}

function logo(base64: string): PdfLogo {
  const parsed = parsePdfLogo(base64)
  if (!parsed.ok || parsed.logo === null) throw new Error('logo did not parse')
  return parsed.logo
}

function pdfRequest(overrides: Partial<ExportRequest>): ExportRequest {
  return sampleReportRequest({ format: 'pdf', html: null, pdf: options(), ...overrides })
}

describe('PDF report from the report model', () => {
  test('writes every included section title in report order, with the headline', async () => {
    const model = pageModel()
    const { bytes, text } = await render(model)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    let from = 0
    for (const section of model.sections) {
      const copy = REPORT_SECTION_COPY[section]
      const at = text.indexOf(squash(`${copy.title}${copy.description}`), from)
      expect(at, section).toBeGreaterThan(-1)
      from = at
    }
    expect(text).toContain(squash(model.overview.headline))
    expect(text).toContain(squash(model.headline))
    expect(text.indexOf(squash('What to do next'))).toBeLessThan(
      text.indexOf(squash(REPORT_SECTION_COPY.overview.description))
    )
    expect(text).toContain(squash(model.recommendations[0]?.doThis ?? 'missing'))
    expect(text.lastIndexOf(squash('How this report was made'))).toBeGreaterThan(
      text.indexOf(squash(REPORT_SECTION_COPY.prompts.description))
    )
    expect(text).toContain(squash(model.cover.scopeLabel))
    expect(text).toContain(squash('Where visibility falls away'))
    expect(text).toContain(squash('Citation leaderboard'))
    expect(text).toContain(squash(model.overview.coverageLine))
    expect(text).not.toMatch(/AIMode/i)
    expect(text).not.toContain(squash('could not be drawn'))
    expect(pdfPageCount(bytes)).toBeGreaterThan(model.sections.length)
  })

  test('draws only the chosen sections, and the cover always', async () => {
    const model = { ...pageModel(), sections: ['competition', 'prompts'] as const }
    const { text } = await render(model)
    expect(text).toContain(squash(model.cover.title))
    expect(text).toContain(squash(REPORT_SECTION_COPY.competition.description))
    expect(text).toContain(squash(REPORT_SECTION_COPY.prompts.description))
    expect(text).not.toContain(squash(REPORT_SECTION_COPY.overview.description))
    expect(text).not.toContain(squash(model.overview.headline))
  })

  test('cuts long tables to the top rows with a pointer to the Excel export', async () => {
    const model = withRowCount(pageModel(), 140)
    const { text } = await render(model)
    expect(text).toContain(squash(showingLine(50, 140)))
    expect(squash(showingLine(25, 140))).toBe(
      squash('Showing 25 of 140 — the full table is in the Excel export.')
    )

    const small = await renderReportPdf(pageModel(), {
      pdf: options(),
      logo: null,
      secrets: [],
      tableLimit: 3
    })
    expect(squash(extractPdfText(small))).toContain(squash('Showing 3 of 8 — the full table'))
  })

  test('an empty section shows its designed empty state', async () => {
    const page = pageModel()
    expect(page.reputation.empty).not.toBeNull()
    const { text } = await render(page)
    expect(text).toContain(squash(page.reputation.empty?.title ?? ''))
    expect(text).toContain(squash(page.reputation.empty?.message ?? ''))
    expect(text).toContain(squash(`Next step: ${page.reputation.empty?.nextStep ?? ''}`))

    const project = projectModel()
    expect(project.contentGaps.empty).not.toBeNull()
    const projectText = (await render(project)).text
    expect(projectText).toContain(squash(project.contentGaps.empty?.title ?? ''))
    expect(projectText).toContain(squash('The opportunity by page'))
  })

  test('changes since the previous check list each category, or say there were none', async () => {
    const model = pageModel()
    const emptied = {
      ...model,
      trends: { ...model.trends, lost: { count: { n: 0, drill: null }, items: [] } }
    }
    const { text } = await render(emptied)
    expect(text).toContain(squash('Lost citations (0)No changes in this category.'))
    expect(text).toContain(squash('Gained citations (2)'))
    expect(text).toContain(squash(model.trends.verdicts[0]?.label ?? 'missing'))
  })

  test('Letter and A4 set the page size, and charts can be left out', async () => {
    const model = pageModel()
    const letter = await render(model, { pageSize: 'letter', charts: false })
    const a4 = await render(model, { pageSize: 'a4', charts: true })
    expect(pdfMediaBox(letter.bytes).width).toBe(612)
    expect(pdfMediaBox(letter.bytes).height).toBe(792)
    expect(pdfMediaBox(a4.bytes).width).toBeCloseTo(595.28, 1)
    expect(pdfMediaBox(a4.bytes).height).toBeCloseTo(841.89, 1)
    expect(a4.text).toContain(squash('Hollow point: partial check'))
    expect(letter.text).not.toContain(squash('Hollow point: partial check'))
    expect(letter.text).toContain(squash('Why prompts drop out before this step'))
  })

  test('markets show as text codes, never as missing flag glyphs', async () => {
    const { text } = await render(pageModel())
    expect(text).toContain(squash('US · EN, CA · EN'))
    expect(text).not.toContain('??US')
  })

  test('branding, Prepared for, and hidden branding', async () => {
    const shown = await render(pageModel())
    expect(shown.text).toContain(squash('Built with CiteFox'))
    expect(shown.text).toContain(squash('Prepared for Northwind Ops'))

    const hidden = await render(pageModel(), { hideBranding: true, preparedFor: 'Acme Corp' })
    expect(hidden.text).not.toContain('CiteFox')
    expect(hidden.bytes.toString('latin1')).not.toContain('CiteFox')
    expect(hidden.text).toContain(squash('Prepared for Acme Corp'))
    expect(hidden.text).toContain(squash('1 / '))
  })

  test('redacts secrets in the text and the preview', async () => {
    const model = withFirstPrompt(pageModel(), 'key super-secret-value end')
    const { bytes, text } = await render(model, {}, { secrets: ['super-secret-value'] })
    expect(text).toContain('[REDACTED]')
    expect(text).not.toContain('super-secret-value')
    expect(bytes.toString('latin1')).not.toContain('super-secret-value')
  })

  test('embeds a PNG or JPEG logo and draws an SVG without reading linked files', async () => {
    const model = pageModel()
    const png = await render(model, {}, { logo: logo(PNG) })
    expect(png.bytes.toString('latin1')).toContain('/Image')
    const jpeg = await render(model, {}, { logo: logo(JPEG) })
    expect(jpeg.bytes.toString('latin1')).toContain('/Image')
    const svg = await render(model, {}, { logo: logo(SVG) })
    expect(svg.text).toContain(squash(model.overview.headline))

    const linked = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><image href="/etc/passwd" width="16" height="16"/><rect width="16" height="16" fill="#c2410c"/></svg>'
    ).toString('base64')
    const external = await render(model, {}, { logo: logo(linked) })
    expect(external.bytes.toString('latin1')).not.toContain('/etc/passwd')
  })

  test('two renders of the same model draw the same text', async () => {
    const first = await render(pageModel())
    const second = await render(pageModel())
    expect(first.text).toBe(second.text)
  })

  test('preview text names the report and its first section without a file', () => {
    const model = withFirstPrompt(pageModel(), 'key super-secret-value end')
    const preview = reportPdfPreviewText(model, options())
    expect(preview).toContain(model.cover.scopeLabel)
    expect(preview).toContain(model.headline)
    expect(preview).toContain('WHAT TO DO NEXT')
    expect(preview.length).toBeLessThanOrEqual(2000)
  })

  test('chart positions follow the time between checks', () => {
    expect(chartOffsets([0, 14, 28], 280)).toEqual([0, 140, 280])
    expect(chartOffsets([0, 7, 28], 280)).toEqual([0, 70, 280])
    expect(chartOffsets([5], 100)).toEqual([50])
    expect(chartOffsets([3, 3], 100)).toEqual([25, 75])
  })
})

describe('PDF options and logo checks', () => {
  test('parsePdfLogo accepts PNG, JPEG, SVG and data URLs, and treats blank as no logo', () => {
    expect(parsePdfLogo(null)).toEqual({ ok: true, logo: null })
    expect(parsePdfLogo('   ')).toEqual({ ok: true, logo: null })
    expect(parsePdfLogo(PNG)).toMatchObject({ ok: true, logo: { kind: 'png' } })
    expect(parsePdfLogo(`data:image/png;base64,${PNG}`)).toMatchObject({
      ok: true,
      logo: { kind: 'png' }
    })
    expect(parsePdfLogo(JPEG)).toMatchObject({ ok: true, logo: { kind: 'jpeg' } })
    expect(parsePdfLogo(SVG)).toMatchObject({ ok: true, logo: { kind: 'svg' } })
    expect(parsePdfLogo('LOGO-SECRET-BYTES')).toMatchObject({
      ok: false,
      reason: 'That logo could not be read.'
    })
  })

  test('rejects a logo over 8 MB, missing options, and a bad page size', () => {
    const huge = Buffer.alloc(8_000_001).toString('base64')
    expect(rejectPdfRequest(pdfRequest({ logoBase64: huge }))).toMatchObject({
      reason: 'That logo is too large.'
    })
    expect(rejectPdfRequest(pdfRequest({ pdf: null }))).toMatchObject({
      reason: 'PDF options are missing.'
    })
    const bad = { ...options(), pageSize: 'legal' } as unknown as PdfExportOptions
    expect(rejectPdfRequest(pdfRequest({ pdf: bad }))).toMatchObject({
      reason: 'Choose Letter or A4.'
    })
    expect(rejectPdfRequest(pdfRequest({}))).toBeNull()
    expect(rejectPdfRequest(pdfRequest({ format: 'xlsx', pdf: null }))).toBeNull()
  })
})
