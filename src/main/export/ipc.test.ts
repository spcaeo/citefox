import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import * as ExcelJS from 'exceljs'
import { afterEach, describe, expect, test } from 'vitest'
import { appDataPaths } from '../storage/paths'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import {
  configureExportReveal,
  configureExportSaveDialog,
  resetExportSaveDialog,
  resetWrittenExports
} from './ipc'
import {
  RAW_MARKER,
  cleanupExportSeeds,
  exportRequest,
  run,
  seed,
  tempDir
} from './ipc-seed.test-helper'
import { extractPdfText } from './pdf-inspect.test-helper'
import { readStoredZip } from './zip'

afterEach(() => {
  resetExportSaveDialog()
  configureExportReveal(null)
  resetWrittenExports()
  cleanupExportSeeds()
})

describe('exports IPC', () => {
  test('exports:preview counts checks from the project database', async () => {
    const { handlers } = seed([
      run('run-early', '2026-10-05T15:00:00.000Z', '2026-10-05T16:00:00.000Z'),
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    const latest = await handlers['exports:preview'](exportRequest({ checks: 'latest' }))
    expect(latest.blocked).toBe(false)
    expect(latest.pageCount).toBe(1)
    expect(latest.marketCount).toBe(1)
    expect(latest.checkCount).toBe(1)
    expect(latest.preview).toContain('How do I alert the crew?')

    const every = await handlers['exports:preview'](exportRequest({ checks: 'all' }))
    expect(every.blocked).toBe(false)
    expect(every.pageCount).toBe(1)
    expect(every.marketCount).toBe(1)
    expect(every.checkCount).toBe(2)
    // The drill lists behind the counts add up to them (NFR-14).
    const pages = every.pages ?? []
    expect(pages).toHaveLength(every.pageCount)
    expect(new Set(pages.flatMap((page) => page.markets.map((m) => m.marketId))).size).toBe(
      every.marketCount
    )
    const checks = pages.flatMap((page) => page.markets.flatMap((m) => m.checks))
    expect(checks).toEqual(['2026-10-05T16:00:00.000Z', '2026-10-19T16:00:00.000Z'])
  })

  test('exports:start writes CSV and XLSX through the save dialog', async () => {
    const { handlers } = seed([
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    const saveDir = tempDir()
    const seen: string[] = []
    configureExportSaveDialog(async (options) => {
      seen.push(options.defaultPath)
      return { canceled: false, filePath: join(saveDir, options.defaultPath) }
    })

    const csv = await handlers['exports:start'](exportRequest({ filenamePattern: '' }))
    expect(csv).toMatchObject({ ok: true, format: 'csv' })
    if (!csv.ok) return
    expect(seen[0]).toBe('TextBolt-alerts-2026-10-19.zip')
    expect(csv.filePath).toBe(join(saveDir, 'TextBolt-alerts-2026-10-19.zip'))
    const csvText = readStoredZip(readFileSync(csv.filePath))
      .map((entry) => entry.data.toString('utf8'))
      .join('\n')
    expect(csvText).toContain('How do I alert the crew?')
    expect(csvText).toContain('Stored overview quote.')
    expect(csvText).not.toContain(RAW_MARKER)

    // Show in Finder reveals only a file an export wrote, and only while it is there.
    const revealed: string[] = []
    configureExportReveal((filePath) => revealed.push(filePath))
    expect(await handlers['exports:reveal']({ filePath: csv.filePath })).toEqual({ ok: true })
    expect(revealed).toEqual([csv.filePath])
    const other = await handlers['exports:reveal']({ filePath: join(saveDir, 'other.zip') })
    expect(other).toMatchObject({ ok: false, reason: 'CiteFox can only show files it exported.' })
    rmSync(csv.filePath)
    expect(await handlers['exports:reveal']({ filePath: csv.filePath })).toMatchObject({
      ok: false,
      nextStep: 'Export it again.'
    })
    expect(revealed).toHaveLength(1)

    const xlsx = await handlers['exports:start'](
      exportRequest({
        format: 'xlsx',
        csv: null,
        xlsx: { freezeHeaders: true, sheetPerMarket: false }
      })
    )
    expect(xlsx).toMatchObject({ ok: true, format: 'xlsx' })
    if (!xlsx.ok) return
    expect(seen[1]).toBe('TextBolt-alerts-2026-10-19.xlsx')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(xlsx.filePath)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toContain('Prompts')
    expect(readFileSync(xlsx.filePath).includes(Buffer.from(RAW_MARKER))).toBe(false)
  })

  test('exports:start writes a PDF through the save dialog', async () => {
    const { handlers } = seed([
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    const saveDir = tempDir()
    const seen: { defaultPath: string; filters: { name: string; extensions: string[] }[] }[] = []
    configureExportSaveDialog(async (options) => {
      seen.push({ defaultPath: options.defaultPath, filters: options.filters })
      return { canceled: false, filePath: join(saveDir, options.defaultPath) }
    })
    const pdf = await handlers['exports:start'](
      exportRequest({
        format: 'pdf',
        csv: null,
        pdf: { pageSize: 'letter', charts: false, preparedFor: 'Northwind', hideBranding: false }
      })
    )
    expect(pdf).toMatchObject({ ok: true, format: 'pdf' })
    if (!pdf.ok) return
    expect(seen[0]).toEqual({
      defaultPath: 'TextBolt-alerts-2026-10-19.pdf',
      filters: [{ name: 'PDF report', extensions: ['pdf'] }]
    })
    expect(pdf.filePath).toBe(join(saveDir, 'TextBolt-alerts-2026-10-19.pdf'))
    const bytes = readFileSync(pdf.filePath)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    const text = extractPdfText(bytes)
    expect(text).toContain('How do I alert the crew?')
    expect(text).not.toContain(RAW_MARKER)
    expect(bytes.includes(Buffer.from(RAW_MARKER))).toBe(false)

    const raw = await handlers['exports:start'](
      exportRequest({
        format: 'pdf',
        csv: null,
        pdf: { pageSize: 'a4', charts: true, preparedFor: null, hideBranding: true },
        sections: ['overview', 'raw']
      })
    )
    expect(raw).toMatchObject({
      ok: false,
      reason: 'Raw search data is only included in JSON exports.',
      nextStep: 'Remove the raw section, or choose JSON.'
    })
    expect(seen).toHaveLength(1)
    expect(readdirSync(saveDir)).toEqual(['TextBolt-alerts-2026-10-19.pdf'])
  })

  test('exports:start writes HTML and JSON through the save dialog', async () => {
    const { handlers } = seed([
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    const saveDir = tempDir()
    const seen: { defaultPath: string; filters: { name: string; extensions: string[] }[] }[] = []
    configureExportSaveDialog(async (options) => {
      seen.push({ defaultPath: options.defaultPath, filters: options.filters })
      return { canceled: false, filePath: join(saveDir, options.defaultPath) }
    })

    const html = await handlers['exports:start'](exportRequest({ format: 'html', csv: null }))
    expect(html).toMatchObject({ ok: true, format: 'html' })
    if (!html.ok) return
    expect(seen[0]).toEqual({
      defaultPath: 'textbolt.com-alerts-ai-visibility-2026-10-20.zip',
      filters: [{ name: 'HTML report folder (zip)', extensions: ['zip'] }]
    })
    const folder = readStoredZip(readFileSync(html.filePath))
    expect(folder.map((entry) => entry.name)).toEqual([
      'textbolt.com-alerts-ai-visibility-2026-10-20/index.html',
      'textbolt.com-alerts-ai-visibility-2026-10-20/README.txt'
    ])
    const page = folder[0]?.data.toString('utf8') ?? ''
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).toContain('How do I alert the crew?')
    expect(page).toContain('Stored overview quote.')
    expect(page).not.toContain(RAW_MARKER)
    expect(page.match(/<script(?![^>]*type="application\/json")/gi)).toHaveLength(1)

    const bare = await handlers['exports:start'](
      exportRequest({ format: 'html', csv: null, html: { packaging: 'file' } })
    )
    expect(bare).toMatchObject({ ok: true, format: 'html' })
    if (!bare.ok) return
    expect(bare.filename).toBe('textbolt.com-alerts-ai-visibility-2026-10-20.html')
    expect(readFileSync(bare.filePath, 'utf8').startsWith('<!doctype html>')).toBe(true)
    // The bare file's dialog call is not part of the JSON check below.
    seen.length = 1

    const json = await handlers['exports:start'](
      exportRequest({ format: 'json', csv: null, sections: ['overview', 'prompts', 'raw'] })
    )
    expect(json).toMatchObject({ ok: true, format: 'json' })
    if (!json.ok) return
    expect(seen[1]).toEqual({
      defaultPath: 'TextBolt-alerts-2026-10-19.json',
      filters: [{ name: 'JSON data', extensions: ['json'] }]
    })
    const text = readFileSync(json.filePath, 'utf8')
    const document = JSON.parse(text) as {
      results: { aioText: string | null }[]
      raw: { runId: string; search: unknown }[]
    }
    expect(document.results.map((row) => row.aioText)).toEqual(['Stored overview quote.'])
    expect(document.raw).toEqual([
      {
        runId: 'run-late',
        promptId: 'prompt-1',
        sampleNo: 1,
        search: { api_key: '[REDACTED]' },
        aio: null
      }
    ])
    expect(text).not.toContain(RAW_MARKER)
  })

  test('exports:start cancel returns Export cancelled and writes nothing', async () => {
    const { handlers, progress } = seed([
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    const saveDir = tempDir()
    configureExportSaveDialog(async () => ({ canceled: true }))
    const result = await handlers['exports:start'](exportRequest())
    expect(result).toEqual({
      ok: false,
      reason: 'Export cancelled',
      nextStep: 'Choose a file name and save.'
    })
    expect(readdirSync(saveDir)).toEqual([])
    expect(progress.some((event) => event.phase === 'write')).toBe(false)
  })

  test('a 02:00Z run counts as the previous day in America/Toronto', async () => {
    const { handlers } = seed([
      run('run-edge', '2026-10-20T01:00:00.000Z', '2026-10-20T02:00:00.000Z')
    ])
    const previousDay = await handlers['exports:preview'](
      exportRequest({
        checks: 'range',
        from: '2026-10-19',
        to: '2026-10-19',
        timeZone: 'America/Toronto'
      })
    )
    expect(previousDay.blocked).toBe(false)
    expect(previousDay.checkCount).toBe(1)

    const sameUtcDay = await handlers['exports:preview'](
      exportRequest({
        checks: 'range',
        from: '2026-10-20',
        to: '2026-10-20',
        timeZone: 'America/Toronto'
      })
    )
    expect(sameUtcDay.blocked).toBe(true)
    expect(sameUtcDay.checkCount).toBe(0)

    const utc = await handlers['exports:preview'](
      exportRequest({
        checks: 'range',
        from: '2026-10-20',
        to: '2026-10-20',
        timeZone: 'UTC'
      })
    )
    expect(utc.blocked).toBe(false)
    expect(utc.checkCount).toBe(1)

    const saveDir = tempDir()
    let defaultPath = ''
    configureExportSaveDialog(async (options) => {
      defaultPath = options.defaultPath
      return { canceled: false, filePath: join(saveDir, options.defaultPath) }
    })
    const started = await handlers['exports:start'](
      exportRequest({ checks: 'latest', timeZone: 'America/Toronto' })
    )
    expect(started.ok).toBe(true)
    expect(defaultPath).toBe('TextBolt-alerts-2026-10-19.zip')
  })

  test('exports:preview and exports:start reject an invalid time zone', async () => {
    const { handlers } = seed([
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    let opened = false
    configureExportSaveDialog(() => {
      opened = true
      return Promise.resolve({ canceled: true })
    })
    const preview = await handlers['exports:preview'](exportRequest({ timeZone: 'Not/AZone' }))
    expect(preview.blocked).toBe(true)
    expect(preview.reason).toBe('That time zone is not recognized.')
    expect(preview.nextStep).toBe('Use an IANA time zone such as America/Toronto.')
    const started = await handlers['exports:start'](exportRequest({ timeZone: 'Not/AZone' }))
    expect(started).toMatchObject({
      ok: false,
      reason: 'That time zone is not recognized.',
      nextStep: 'Use an IANA time zone such as America/Toronto.'
    })
    expect(opened).toBe(false)
  })

  test('exports:preview and exports:start block the raw section for CSV and XLSX', async () => {
    const { handlers } = seed([
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    const saveDir = tempDir()
    let opened = false
    configureExportSaveDialog(async (options) => {
      opened = true
      return { canceled: false, filePath: join(saveDir, options.defaultPath) }
    })
    const preview = await handlers['exports:preview'](
      exportRequest({ sections: ['overview', 'raw'] })
    )
    expect(preview.blocked).toBe(true)
    expect(preview.reason).toBe('Raw search data is only included in JSON exports.')
    expect(preview.nextStep).toBe('Remove the raw section, or choose JSON.')
    const started = await handlers['exports:start'](exportRequest({ sections: ['prompts', 'raw'] }))
    expect(started).toMatchObject({
      ok: false,
      reason: 'Raw search data is only included in JSON exports.'
    })
    expect(opened).toBe(false)
    expect(readdirSync(saveDir)).toEqual([])
  })

  test('exports:start emits collect, render, then write', async () => {
    const { handlers, progress } = seed([
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    const saveDir = tempDir()
    configureExportSaveDialog(async (options) => ({
      canceled: false,
      filePath: join(saveDir, options.defaultPath)
    }))
    const started = await handlers['exports:start'](exportRequest())
    expect(started.ok).toBe(true)
    const phases = progress.map((event) => event.phase)
    expect(phases[0]).toBe('collect')
    const renderAt = phases.indexOf('render')
    const writeAt = phases.indexOf('write')
    expect(renderAt).toBeGreaterThan(phases.lastIndexOf('collect'))
    expect(writeAt).toBeGreaterThan(renderAt)
    expect(phases.at(-1)).toBe('write')
    expect(
      progress.filter((event) => event.phase === 'collect').map((event) => event.state)
    ).toEqual(['running', 'ok'])
    expect(progress.filter((event) => event.phase === 'render').at(-1)?.state).toBe('ok')
    expect(progress.filter((event) => event.phase === 'write').map((event) => event.state)).toEqual(
      ['running', 'ok']
    )
  })

  test('a missing prompt set exports version unknown and uses the page id in the filename', async () => {
    const { handlers, directory } = seed([
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    const projectDb = openProjectDatabase(appDataPaths(directory).projectsDirectory, 'textbolt')
    projectDb.pragma('foreign_keys = OFF')
    projectDb.prepare(`DELETE FROM prompt_sets`).run()
    projectDb.pragma('foreign_keys = ON')
    projectDb
      .prepare(`UPDATE pages SET url = ?, label = NULL, title = NULL WHERE id = ?`)
      .run('https://example.com/---', 'page-1')
    closeProjectDatabase(projectDb)

    const saveDir = tempDir()
    const seen: string[] = []
    configureExportSaveDialog(async (options) => {
      seen.push(options.defaultPath)
      return { canceled: false, filePath: join(saveDir, options.defaultPath) }
    })

    const csv = await handlers['exports:start'](
      exportRequest({ sections: ['overview', 'prompts'] })
    )
    expect(csv).toMatchObject({ ok: true, format: 'csv' })
    if (!csv.ok) return
    expect(seen[0]).toBe('TextBolt-page-1-2026-10-19.zip')
    const entries = readStoredZip(readFileSync(csv.filePath))
    const csvText = entries.map((entry) => entry.data.toString('utf8')).join('\n')
    expect(entries.map((entry) => entry.name.replace(/^\d+-/, ''))).toContain('prompts.csv')
    expect(csvText).not.toContain('v0')

    const xlsx = await handlers['exports:start'](
      exportRequest({
        format: 'xlsx',
        csv: null,
        xlsx: { freezeHeaders: true, sheetPerMarket: false },
        sections: ['overview', 'prompts']
      })
    )
    expect(xlsx).toMatchObject({ ok: true, format: 'xlsx' })
    if (!xlsx.ok) return
    expect(seen[1]).toBe('TextBolt-page-1-2026-10-19.xlsx')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(xlsx.filePath)
    expect(workbook.getWorksheet('Prompts')).toBeDefined()

    const pdf = await handlers['exports:start'](
      exportRequest({
        format: 'pdf',
        csv: null,
        pdf: { pageSize: 'letter', charts: false, preparedFor: null, hideBranding: false },
        sections: ['overview']
      })
    )
    expect(pdf).toMatchObject({ ok: true, format: 'pdf' })
    if (!pdf.ok) return
    expect(seen[2]).toBe('TextBolt-page-1-2026-10-19.pdf')
    const text = extractPdfText(readFileSync(pdf.filePath))
    expect(text).toContain('Overview')
    expect(text).not.toContain('v0')
  })
})
