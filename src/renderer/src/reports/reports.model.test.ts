import { describe, expect, it } from 'vitest'
import { REPORT_SECTIONS } from '@shared/domain'
import { SAMPLE_AUTO_EXPORT_FOLDER, createExportEngine } from './engine'
import { fileExtension, previewGridRows } from './export/formats'
import {
  allSections,
  buildExportRequest,
  defaultExportForm,
  formatBytes,
  localDate,
  localTimeZone,
  sectionUnavailable,
  sizeLabel,
  specOf,
  type ExportBuildSource
} from './export/model'
import { previewForRequest } from './exportSample'

/** Every report section a page (not a topic) can carry. */
const PAGE_SECTIONS = REPORT_SECTIONS.filter((id) => id !== 'topic_coverage')

const EXPORT_SOURCE: ExportBuildSource = {
  projectId: 'textbolt',
  pageId: 'alerts',
  marketIds: ['us', 'austin']
}

describe('export request', () => {
  it('sends v2 section ids in report order and the local time zone', () => {
    const request = buildExportRequest(defaultExportForm(), EXPORT_SOURCE)
    expect(request.sections).toEqual(PAGE_SECTIONS)
    expect(request.sections).not.toContain('raw')
    expect(request.scope).toBe('page')
    expect(request.pageIds).toEqual(['alerts'])
    expect(request.viewId).toBeNull()
    expect(request.marketIds).toEqual(['us', 'austin'])
    expect(request.checks).toBe('latest')
    expect(request.from).toBeNull()
    expect(request.to).toBeNull()
    expect(request.timeZone).toBe(localTimeZone())
    expect(request).not.toHaveProperty('directory')
    expect(request).not.toHaveProperty('folder')
    for (const legacy of [
      'results',
      'prompt_results',
      'progress',
      'markets',
      'sentiment',
      'gaps'
    ]) {
      expect(request.sections).not.toContain(legacy)
    }
  })

  it('maps scope and data window, and drops content gaps in project scope', () => {
    const project = buildExportRequest(
      {
        ...defaultExportForm(),
        scope: 'project',
        checks: 'range',
        from: '2026-09-01',
        to: '2026-10-19'
      },
      EXPORT_SOURCE
    )
    expect(project.scope).toBe('project')
    expect(project.pageIds).toEqual([])
    expect(project.sections).not.toContain('content_gaps')
    expect(project.sections).toContain('prompts')
    expect(project.from).toBe('2026-09-01')
    expect(project.to).toBe('2026-10-19')
    expect(sectionUnavailable('content_gaps', 'project')).toContain('Choose This page')
    expect(sectionUnavailable('content_gaps', 'page')).toBeNull()
    expect(sectionUnavailable('overview', 'project')).toBeNull()
    expect(sectionUnavailable('topic_coverage', 'page')).toContain('Pick a topic')
    expect(sectionUnavailable('topic_coverage', 'page', true)).toBeNull()
    const topic = buildExportRequest(defaultExportForm(), { ...EXPORT_SOURCE, hasTopic: true })
    expect(topic.sections).toEqual([...REPORT_SECTIONS])

    const every = buildExportRequest({ ...defaultExportForm(), checks: 'all' }, EXPORT_SOURCE)
    expect(every.checks).toBe('all')
    expect(every.from).toBeNull()

    const none = buildExportRequest(
      { ...defaultExportForm(), sections: allSections(false) },
      EXPORT_SOURCE
    )
    expect(none.sections).toEqual([])
  })

  it('keeps only the matching format options', () => {
    const html = buildExportRequest(defaultExportForm(), EXPORT_SOURCE)
    expect(html.format).toBe('html')
    expect(html.html).toEqual({ packaging: 'zip' })
    expect(html.pdf).toBeNull()
    expect(html.xlsx).toBeNull()
    expect(html.csv).toBeNull()
    const single = buildExportRequest(
      { ...defaultExportForm(), htmlPackaging: 'file' },
      EXPORT_SOURCE
    )
    expect(single.html).toEqual({ packaging: 'file' })

    const pdf = buildExportRequest(
      { ...defaultExportForm(), format: 'pdf', logoBase64: 'logo-bytes', preparedFor: ' Acme ' },
      EXPORT_SOURCE
    )
    expect(pdf.pdf).toEqual({
      pageSize: 'letter',
      charts: true,
      preparedFor: 'Acme',
      hideBranding: false
    })
    expect(pdf.html).toBeNull()
    expect(pdf.logoBase64).toBe('logo-bytes')

    const xlsx = buildExportRequest({ ...defaultExportForm(), format: 'xlsx' }, EXPORT_SOURCE)
    expect(xlsx.pdf).toBeNull()
    expect(xlsx.csv).toBeNull()
    expect(xlsx.xlsx).toEqual({ freezeHeaders: true, sheetPerMarket: false })
    expect(xlsx.logoBase64).toBeNull()

    const csv = buildExportRequest({ ...defaultExportForm(), format: 'csv' }, EXPORT_SOURCE)
    expect(csv.csv).toEqual({ delimiter: 'comma', bom: true })
    expect(csv.pdf).toBeNull()
    expect(csv.xlsx).toBeNull()
  })

  it('sends raw SerpApi data only with JSON', () => {
    const json = buildExportRequest(
      { ...defaultExportForm(), format: 'json', includeRaw: true },
      EXPORT_SOURCE
    )
    expect(json.sections.at(-1)).toBe('raw')
    for (const format of ['html', 'pdf', 'xlsx', 'csv'] as const) {
      const other = buildExportRequest(
        { ...defaultExportForm(), format, includeRaw: true },
        EXPORT_SOURCE
      )
      expect(other.sections).not.toContain('raw')
    }
  })

  it('blocks raw data on any format other than json', () => {
    const direct = previewForRequest({
      ...buildExportRequest({ ...defaultExportForm(), format: 'pdf' }, EXPORT_SOURCE),
      sections: ['raw']
    })
    expect(direct.blocked).toBe(true)
    expect(direct.reason).toBe('Raw search data is only included in JSON exports.')
    expect(direct.nextStep).toBe('Choose JSON, or turn off Raw search data.')
  })

  it('stores the spec without the logo and with the HTML packaging', () => {
    const request = buildExportRequest(
      { ...defaultExportForm(), logoBase64: 'logo-bytes' },
      EXPORT_SOURCE
    )
    const spec = specOf(request)
    expect(spec).not.toHaveProperty('logoBase64')
    expect(spec.html).toEqual({ packaging: 'zip' })
  })

  it('reads CSV and Excel preview text as a header plus data rows', () => {
    const preview = 'page_url,market\n"https://textbolt.com/a,b",US\n'
    expect(previewGridRows(preview, 'csv')).toEqual([
      ['page_url', 'market'],
      ['https://textbolt.com/a,b', 'US']
    ])
    expect(previewGridRows(preview, 'xlsx')).toEqual([
      ['page_url', 'market'],
      ['https://textbolt.com/a,b', 'US']
    ])
    expect(previewGridRows('Showing 1 of 1 checks.', 'pdf')).toEqual([])
    expect(previewGridRows('', 'csv')).toEqual([])
  })

  it('names extensions, sizes, and local dates', () => {
    expect(fileExtension('html')).toBe('zip')
    expect(fileExtension('html', 'file')).toBe('html')
    expect(fileExtension('csv')).toBe('zip')
    expect(fileExtension('xlsx')).toBe('xlsx')
    expect(sizeLabel(1)).toBe('1 byte')
    expect(sizeLabel(128)).toBe('128 bytes')
    expect(sizeLabel(40 * 1024)).toBe('About 40 KB')
    expect(sizeLabel(2.5 * 1024 * 1024)).toBe('About 2.5 MB')
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(defaultExportForm(new Date(2026, 9, 19)).to).toBe('2026-10-19')
    expect(defaultExportForm(new Date(2026, 9, 19)).from).toBe('2026-09-19')
  })
})

