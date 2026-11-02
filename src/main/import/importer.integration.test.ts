import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ImportCommitRow, ImportPreviewRequest, ImportRow } from '@shared/ipc'
import { closeSeeds, seed } from '../engine/checks/checks.test-helper'
import { getLatestPromptSet } from '../storage/content-records'
import { getPage } from '../storage/pages'
import { insertMarket } from '../storage/project-profile'
import { getProject } from '../storage/records'
import { seedTextboltTopic } from '../topics/fixture-seed'
import { configureImportDialogs } from './service'

/**
 * The importer end to end through its IPC handlers, on a seeded project (page-1 and
 * the TextBolt topic): read a paste and files picked through a fake open dialog,
 * match columns, check rows, add one batch and undo it. Nothing is searched.
 */

let folder = ''
let picked: string | null = null
let savedTo: string | null = null

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'citefox-import-'))
  picked = null
  savedTo = null
  configureImportDialogs({
    open: () =>
      Promise.resolve(
        picked === null
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: [picked] }
      ),
    save: () =>
      Promise.resolve(
        savedTo === null ? { canceled: true } : { canceled: false, filePath: savedTo }
      )
  })
})

afterEach(() => {
  configureImportDialogs(null)
  closeSeeds()
  rmSync(folder, { recursive: true, force: true })
})

async function seeded(): Promise<
  Awaited<ReturnType<typeof seed>> & { topicId: string; topicTexts: string[] }
> {
  const project = await seed({ progress: [], http: () => ({ status: 500, body: '{}' }) })
  const record = getProject(project.storage.db, 'proj-1')
  if (record === null) throw new Error('no project')
  const { topicId } = seedTextboltTopic(project.projectDb, record)
  const topicTexts = (getLatestPromptSet(project.projectDb, topicId, [])?.prompts ?? []).map(
    (prompt) => prompt.variants[0]?.text ?? prompt.label
  )
  return { ...project, topicId, topicTexts }
}

function promptCount(db: Parameters<typeof getLatestPromptSet>[0], id: string): number {
  return getLatestPromptSet(db, id, [])?.prompts.length ?? 0
}

const NO_DEFAULTS = { stage: null, page: null, market: null } as const

function previewRequest(
  sourceId: string,
  mapping: readonly (string | null)[],
  targetId: string,
  extra: Partial<ImportPreviewRequest> = {}
): ImportPreviewRequest {
  return {
    projectId: 'proj-1',
    entity: 'questions',
    sourceId,
    mapping,
    stageWords: {},
    defaults: NO_DEFAULTS,
    rules: { keywords: true },
    targetId,
    saveMapping: false,
    ...extra
  }
}

function toCommit(rows: readonly ImportRow[], keepSimilar = false): ImportCommitRow[] {
  return rows
    .filter(
      (row) =>
        row.result === 'new' ||
        row.result === 'keyword' ||
        (keepSimilar && row.result === 'similar')
    )
    .map((row) => ({ values: row.values, keep: row.result === 'similar' }))
}

