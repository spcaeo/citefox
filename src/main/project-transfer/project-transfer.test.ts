import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ProjectImportResult, ProjectImportSectionResult } from '@shared/ipc'
import { seedFixtureProject } from '../../../tests/e2e/fixture-project'
import { cleanupHarness, closers, harness } from '../handlers/test-harness'
import { openAppStorage } from '../storage/app-storage'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { PROJECT_MIGRATIONS } from '../storage/project-schema'
import { configureTransferDialogs } from './dialogs'
import type { ProjectFile } from './format'

/**
 * Moving a project to a new Mac: export one file, import it as a new project or
 * into the project with the same site, and never write a key or webhook.
 */

const API_KEY = 'serp-transfer-secret-4b1d9e7c'
const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/transfersecret'
const PROJECT_ID = 'proj-1'

const folders: string[] = []
let savePath = ''
let openPath = ''

afterEach(() => {
  configureTransferDialogs(null)
  cleanupHarness()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

beforeEach(() => {
  const out = mkdtempSync(join(tmpdir(), 'citefox-transfer-out-'))
  folders.push(out)
  savePath = join(out, 'textbolt.citefox-project.json')
  openPath = savePath
  configureTransferDialogs({
    save: async () => ({ canceled: false, filePath: savePath }),
    open: async () => ({ canceled: false, filePaths: [openPath] })
  })
})

async function setup(): Promise<ReturnType<typeof harness> & { dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-transfer-'))
  folders.push(dir)
  await seedFixtureProject(dir)
  const storage = openAppStorage(dir)
  closers.push(() => storage.close())
  const h = harness({ storage })
  // A key and a Slack webhook in the keychain, and the key pasted into a note by mistake.
  h.secrets.set('citefox.serpapi.key-9', API_KEY)
  h.secrets.set('citefox.slack.proj-1', WEBHOOK)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    db.prepare(
      `UPDATE alert_settings SET slack_enabled = 1, slack_keychain_ref = 'citefox.slack.proj-1'`
    ).run()
    db.prepare(
      `INSERT OR IGNORE INTO alert_settings (id, desktop, email_after_check, email_to, slack_enabled, slack_keychain_ref, monthly_client_pdf)
       VALUES (1, 1, 0, '[]', 1, 'citefox.slack.proj-1', 0)`
    ).run()
    db.prepare(
      `INSERT INTO notes (id, page_id, date, text, created_at, updated_at)
       VALUES ('note-1', 'page-1', '2026-10-19', ?, '2026-10-19T12:00:00.000Z', '2026-10-19T12:00:00.000Z')`
    ).run(`Pasted ${API_KEY} here by mistake`)
  } finally {
    closeProjectDatabase(db)
  }
  storage.db
    .prepare(
      `INSERT INTO report_schedules (id, name, project_id, timing_json, format, sections, markets, recipients, time_zone, subject, created_at)
       VALUES ('rs-1', 'Monthly client report', ?, '{"kind":"monthly","day":1,"time":"09:00"}', 'pdf', '[]', '[]', '["ada@example.com"]', 'UTC', 'TextBolt this month', '2026-10-19T12:00:00.000Z')`
    )
    .run(PROJECT_ID)
  const group = await h.handlers['structure:createGroup']({
    projectId: PROJECT_ID,
    name: 'Money pages',
    note: null
  })
  await h.handlers['structure:setGroupPages']({
    projectId: PROJECT_ID,
    groupId: group.id,
    add: ['page-1'],
    remove: []
  })
  await h.handlers['alerts:saveRule']({
    projectId: PROJECT_ID,
    id: null,
    name: 'Lost a citation',
    when: 'citation_lost',
    scoreDrop: null,
    competitorDomain: null,
    scope: { kind: 'tracked', ids: [] },
    marketIds: [],
    desktop: true,
    emailTo: ['ada@example.com'],
    slack: true,
    delivery: 'instant'
  })
  return { ...h, storage, dir }
}

function savedFile(): ProjectFile {
  return JSON.parse(readFileSync(savePath, 'utf8')) as ProjectFile
}

function section(
  result: ProjectImportResult,
  name: string
): ProjectImportSectionResult | undefined {
  return result.sections.find((item) => item.section === name)
}

describe('project export', () => {
  test('writes one versioned file with the settings and lists, no check results by default', async () => {
    const { handlers } = await setup()
    const summary = await handlers['transfer:projectSummary']({ projectId: PROJECT_ID })
    expect(summary.name).toBe('TextBolt')
    expect(summary.checkCount).toBeGreaterThan(0)
    const result = await handlers['transfer:exportProject']({
      projectId: PROJECT_ID,
      includeResults: false
    })
    expect(result).toMatchObject({ ok: true, filename: 'textbolt.citefox-project.json' })
    const file = savedFile()
    expect(file).toMatchObject({
      format: 'citefox-project',
      formatVersion: 1,
      schemaVersion: PROJECT_MIGRATIONS.length,
      includesResults: false,
      project: { name: 'TextBolt', domain: 'textbolt.com', clientName: null, status: 'active' }
    })
    for (const table of [
      'project_settings',
      'markets',
      'pages',
      'prompt_sets',
      'prompts',
      'groups',
      'group_pages',
      'alert_rules',
      'notes'
    ]) {
      expect(file.tables[table]?.length ?? 0, table).toBeGreaterThan(0)
    }
    expect(file.tables.runs).toBeUndefined()
    expect(file.tables.serp_results).toBeUndefined()
    expect(file.tables.page_markets?.[0]).toMatchObject({
      baseline_run_id: null,
      last_checked_at: null
    })
    expect(file.reportSchedules).toHaveLength(1)
    expect(file.reportSchedules[0]).toMatchObject({
      name: 'Monthly client report',
      account_id: null
    })
    expect(file.reportSchedules[0]).not.toHaveProperty('id')
    const counts = Object.fromEntries(summary.sections.map((item) => [item.section, item.count]))
    expect(counts).toMatchObject({
      pages: 1,
      markets: 1,
      competitors: 2,
      groups: 1,
      alertRules: 1,
      reportSchedules: 1
    })
    expect(counts.results).toBeUndefined()
  })

  test('never writes an API key, a Slack webhook or a keychain ref, even when they are set', async () => {
    const { handlers } = await setup()
    await handlers['transfer:exportProject']({ projectId: PROJECT_ID, includeResults: true })
    const text = readFileSync(savePath, 'utf8')
    expect(text).not.toContain(API_KEY)
    expect(text).not.toContain(WEBHOOK)
    expect(text).not.toContain('hooks.slack.com')
    expect(text).not.toContain('citefox.slack.proj-1')
    expect(text).toContain('[REDACTED] here by mistake')
    const file = JSON.parse(text) as ProjectFile
    expect(file.tables.alert_settings?.[0]).toMatchObject({
      slack_enabled: 0,
      slack_keychain_ref: null
    })
    expect(file.tables.project_options?.[0]?.claude_key_id ?? null).toBeNull()
  })

  test('Include stored check results adds the checks and their search results', async () => {
    const { handlers } = await setup()
    await handlers['transfer:exportProject']({ projectId: PROJECT_ID, includeResults: true })
    const file = savedFile()
    expect(file.includesResults).toBe(true)
    expect(file.tables.runs?.length ?? 0).toBeGreaterThan(0)
    expect(file.tables.serp_results?.length ?? 0).toBeGreaterThan(0)
    expect(file.tables.serp_results?.every((row) => row.key_id === null)).toBe(true)
  })
})

describe('project import', () => {
  test('round trip: imports as a new project, counts each part, and the delete path undoes it', async () => {
    const { handlers } = await setup()
    await handlers['transfer:exportProject']({ projectId: PROJECT_ID, includeResults: false })
    const picked = await handlers['transfer:pickProject']()
    if (!picked.ok) throw new Error(picked.reason)
    const preview = await handlers['transfer:projectPreview']({ token: picked.token })
    expect(preview).toMatchObject({
      formatVersion: 1,
      includesResults: false,
      project: { name: 'TextBolt', domain: 'textbolt.com' },
      sameSite: [{ projectId: PROJECT_ID, name: 'TextBolt' }],
      result: null
    })
    const result = await handlers['transfer:importProject']({
      token: picked.token,
      mode: 'new',
      replaceProjectId: null
    })
    expect(result).toMatchObject({
      mode: 'new',
      projectName: 'TextBolt (imported)',
      undoable: true
    })
    expect(section(result, 'pages')).toMatchObject({ added: 1, skipped: 0, failed: 0 })
    expect(section(result, 'markets')).toMatchObject({ added: 1 })
    expect(section(result, 'competitors')).toMatchObject({ added: 2 })
    expect(section(result, 'groups')).toMatchObject({ added: 1 })
    expect(section(result, 'alertRules')).toMatchObject({ added: 1 })
    expect(section(result, 'reportSchedules')).toMatchObject({ added: 1 })
    expect(section(result, 'questions')?.added).toBeGreaterThan(0)

    const list = await handlers['projects:list']()
    expect(list.projects.map((project) => project.name).sort()).toEqual([
      'TextBolt',
      'TextBolt (imported)'
    ])
    const copy = await handlers['projects:get']({ projectId: result.projectId })
    expect(copy.competitors).toEqual(['SimpleTexting', 'Twilio'])
    const pages = await handlers['pages:list']({ projectId: result.projectId })
    expect(pages.pages.map((page) => page.url)).toEqual([
      'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
    ])
    expect(
      (await handlers['projectSettings:get']({ projectId: result.projectId })).database.checkCount
    ).toBe(0)
    expect(
      (await handlers['transfer:projectPreview']({ token: picked.token })).result
    ).toMatchObject({
      projectId: result.projectId
    })

    await handlers['projectSettings:delete']({
      projectId: result.projectId,
      confirmName: result.projectName
    })
    expect((await handlers['projects:list']()).projects.map((project) => project.name)).toEqual([
      'TextBolt'
    ])
    expect((await handlers['transfer:projectPreview']({ token: picked.token })).result).toBeNull()
  })

  test('a file with stored results brings its checks along', async () => {
    const { handlers } = await setup()
    await handlers['transfer:exportProject']({ projectId: PROJECT_ID, includeResults: true })
    const picked = await handlers['transfer:pickProject']()
    if (!picked.ok) throw new Error(picked.reason)
    const result = await handlers['transfer:importProject']({
      token: picked.token,
      mode: 'new',
      replaceProjectId: null
    })
    expect(section(result, 'results')?.added).toBeGreaterThan(0)
    const original = await handlers['projectSettings:get']({ projectId: PROJECT_ID })
    const copy = await handlers['projectSettings:get']({ projectId: result.projectId })
    expect(copy.database.checkCount).toBe(original.database.checkCount)
  })

  test('replace adds what is new, skips what is already there and keeps the check history', async () => {
    const { handlers } = await setup()
    await handlers['transfer:exportProject']({ projectId: PROJECT_ID, includeResults: false })
    const file = savedFile()
    const before = await handlers['projectSettings:get']({ projectId: PROJECT_ID })
    // The file gains a page and a competitor the project does not have yet.
    const page = {
      ...file.tables.pages![0]!,
      id: 'page-new',
      url: 'https://textbolt.com/pricing/',
      label: 'Pricing'
    }
    file.tables.pages!.push(page)
    const settings = file.tables.project_settings![0]!
    settings.competitors = JSON.stringify(['simpletexting', 'Twilio', 'EZTexting'])
    const rival = file.tables.product_competitors![0]!
    file.tables.product_competitors!.push({
      ...rival,
      id: 999,
      name: 'EZTexting',
      domain: null,
      position: 9
    })
    openPath = join(folders[0]!, 'changed.citefox-project.json')
    writeFileSync(openPath, JSON.stringify(file))
    const picked = await handlers['transfer:pickProject']()
    if (!picked.ok) throw new Error(picked.reason)
    const result = await handlers['transfer:importProject']({
      token: picked.token,
      mode: 'replace',
      replaceProjectId: PROJECT_ID
    })
    expect(result).toMatchObject({ mode: 'replace', projectId: PROJECT_ID, undoable: false })
    expect(section(result, 'pages')).toMatchObject({ added: 1, skipped: 1, failed: 0 })
    expect(section(result, 'competitors')).toMatchObject({ added: 1, skipped: 2 })
    expect(section(result, 'groups')).toMatchObject({ added: 0, skipped: 1 })
    expect(section(result, 'alertRules')).toMatchObject({ added: 0, skipped: 1 })
    expect(section(result, 'reportSchedules')).toMatchObject({ added: 0, skipped: 1 })
    expect(section(result, 'settings')?.added).toBeGreaterThan(0)
    const project = await handlers['projects:get']({ projectId: PROJECT_ID })
    expect(project.competitors).toEqual(['SimpleTexting', 'Twilio', 'EZTexting'])
    const pages = await handlers['pages:list']({ projectId: PROJECT_ID })
    expect(pages.pages.map((item) => item.url).sort()).toEqual([
      'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
      'https://textbolt.com/pricing/'
    ])
    const after = await handlers['projectSettings:get']({ projectId: PROJECT_ID })
    expect(after.database.checkCount).toBe(before.database.checkCount)
    expect((await handlers['projects:list']()).projects).toHaveLength(1)
  })

  test('replace is refused for a project on another site', async () => {
    const { handlers } = await setup()
    await handlers['transfer:exportProject']({ projectId: PROJECT_ID, includeResults: false })
    const file = savedFile()
    file.project.domain = 'other.com'
    writeFileSync(savePath, JSON.stringify(file))
    const picked = await handlers['transfer:pickProject']()
    if (!picked.ok) throw new Error(picked.reason)
    expect((await handlers['transfer:projectPreview']({ token: picked.token })).sameSite).toEqual(
      []
    )
    await expect(
      handlers['transfer:importProject']({
        token: picked.token,
        mode: 'replace',
        replaceProjectId: PROJECT_ID
      })
    ).rejects.toThrow(/another site/)
  })

  test('the same page, question or competitor twice in the file is imported once', async () => {
    const { handlers } = await setup()
    await handlers['transfer:exportProject']({ projectId: PROJECT_ID, includeResults: false })
    const file = savedFile()
    const page = file.tables.pages![0]!
    file.tables.pages!.push({
      ...page,
      id: 'page-dup',
      url: 'https://www.TextBolt.com/blog/how-to-set-up-text-alerts-for-business'
    })
    file.tables.page_markets!.push({ ...file.tables.page_markets![0]!, page_id: 'page-dup' })
    file.tables.project_settings![0]!.competitors = JSON.stringify([
      'Twilio',
      'twilio',
      'SimpleTexting'
    ])
    const rival = file.tables.product_competitors!.find((row) => row.name === 'Twilio')!
    file.tables.product_competitors!.push({ ...rival, id: 998, name: 'twilio', position: 9 })
    const prompt = file.tables.prompts!.find((row) => row.enabled === 1)!
    file.tables.prompts!.push({ ...prompt, id: 'prompt-dup', position: 9 })
    const variant = file.tables.prompt_variants!.find((row) => row.prompt_id === prompt.id)!
    file.tables.prompt_variants!.push({
      ...variant,
      prompt_id: 'prompt-dup',
      text: `${String(variant.text).toUpperCase()}!`
    })
    writeFileSync(savePath, JSON.stringify(file))
    const picked = await handlers['transfer:pickProject']()
    if (!picked.ok) throw new Error(picked.reason)
    const result = await handlers['transfer:importProject']({
      token: picked.token,
      mode: 'new',
      replaceProjectId: null
    })
    expect(section(result, 'pages')).toMatchObject({ added: 1, skipped: 1 })
    expect(section(result, 'pages')?.notes.join(' ')).toMatch(/listed twice in the file/)
    expect(section(result, 'competitors')).toMatchObject({ added: 2, skipped: 1 })
    expect(section(result, 'questions')?.skipped).toBe(1)
    const pages = await handlers['pages:list']({ projectId: result.projectId })
    expect(pages.pages).toHaveLength(1)
  })

  test.each([
    ['not JSON', 'not json at all', /not valid JSON/],
    [
      'another format',
      JSON.stringify({ format: 'citefox-export', schemaVersion: 2 }),
      /not a CiteFox project file/
    ],
    [
      'a newer format',
      JSON.stringify({ format: 'citefox-project', formatVersion: 9 }),
      /newer version of CiteFox/
    ]
  ])('a bad file (%s) gets a plain error', async (_name, text, reason) => {
    const { handlers } = await setup()
    writeFileSync(savePath, text)
    const picked = await handlers['transfer:pickProject']()
    expect(picked.ok).toBe(false)
    if (!picked.ok) {
      expect(picked.cancelled).toBe(false)
      expect(picked.reason).toMatch(reason)
    }
  })

  test('a file with a newer database, an unknown part or an unknown field is refused', async () => {
    const { handlers } = await setup()
    await handlers['transfer:exportProject']({ projectId: PROJECT_ID, includeResults: false })
    const good = readFileSync(savePath, 'utf8')
    const cases: Array<[(file: ProjectFile) => void, RegExp]> = [
      [
        (file) => {
          file.schemaVersion = PROJECT_MIGRATIONS.length + 1
        },
        /newer version of CiteFox/
      ],
      [
        (file) => {
          file.tables.mystery = [{ a: 1 }]
        },
        /part CiteFox does not know/
      ],
      [
        (file) => {
          file.tables.pages![0]!.mystery_column = 1
        },
        /unknown field/
      ],
      [
        (file) => {
          file.tables.runs = [{ id: 'r' }]
        },
        /holds check results but says it does not/
      ],
      [
        (file) => {
          delete file.tables.markets
        },
        /no markets/
      ]
    ]
    for (const [change, reason] of cases) {
      const file = JSON.parse(good) as ProjectFile
      change(file)
      writeFileSync(savePath, JSON.stringify(file))
      const picked = await handlers['transfer:pickProject']()
      expect(picked.ok).toBe(false)
      if (!picked.ok) expect(picked.reason).toMatch(reason)
    }
    expect((await handlers['projects:list']()).projects).toHaveLength(1)
  })

  test('a hostile file cannot make an active report or alert email an outside address', async () => {
    const { handlers, storage } = await setup()
    await handlers['transfer:exportProject']({ projectId: PROJECT_ID, includeResults: false })
    const file = savedFile()
    const attacker = '["evil@attacker.example"]'
    file.reportSchedules[0] = {
      ...file.reportSchedules[0]!,
      recipients: attacker,
      status: 'active'
    }
    const alertSettings = file.tables.alert_settings![0]!
    alertSettings.email_after_check = 1
    alertSettings.email_to = attacker
    for (const rule of file.tables.alert_rules!) rule.email_to = attacker
    openPath = join(folders[0]!, 'hostile.citefox-project.json')
    writeFileSync(openPath, JSON.stringify(file))
    const picked = await handlers['transfer:pickProject']()
    if (!picked.ok) throw new Error(picked.reason)
    const result = await handlers['transfer:importProject']({
      token: picked.token,
      mode: 'new',
      replaceProjectId: null
    })
    const imported = storage.db
      .prepare<unknown[], { status: string; recipients: string }>(
        'SELECT status, recipients FROM report_schedules WHERE project_id = ?'
      )
      .all(result.projectId)
    expect(imported).toEqual([{ status: 'paused', recipients: '[]' }])
    const slug = storage.db
      .prepare<unknown[], { slug: string }>('SELECT slug FROM projects WHERE id = ?')
      .get(result.projectId)!.slug
    const db = openProjectDatabase(storage.paths.projectsDirectory, slug)
    try {
      expect(
        db.prepare('SELECT email_after_check, email_to FROM alert_settings WHERE id = 1').get()
      ).toEqual({ email_after_check: 0, email_to: '[]' })
      const rules = db
        .prepare<unknown[], { email_to: string }>('SELECT email_to FROM alert_rules')
        .all()
      expect(rules.length).toBeGreaterThan(0)
      for (const rule of rules) expect(rule.email_to).toBe('[]')
    } finally {
      closeProjectDatabase(db)
    }
  })

  test('a closed dialog is a quiet cancel', async () => {
    const { handlers } = await setup()
    configureTransferDialogs({
      save: async () => ({ canceled: true }),
      open: async () => ({ canceled: true, filePaths: [] })
    })
    expect(
      await handlers['transfer:exportProject']({ projectId: PROJECT_ID, includeResults: false })
    ).toMatchObject({
      ok: false,
      cancelled: true
    })
    expect(await handlers['transfer:pickProject']()).toMatchObject({ ok: false, cancelled: true })
  })
})