describe('export engine', () => {
  it('writes html and json with progress', async () => {
    const engine = createExportEngine({ paceMs: 0 })
    const phases: string[] = []
    engine.onProgress((progress) => phases.push(progress.phase))
    for (const [format, htmlPackaging, ext] of [
      ['html', 'zip', 'zip'],
      ['html', 'file', 'html'],
      ['json', 'zip', 'json']
    ] as const) {
      const result = await engine.start(
        buildExportRequest({ ...defaultExportForm(), format, htmlPackaging }, EXPORT_SOURCE)
      )
      expect(result).toMatchObject({ ok: true, format })
      if (result.ok) expect(result.filename).toBe(`TextBolt-text-alerts-2026-10-19.${ext}`)
    }
    expect(phases).toEqual([
      ...['collect', 'render', 'write'],
      ...['collect', 'render', 'write'],
      ...['collect', 'render', 'write']
    ])
  })

  it('writes csv and xlsx and pushes collect, render, and write only then', async () => {
    const engine = createExportEngine({ paceMs: 0 })
    const phases: string[] = []
    engine.onProgress((progress) => {
      expect(progress.nextStep).toBeNull()
      expect(progress.detail.length).toBeGreaterThan(0)
      phases.push(
        `${progress.phase}:${progress.state}:${progress.done}/${progress.total}:${progress.detail}`
      )
    })
    const csv = await engine.start(
      buildExportRequest({ ...defaultExportForm(), format: 'csv' }, EXPORT_SOURCE)
    )
    expect(csv.ok).toBe(true)
    if (csv.ok) {
      expect(csv.format).toBe('csv')
      expect(csv.filename).toBe('TextBolt-text-alerts-2026-10-19.zip')
      expect(csv.filePath).toContain(csv.filename)
      expect(csv.bytes).toBeGreaterThan(0)
    }
    const xlsx = await engine.start(
      buildExportRequest({ ...defaultExportForm(), format: 'xlsx' }, EXPORT_SOURCE)
    )
    expect(xlsx.ok).toBe(true)
    expect(phases).toEqual([
      'collect:running:1/3:Collecting the checks',
      'render:running:2/3:Building the report',
      'write:running:3/3:Saving the file',
      'collect:running:1/3:Collecting the checks',
      'render:running:2/3:Building the report',
      'write:running:3/3:Saving the file'
    ])
  })

  it('blocks csv and xlsx when raw data is selected and pushes no progress', async () => {
    const engine = createExportEngine({ paceMs: 0 })
    const phases: string[] = []
    engine.onProgress((progress) => phases.push(progress.phase))
    for (const format of ['csv', 'xlsx'] as const) {
      const request = {
        ...buildExportRequest({ ...defaultExportForm(), format, checks: 'all' }, EXPORT_SOURCE),
        sections: [...REPORT_SECTIONS, 'raw' as const]
      }
      const preview = await engine.preview(request)
      expect(preview.blocked).toBe(true)
      expect(preview.reason).toBe('Raw search data is only included in JSON exports.')
      expect(preview.nextStep).toBe('Choose JSON, or turn off Raw search data.')
      expect(preview.pageCount).toBe(1)
      expect(preview.marketCount).toBe(2)
      expect(preview.checkCount).toBe(3)
      const result = await engine.start(request)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe(preview.reason)
    }
    expect(phases).toEqual([])
  })

  it('returns Export cancelled when the save dialog is dismissed', async () => {
    const engine = createExportEngine({ cancelled: true })
    const phases: string[] = []
    engine.onProgress((progress) => phases.push(progress.detail))
    const result = await engine.start(
      buildExportRequest({ ...defaultExportForm(), format: 'xlsx' }, EXPORT_SOURCE)
    )
    expect(result).toEqual({ ok: false, reason: 'Export cancelled', nextStep: null })
    expect(phases).toEqual([])
  })

  it('does not push progress when nothing is picked', async () => {
    const engine = createExportEngine()
    const phases: string[] = []
    engine.onProgress((progress) => phases.push(progress.phase))
    const request = buildExportRequest(
      { ...defaultExportForm(), format: 'xlsx' },
      { ...EXPORT_SOURCE, marketIds: [] }
    )
    const result = await engine.start(request)
    expect(result).toMatchObject({ ok: false, reason: 'Pick at least one market.' })
    expect(phases).toEqual([])
  })

  it('stores the spec and never the logo', async () => {
    const engine = createExportEngine()
    const request = buildExportRequest(
      {
        ...defaultExportForm(),
        format: 'pdf',
        logoBase64: 'logo-bytes'
      },
      EXPORT_SOURCE
    )
    const auto = {
      projectId: request.projectId,
      pageId: 'alerts',
      enabled: true,
      destination: 'folder' as const,
      folder: null,
      emailTo: null,
      spec: specOf(request)
    }
    // Like main, turning it on needs a folder from the dialog first.
    expect(await engine.setAuto(auto)).toMatchObject({ code: 'no_folder' })
    await engine.chooseAutoFolder({ projectId: request.projectId, pageId: 'alerts' })
    const stored = await engine.setAuto(auto)
    expect(JSON.stringify(stored)).not.toContain('logo-bytes')
    const again = await engine.getAuto({ projectId: request.projectId, pageId: 'alerts' })
    expect(again.spec?.format).toBe('pdf')
    expect(again.folder).toBe(SAMPLE_AUTO_EXPORT_FOLDER)
    expect(await engine.getAuto({ projectId: 'missing', pageId: null })).toMatchObject({
      enabled: false,
      folder: null,
      spec: null,
      runs: []
    })
  })
})

describe('formatBytes', () => {
  it('uses plain size units', () => {
    expect(formatBytes(128)).toBe('128 bytes')
    expect(formatBytes(16_892)).toBe('17 KB')
    expect(formatBytes(1_234_567)).toBe('1.2 MB')
  })
})