describe('import questions from a paste', () => {
  test('near duplicates (a year, an article or a plural apart) are merged and counted', async () => {
    const { handlers, topicId, topicTexts } = await seeded()
    const existing = topicTexts[0] ?? ''
    const paste = [
      'Question',
      `${existing} 2026`,
      'is it legal to text staff about shifts at night',
      'Is it legal to text the staff about shift at night, 2026?',
      'is it legal to text staff at night about shifts'
    ].join('\n')
    const read = await handlers['import:read']({
      projectId: 'proj-1',
      entity: 'questions',
      source: { kind: 'paste', text: paste },
      hasHeader: true
    })
    const preview = await handlers['import:preview'](
      previewRequest(read.sourceId, read.mapping, topicId)
    )
    expect(preview.rows.map((row) => [row.result, row.merged ?? false])).toEqual([
      ['duplicate', true],
      ['new', false],
      ['duplicate', true],
      // Other word order: maybe another question, so it waits for a decision.
      ['similar', false]
    ])
    expect(preview.rows[0]?.reason).toContain('· merged.')
    expect(preview.rows[0]?.match).toMatchObject({ text: existing, sameTarget: true })
    expect(preview.rows[2]?.reason).toBe('Same question as row 2 · merged.')
    expect(preview.counts).toMatchObject({ duplicate: 2, merged: 2, new: 1, similar: 1, total: 4 })
  })

  test('every row gets a result, the counts add up, and the batch can be undone', async () => {
    const { handlers, projectDb, topicId, topicTexts } = await seeded()
    const existing = topicTexts[0] ?? ''
    const paste = [
      'Question\tStage\tPage',
      `${existing}\tTOFU\t`,
      'How do I alert the crew?\tMOFU\t',
      'sms alerts for plumbers\t\t',
      'what replaced the vtext email to text gateway for alerts\tAwareness\t',
      'is it legal to text staff about shifts at night\tBOFU\t/pricing/',
      'is it legal to text staff about shifts at night\tBOFU\t',
      'why does TextBolt cost more than the others\tBOFU\t',
      'how do I send alerts to phones from a server\tProblem\thttps://other.com/x'
    ].join('\n')
    const read = await handlers['import:read']({
      projectId: 'proj-1',
      entity: 'questions',
      source: { kind: 'paste', text: paste },
      hasHeader: null
    })
    expect(read.hasHeader).toBe(true)
    expect(read.rowCount).toBe(8)
    expect(read.mapping).toEqual(['question', 'stage', 'page'])
    expect(read.columns.map((column) => column.letter)).toEqual(['A', 'B', 'C'])

    const preview = await handlers['import:preview'](
      previewRequest(read.sourceId, read.mapping, topicId)
    )
    expect(preview.rows.map((row) => row.result)).toEqual([
      'duplicate',
      'similar',
      'keyword',
      'fix',
      'new',
      'duplicate',
      'fix',
      'fix'
    ])
    expect(preview.counts).toEqual({
      new: 1,
      keyword: 1,
      similar: 1,
      duplicate: 2,
      fix: 3,
      total: 8,
      merged: 0
    })
    const counted =
      preview.counts.new +
      preview.counts.keyword +
      preview.counts.similar +
      preview.counts.duplicate +
      preview.counts.fix
    expect(counted).toBe(read.rowCount)
    expect(preview.rows[0]?.reason).toContain('Already tracked in')
    expect(preview.rows[1]?.reason).toContain('Also tracked in')
    expect(preview.rows[2]?.reason).toBe('4 words: tracked as a keyword.')
    expect(preview.rows[3]).toMatchObject({ fix: 'stage' })
    expect(preview.rows[5]?.reason).toBe('Same as row 5 in this list · skipped.')
    expect(preview.rows[6]).toMatchObject({ fix: 'brand' })
    expect(preview.rows[7]).toMatchObject({ fix: 'page' })
    expect(preview.rows[4]?.values.stage).toBe('decide')
    expect(preview.stageWords.find((word) => word.key === 'awareness')).toMatchObject({
      stage: null,
      rows: 1
    })
    expect(preview.stageWords.find((word) => word.key === 'tofu')).toMatchObject({
      stage: 'problem',
      builtIn: true
    })

    // "Awareness means Problem", saved with the column match.
    const fixed = await handlers['import:preview'](
      previewRequest(read.sourceId, read.mapping, topicId, {
        stageWords: { awareness: 'problem' },
        saveMapping: true
      })
    )
    expect(fixed.rows[3]).toMatchObject({ result: 'new' })
    expect(fixed.rows[3]?.values.stage).toBe('problem')

    const again = await handlers['import:read']({
      projectId: 'proj-1',
      entity: 'questions',
      source: { kind: 'paste', text: paste },
      hasHeader: true
    })
    expect(again.mappingSaved).toBe(true)
    expect(again.stageWords).toMatchObject({ awareness: 'problem' })

    const before = promptCount(projectDb, topicId)
    const commit = await handlers['import:commit']({
      projectId: 'proj-1',
      entity: 'questions',
      targetId: topicId,
      rules: { keywords: true },
      rows: toCommit(fixed.rows, true)
    })
    expect(commit.added).toBe(4)
    expect(commit.skipped).toEqual([])
    expect(commit.batchId).not.toBeNull()
    expect(commit.message).toBe('Added 4 questions.')
    expect(promptCount(projectDb, topicId)).toBe(before + 4)
    const kinds = (getLatestPromptSet(projectDb, topicId, [])?.prompts ?? []).slice(-4)
    expect(kinds).toHaveLength(4)

    // Committing the same rows again skips them all as duplicates.
    const twice = await handlers['import:commit']({
      projectId: 'proj-1',
      entity: 'questions',
      targetId: topicId,
      rules: { keywords: true },
      rows: toCommit(fixed.rows)
    })
    expect(twice.added).toBe(0)
    expect(twice.batchId).toBeNull()
    expect(twice.skipped).toHaveLength(3)

    const undone = await handlers['import:undo']({
      projectId: 'proj-1',
      batchId: commit.batchId ?? ''
    })
    expect(undone.removed).toBe(4)
    expect(undone.message).toBe('Undone: removed 4 questions.')
    expect(promptCount(projectDb, topicId)).toBe(before)
    await expect(
      handlers['import:undo']({ projectId: 'proj-1', batchId: commit.batchId ?? '' })
    ).rejects.toThrow('already undone')
  })

  test('validate gives the live checks for typed rows, with keep both', async () => {
    const { handlers, topicId, topicTexts } = await seeded()
    const result = await handlers['import:validate']({
      projectId: 'proj-1',
      entity: 'questions',
      targetId: topicId,
      rules: { keywords: true },
      rows: [
        { key: 'r1', values: { question: topicTexts[1] ?? '' } },
        { key: 'r2', values: { question: 'How do I alert the crew?' }, keep: true },
        { key: 'r3', values: { question: 'sms alerts', stage: 'TOFU' } },
        { key: 'r4', values: { question: '' } }
      ]
    })
    expect(result.rows.map((row) => [row.key, row.result])).toEqual([
      ['r1', 'duplicate'],
      ['r2', 'new'],
      ['r3', 'keyword'],
      ['r4', 'fix']
    ])
    expect(result.rows[1]?.reason).toContain('Kept next to')
    expect(result.counts.total).toBe(4)
  })

  test('the keyword rule can be turned off; page questions follow the page word limits', async () => {
    const { handlers, topicId } = await seeded()
    const off = await handlers['import:validate']({
      projectId: 'proj-1',
      entity: 'questions',
      targetId: topicId,
      rules: { keywords: false },
      rows: [{ key: 'a', values: { question: 'sms alerts' } }]
    })
    expect(off.rows[0]?.result).toBe('new')
    const page = await handlers['import:validate']({
      projectId: 'proj-1',
      entity: 'questions',
      targetId: 'page-1',
      rules: { keywords: true },
      rows: [
        { key: 'a', values: { question: 'sms alerts' } },
        {
          key: 'b',
          values: { question: 'how do I send one text alert to every driver on the night shift' }
        }
      ]
    })
    expect(page.rows.map((row) => row.fix ?? row.result)).toEqual(['short', 'new'])
  })

  test('questions added to a page are one batch; Undo removes them', async () => {
    const { handlers, projectDb } = await seeded()
    const before = promptCount(projectDb, 'page-1')
    const commit = await handlers['import:commit']({
      projectId: 'proj-1',
      entity: 'questions',
      targetId: 'page-1',
      rules: { keywords: true },
      rows: [
        {
          values: {
            question: 'how do I send one text alert to every driver on the night shift',
            stage: 'compare'
          },
          keep: false
        },
        {
          values: { question: 'what is the cheapest way to text all my staff from a spreadsheet' },
          keep: false
        },
        { values: { question: 'too short' }, keep: false }
      ]
    })
    expect(commit.added).toBe(2)
    expect(commit.skipped).toEqual([{ index: 2, reason: expect.stringContaining('Too short') }])
    expect(commit.promptIds[0]?.sourceId).toBe('page-1')
    expect(promptCount(projectDb, 'page-1')).toBe(before + 2)
    const set = getLatestPromptSet(projectDb, 'page-1', [])
    expect(
      set?.prompts.find(
        (prompt) =>
          prompt.label.includes('night shift') || prompt.variants[0]?.text.includes('night shift')
      )?.intentStage
    ).toBe('comparison')
    await handlers['import:undo']({ projectId: 'proj-1', batchId: commit.batchId ?? '' })
    expect(promptCount(projectDb, 'page-1')).toBe(before)
  })

  test('a Topic column can create a topic; Undo removes the topic', async () => {
    const { handlers, projectDb, topicId } = await seeded()
    const rows = [
      {
        values: {
          question: 'how do I page my on-call team by text',
          topic: 'On-call paging',
          createTopic: '1'
        },
        keep: false
      },
      {
        values: {
          question: 'what is the best sms tool for on-call',
          topic: 'On-call paging',
          createTopic: '1'
        },
        keep: false
      }
    ]
    const checked = await handlers['import:validate']({
      projectId: 'proj-1',
      entity: 'questions',
      targetId: topicId,
      rules: { keywords: true },
      rows: rows.map((row, index) => ({
        key: String(index),
        values: { ...row.values, createTopic: '' }
      }))
    })
    expect(checked.rows[0]).toMatchObject({ result: 'fix', fix: 'topic' })
    const commit = await handlers['import:commit']({
      projectId: 'proj-1',
      entity: 'questions',
      targetId: topicId,
      rules: { keywords: true },
      rows
    })
    expect(commit.added).toBe(2)
    const created = projectDb
      .prepare<unknown[], { id: string }>(
        "SELECT id FROM pages WHERE kind = 'topic' AND title = 'On-call paging'"
      )
      .get()
    expect(created).toBeDefined()
    expect(promptCount(projectDb, created?.id ?? '')).toBe(2)
    await handlers['import:undo']({ projectId: 'proj-1', batchId: commit.batchId ?? '' })
    expect(getPage(projectDb, created?.id ?? '', 'proj-1')?.status).toBe('removed')
  })
})

describe('a row’s own market and topic are saved (W3I-C1, C3)', () => {
  const UK = {
    id: 'mkt-uk',
    country: 'GB',
    language: 'en',
    location: null,
    device: 'desktop' as const,
    localWording: false,
    serpapiLocation: null
  }

  function marketsOf(db: Parameters<typeof getLatestPromptSet>[0], pageId: string): string[] {
    return db
      .prepare<unknown[], { market_id: string }>(
        'SELECT market_id FROM page_markets WHERE page_id = ? ORDER BY market_id'
      )
      .all(pageId)
      .map((row) => row.market_id)
  }

  test('a market the topic does not check needs a fix; Add it links it on import; Undo unlinks it', async () => {
    const { handlers, projectDb, topicId } = await seeded()
    insertMarket(projectDb, UK)
    const question = 'how do I text my whole crew in london about a shift change'
    const validate = (
      values: Record<string, string>
    ): ReturnType<(typeof handlers)['import:validate']> =>
      handlers['import:validate']({
        projectId: 'proj-1',
        entity: 'questions',
        targetId: topicId,
        rules: { keywords: true },
        rows: [{ key: 'a', values }]
      })
    expect((await validate({ question, market: 'mkt-uk' })).rows[0]).toMatchObject({
      result: 'fix',
      fix: 'market'
    })
    expect((await validate({ question, market: 'mkt-uk', addMarket: '1' })).rows[0]?.result).toBe(
      'new'
    )
    expect(marketsOf(projectDb, topicId)).toEqual(['mkt-us'])
    const commit = await handlers['import:commit']({
      projectId: 'proj-1',
      entity: 'questions',
      targetId: topicId,
      rules: { keywords: true },
      rows: [{ values: { question, market: 'mkt-uk', addMarket: '1' }, keep: false }]
    })
    expect(commit.added).toBe(1)
    expect(marketsOf(projectDb, topicId)).toEqual(['mkt-uk', 'mkt-us'])
    await handlers['import:undo']({ projectId: 'proj-1', batchId: commit.batchId ?? '' })
    expect(marketsOf(projectDb, topicId)).toEqual(['mkt-us'])
  })

  test('a topic made from the Topic column is checked in the markets its rows name', async () => {
    const { handlers, projectDb, topicId } = await seeded()
    insertMarket(projectDb, UK)
    const row = (question: string, topic: string, market: string): ImportCommitRow => ({
      values: { question, topic, createTopic: '1', ...(market ? { market } : {}) },
      keep: false
    })
    const checked = await handlers['import:validate']({
      projectId: 'proj-1',
      entity: 'questions',
      targetId: topicId,
      rules: { keywords: true },
      rows: [
        {
          key: 'a',
          values: {
            question: 'how do uk plumbers text customers',
            topic: 'UK trades',
            createTopic: '1',
            market: 'mkt-uk'
          }
        }
      ]
    })
    // A new topic takes any project market: nothing to fix.
    expect(checked.rows[0]?.result).toBe('new')
    const commit = await handlers['import:commit']({
      projectId: 'proj-1',
      entity: 'questions',
      targetId: topicId,
      rules: { keywords: true },
      rows: [
        row('how do uk plumbers text customers about a late van', 'UK trades', 'mkt-uk'),
        row('what is the best texting app for uk electricians', 'UK trades', 'mkt-uk'),
        row('how do clinics text patients a reminder the day before', 'Clinic reminders', 'mkt-uk'),
        row('which sms tool do dental clinics use for reminders', 'Clinic reminders', '')
      ]
    })
    expect(commit.added).toBe(4)
    const idOf = (title: string): string =>
      projectDb
        .prepare<unknown[], { id: string }>(
          "SELECT id FROM pages WHERE kind = 'topic' AND title = ?"
        )
        .get(title)?.id ?? ''
    expect(marketsOf(projectDb, idOf('UK trades'))).toEqual(['mkt-uk'])
    // A row with no market is checked in the usual markets too.
    expect(marketsOf(projectDb, idOf('Clinic reminders'))).toEqual(['mkt-uk', 'mkt-us'])
  })
})

describe('import files through the open dialog', () => {
  test('a 112-row CSV, with header detection and a token instead of a path', async () => {
    const { handlers, topicId } = await seeded()
    const lines = ['Query;Funnel stage;Landing page']
    for (let index = 1; index <= 112; index += 1) {
      lines.push(
        `"how do teams in city ${index} send text alerts; fast";${index % 2 === 0 ? 'TOFU' : 'BOFU'};/alerts/`
      )
    }
    picked = join(folder, 'questions.csv')
    writeFileSync(picked, `\uFEFF${lines.join('\r\n')}`)
    const file = await handlers['import:pickFile']({ entity: 'questions' })
    if (file.cancelled) throw new Error('cancelled')
    expect(file).toMatchObject({ name: 'questions.csv', kind: 'csv' })
    expect(JSON.stringify(file)).not.toContain(folder)
    const read = await handlers['import:read']({
      projectId: 'proj-1',
      entity: 'questions',
      source: { kind: 'file', token: file.token, sheet: null },
      hasHeader: null
    })
    expect(read.rowCount).toBe(112)
    expect(read.mapping).toEqual(['question', 'stage', 'page'])
    const preview = await handlers['import:preview'](
      previewRequest(read.sourceId, read.mapping, topicId)
    )
    expect(preview.counts.total).toBe(112)
    expect(
      preview.counts.new +
        preview.counts.similar +
        preview.counts.duplicate +
        preview.counts.fix +
        preview.counts.keyword
    ).toBe(112)
    expect(preview.rows[0]?.row).toBe(2)
    expect(preview.newPages).toEqual(['https://textbolt.com/alerts/'])
  })

  test('an Excel file with a sheet choice', async () => {
    const { handlers, topicId } = await seeded()
    const book = new ExcelJS.Workbook()
    book.addWorksheet('Notes').addRow(['ignore me'])
    const sheet = book.addWorksheet('Questions')
    sheet.addRow(['Question', 'Stage'])
    sheet.addRow(['how do I text my staff from Outlook', 'Options'])
    sheet.addRow(['which email to sms service works with alarm panels', 'Compare'])
    picked = join(folder, 'questions.xlsx')
    writeFileSync(picked, new Uint8Array((await book.xlsx.writeBuffer()) as ArrayBuffer))
    const file = await handlers['import:pickFile']({ entity: 'questions' })
    if (file.cancelled) throw new Error('cancelled')
    const first = await handlers['import:read']({
      projectId: 'proj-1',
      entity: 'questions',
      source: { kind: 'file', token: file.token, sheet: null },
      hasHeader: null
    })
    expect(first.sheets).toEqual(['Notes', 'Questions'])
    expect(first.sheet).toBe('Notes')
    const read = await handlers['import:read']({
      projectId: 'proj-1',
      entity: 'questions',
      source: { kind: 'file', token: file.token, sheet: 'Questions' },
      hasHeader: null
    })
    expect(read.rowCount).toBe(2)
    const preview = await handlers['import:preview'](
      previewRequest(read.sourceId, read.mapping, topicId)
    )
    expect(preview.rows.map((row) => row.values.stage)).toEqual(['options', 'compare'])
  })

  test('a dropped file sends its bytes, never a path', async () => {
    const { handlers } = await seeded()
    const data = Buffer.from('Question,Stage\nhow do I text my staff from Outlook,TOFU\n').toString(
      'base64'
    )
    const read = await handlers['import:read']({
      projectId: 'proj-1',
      entity: 'questions',
      source: { kind: 'dropped', name: 'dropped.csv', data, sheet: null },
      hasHeader: null
    })
    expect(read).toMatchObject({ name: 'dropped.csv', kind: 'csv', rowCount: 1 })
    await expect(
      handlers['import:read']({
        projectId: 'proj-1',
        entity: 'questions',
        source: { kind: 'dropped', name: '../../etc/passwd', data, sheet: null },
        hasHeader: null
      })
    ).rejects.toThrow()
    await expect(
      handlers['import:read']({
        projectId: 'proj-1',
        entity: 'questions',
        source: { kind: 'dropped', name: 'broken.xlsx', data, sheet: null },
        hasHeader: null
      })
    ).rejects.toThrow('Excel workbook')
  })

  test('cancel, an old .xls, a file over 10 MB and an unknown token', async () => {
    const { handlers } = await seeded()
    expect(await handlers['import:pickFile']({ entity: 'questions' })).toEqual({ cancelled: true })
    picked = join(folder, 'old.xls')
    writeFileSync(picked, 'x')
    await expect(handlers['import:pickFile']({ entity: 'questions' })).rejects.toThrow('.xlsx')
    picked = join(folder, 'big.csv')
    writeFileSync(picked, Buffer.alloc(10 * 1024 * 1024 + 1, 97))
    await expect(handlers['import:pickFile']({ entity: 'questions' })).rejects.toThrow('10 MB')
    await expect(
      handlers['import:read']({
        projectId: 'proj-1',
        entity: 'questions',
        source: { kind: 'file', token: 'file-unknown', sheet: null },
        hasHeader: null
      })
    ).rejects.toThrow('Choose it again')
  })

  test('templates are written through the save dialog', async () => {
    const { handlers } = await seeded()
    expect(await handlers['import:template']({ entity: 'questions', format: 'csv' })).toEqual({
      saved: false,
      fileName: null
    })
    savedTo = join(folder, 'template.csv')
    expect(await handlers['import:template']({ entity: 'questions', format: 'csv' })).toEqual({
      saved: true,
      fileName: 'template.csv'
    })
    const text = readFileSync(savedTo, 'utf8')
    expect(text.startsWith('\uFEFFQuestion,Stage,Page to be cited')).toBe(true)
    savedTo = join(folder, 'pages.xlsx')
    await handlers['import:template']({ entity: 'pages', format: 'xlsx' })
    expect(readFileSync(savedTo).subarray(0, 2).toString()).toBe('PK')
  })
})

describe('other lists', () => {
  test('competitors: checked, added, undone', async () => {
    const { handlers, projectDb } = await seeded()
    const read = await handlers['import:read']({
      projectId: 'proj-1',
      entity: 'competitors',
      source: {
        kind: 'paste',
        text: 'plivo.com\tPlivo\nhttps://www.clicksend.com/\tClickSend\ntextbolt.com\tUs\nclicksend.com\tAgain'
      },
      hasHeader: null
    })
    expect(read.hasHeader).toBe(false)
    expect(read.mapping).toEqual(['domain', 'name'])
    const preview = await handlers['import:preview']({
      ...previewRequest(read.sourceId, read.mapping, 'page-1'),
      entity: 'competitors',
      targetId: null
    })
    expect(preview.rows.map((row) => row.result)).toEqual(['new', 'new', 'fix', 'duplicate'])
    const count = (): number =>
      projectDb
        .prepare<unknown[], { n: number }>('SELECT COUNT(*) AS n FROM product_competitors')
        .get()?.n ?? 0
    const before = count()
    const commit = await handlers['import:commit']({
      projectId: 'proj-1',
      entity: 'competitors',
      targetId: null,
      rules: { keywords: true },
      rows: preview.rows.map((row) => ({ values: row.values, keep: false }))
    })
    expect(commit.added).toBe(2)
    expect(count()).toBe(before + 2)
    await handlers['import:undo']({ projectId: 'proj-1', batchId: commit.batchId ?? '' })
    expect(count()).toBe(before)
  })

  test('pages are only read and checked here; Import pages adds them', async () => {
    const { handlers } = await seeded()
    await expect(
      handlers['import:commit']({
        projectId: 'proj-1',
        entity: 'pages',
        targetId: null,
        rules: { keywords: true },
        rows: []
      })
    ).rejects.toThrow('Import pages')
  })

  test('requests with unknown keys or fields are refused', async () => {
    const { handlers } = await seeded()
    await expect(
      handlers['import:read']({
        projectId: 'proj-1',
        entity: 'questions',
        source: { kind: 'file', path: '/etc/passwd' },
        hasHeader: null
      } as never)
    ).rejects.toThrow()
    await expect(
      handlers['import:preview']({
        ...previewRequest('src-1', ['question', 'password'], 'page-1')
      })
    ).rejects.toThrow()
  })
})
