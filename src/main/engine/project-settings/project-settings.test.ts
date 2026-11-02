import { existsSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, test } from 'vitest'
import { defaultProjectClaudeSettings } from '@shared/domain'
import { cleanupHarness } from '../../handlers/test-harness'
import { getAlertSettings, saveAlertSettings } from '../../storage/alert-settings'
import { insertStoredCheckJob } from '../../storage/check-records'
import { projectDatabasePool } from '../../storage/project-db-pool'
import { closeProjectDatabase, openProjectDatabase } from '../../storage/project-files'
import { readProjectOptions } from '../../storage/project-options'
import { getCurrentOverride } from '../../storage/template-overrides'
import { insertMarket } from '../../storage/project-profile'
import {
  readProjectSchedule,
  readProjectScheduleCap,
  writeProjectSchedule
} from '../../storage/project-schedule'
import { addKeyUsage, getApiKey, getProject, readActiveProjectId } from '../../storage/records'
import { projectDatabasePath } from '../../storage/slug'
import type { SqliteDatabase } from '../../storage/database'
import { adminHarness, projectRequest } from './admin.test-helper'

afterEach(() => {
  cleanupHarness()
})

type Opened = ReturnType<typeof adminHarness>

async function serpKey(opened: Opened, name: string, projectIds: string[] = []): Promise<string> {
  const key = await opened.handlers['keys:add']({
    provider: 'serpapi',
    name,
    secret: `serp-secret-${name.toLowerCase().replace(/\W/g, '')}-0000`,
    cap: 1000,
    projectIds
  })
  return key.id
}

function withProjectFile<T>(opened: Opened, projectId: string, run: (db: SqliteDatabase) => T): T {
  const project = getProject(opened.storage.db, projectId)
  if (project === null) throw new Error('missing project')
  const db = openProjectDatabase(opened.storage.paths.projectsDirectory, project.slug)
  try {
    return run(db)
  } finally {
    closeProjectDatabase(db)
  }
}

describe('projectSettings:get and update (FR-10.8, FR-11.4, FR-11.7)', () => {
  test('a new project reads shared keys with no cap, Claude from Settings, and its file', async () => {
    const opened = adminHarness()
    const project = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const view = await opened.handlers['projectSettings:get']({ projectId: project.id })
    expect(view.search).toEqual({
      source: 'shared',
      cap: null,
      capRule: 'pause',
      dedicatedKeyId: null
    })
    expect(view.claude).toEqual(defaultProjectClaudeSettings())
    expect(view.defaultSamples).toBe(1)
    expect(view.templateOverrides).toEqual([])
    expect(view.usage).toMatchObject({ used: 0, allowance: null, projectedMonthEnd: null })
    expect(view.usage.resetsOn).toMatch(/^\d{4}-\d{2}-01$/)
    expect(view.markets.map((market) => market.country)).toEqual(['US'])
    expect(view.project.markets).toHaveLength(1)
    expect(existsSync(view.database.path)).toBe(true)
    expect(view.database.bytes).toBeGreaterThan(0)
    expect(view.database).toMatchObject({ pageCount: 0, checkCount: 0 })
  })

  test('saves a cap and its rule; allow 10% over adds the extra to the allowance', async () => {
    const opened = adminHarness()
    const project = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const notify = await opened.handlers['projectSettings:update']({
      projectId: project.id,
      search: { source: 'shared', cap: 500, capRule: 'notify', dedicatedKeyId: null },
      defaultSamples: 3
    })
    expect(notify.search).toMatchObject({ cap: 500, capRule: 'notify' })
    expect(notify.usage.allowance).toBe(500)
    expect(notify.defaultSamples).toBe(3)
    const over = await opened.handlers['projectSettings:update']({
      projectId: project.id,
      search: { source: 'shared', cap: 500, capRule: 'allow_10', dedicatedKeyId: null }
    })
    expect(over.usage.allowance).toBe(550)
    expect(over.defaultSamples).toBe(3)
  })

  test('a dedicated key serves only its project and is released when the project goes back', async () => {
    const opened = adminHarness()
    const first = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const second = await opened.handlers['projects:create'](projectRequest('Acme', 'acme.example'))
    const shared = await serpKey(opened, 'My plan')
    const client = await serpKey(opened, 'Acme own')
    await opened.handlers['projectSettings:update']({
      projectId: second.id,
      search: { source: 'dedicated', cap: null, capRule: 'pause', dedicatedKeyId: client }
    })
    expect(getApiKey(opened.storage.db, client)?.projectIds).toEqual([second.id])
    expect(getApiKey(opened.storage.db, shared)?.projectIds).toEqual([])
    await expect(
      opened.handlers['projectSettings:update']({
        projectId: first.id,
        search: { source: 'dedicated', cap: null, capRule: 'pause', dedicatedKeyId: client }
      })
    ).rejects.toThrow('That key is already dedicated to Acme')
    await opened.handlers['projectSettings:update']({
      projectId: second.id,
      search: { source: 'shared', cap: 200, capRule: 'pause', dedicatedKeyId: null }
    })
    expect(getApiKey(opened.storage.db, client)?.projectIds).toEqual([])
    const view = await opened.handlers['projectSettings:get']({ projectId: second.id })
    expect(view.search).toEqual({
      source: 'shared',
      cap: 200,
      capRule: 'pause',
      dedicatedKeyId: null
    })
  })

  test('refuses a Claude key that is not an Anthropic key and a template of the wrong kind', async () => {
    const opened = adminHarness()
    const project = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const serp = await serpKey(opened, 'My plan')
    // Shipped templates are seeded on first read.
    const templates = await opened.handlers['templates:list']({})
    expect(templates.some((template) => template.id === 'tpl-buyer-prompts')).toBe(true)
    await expect(
      opened.handlers['projectSettings:update']({
        projectId: project.id,
        claude: { ...defaultProjectClaudeSettings(), connection: 'api_key', keyId: serp }
      })
    ).rejects.toThrow('That Anthropic API key was not found')
    await expect(
      opened.handlers['projectSettings:update']({
        projectId: project.id,
        templateOverrides: [{ kind: 'coverage_matrix', templateId: 'tpl-buyer-prompts' }]
      })
    ).rejects.toThrow('That template was not found')
    const named = await opened.handlers['templates:create']({
      kind: 'buyer_prompts',
      name: 'Clinic prompts',
      fromId: 'tpl-buyer-prompts'
    })
    const saved = await opened.handlers['projectSettings:update']({
      projectId: project.id,
      templateOverrides: [{ kind: 'buyer_prompts', templateId: named.id }],
      claude: {
        ...defaultProjectClaudeSettings(),
        connection: 'claude_code',
        model: 'claude-opus-5-5'
      }
    })
    // TPL-1: the choice is the project's next version in template_overrides.
    expect(saved.templateOverrides).toEqual([{ kind: 'buyer_prompts', templateId: named.id }])
    const steps = await opened.handlers['templates:steps']({ projectId: project.id })
    expect(steps.find((step) => step.kind === 'buyer_prompts')?.status).toBe('project')
    // Choosing the app default again resets the step.
    const reset = await opened.handlers['projectSettings:update']({
      projectId: project.id,
      templateOverrides: []
    })
    expect(reset.templateOverrides).toEqual([])
    expect(saved.claude).toMatchObject({ connection: 'claude_code', model: 'claude-opus-5-5' })
    await expect(
      opened.handlers['projectSettings:update']({ projectId: project.id, extra: true } as never)
    ).rejects.toThrow('projectSettings:update: Invalid request')
  })
})

describe('copy settings, duplicate, and archive (FR-10.4, FR-10.8)', () => {
  test('a new project copies settings but never pages, a dedicated key, or Slack', async () => {
    const opened = adminHarness()
    const source = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const own = await serpKey(opened, 'Own key')
    await opened.handlers['pages:add']({
      projectId: source.id,
      url: 'https://textbolt.com/pricing',
      markets: [],
      intervalDays: 14,
      samples: 1,
      promptCount: 5
    })
    await opened.handlers['projectSettings:update']({
      projectId: source.id,
      search: { source: 'dedicated', cap: 800, capRule: 'allow_10', dedicatedKeyId: own },
      claude: {
        ...defaultProjectClaudeSettings(),
        fallback: 'retry_later',
        model: 'claude-opus-5-5'
      },
      defaultSamples: 2
    })
    await opened.handlers['templates:saveOverride']({
      projectId: source.id,
      kind: 'coverage_matrix',
      body: 'Rate {{ url }} for each prompt.',
      settings: { model: null, language: 'es', promptCount: null, tone: null }
    })
    withProjectFile(opened, source.id, (db) => {
      writeProjectSchedule(db, {
        ...readProjectSchedule(db, source.id),
        defaultIntervalDays: 30,
        dailyCheckTime: '06:00',
        paused: true,
        pagesDueToday: 0
      })
      saveAlertSettings(db, {
        ...getAlertSettings(db, source.id),
        desktop: true,
        slackEnabled: true,
        slackKeychainRef: 'citefox.slack.textbolt'
      })
    })
    const copy = await opened.handlers['projects:create'](
      projectRequest('Acme', 'acme.example', { copySettingsFrom: source.id })
    )
    expect(copy.foundPageCount).toBe(0)
    withProjectFile(opened, copy.id, (db) => {
      expect(readProjectSchedule(db, copy.id)).toMatchObject({
        defaultIntervalDays: 30,
        dailyCheckTime: '06:00',
        paused: false
      })
      expect(readProjectScheduleCap(db)).toEqual({
        cap: 800,
        capRule: 'allow_10',
        dedicatedKeyId: null
      })
      expect(readProjectOptions(db)).toMatchObject({
        defaultSamples: 2,
        claude: { fallback: 'retry_later', model: 'claude-opus-5-5' }
      })
      expect(getAlertSettings(db, copy.id)).toMatchObject({
        desktop: true,
        slackEnabled: false,
        slackKeychainRef: null
      })
      // TPL-1: the source's current template version is copied as version 1.
      expect(getCurrentOverride(db, 'coverage_matrix')).toMatchObject({
        version: 1,
        body: 'Rate {{ url }} for each prompt.',
        settings: { language: 'es' }
      })
    })
    expect(getApiKey(opened.storage.db, own)?.projectIds).toEqual([source.id])
  })

  test('create saves the chosen search source and Claude connection', async () => {
    const opened = adminHarness()
    const key = await serpKey(opened, 'Client key')
    const project = await opened.handlers['projects:create'](
      projectRequest('Acme', 'acme.example', {
        clientName: 'Acme Inc.',
        search: { source: 'dedicated', cap: null, capRule: 'notify', dedicatedKeyId: key },
        claude: { ...defaultProjectClaudeSettings(), connection: 'claude_code' }
      })
    )
    const view = await opened.handlers['projectSettings:get']({ projectId: project.id })
    expect(view.search).toEqual({
      source: 'dedicated',
      cap: null,
      capRule: 'notify',
      dedicatedKeyId: key
    })
    expect(view.claude.connection).toBe('claude_code')
    expect(getApiKey(opened.storage.db, key)?.projectIds).toEqual([project.id])
  })

  test('duplicate copies the profile, markets, and settings without pages', async () => {
    const opened = adminHarness()
    const source = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com', { clientName: 'TextBolt Inc.' })
    )
    withProjectFile(opened, source.id, (db) => {
      insertMarket(db, {
        id: 'mkt-uk',
        country: 'UK',
        language: 'en',
        location: null,
        device: 'mobile',
        localWording: false,
        serpapiLocation: null
      })
    })
    await opened.handlers['pages:add']({
      projectId: source.id,
      url: 'https://textbolt.com/pricing',
      markets: [],
      intervalDays: 14,
      samples: 1,
      promptCount: 5
    })
    await opened.handlers['projectSettings:update']({
      projectId: source.id,
      search: { source: 'shared', cap: 300, capRule: 'notify', dedicatedKeyId: null }
    })
    const copy = await opened.handlers['projectSettings:duplicate']({ projectId: source.id })
    expect(copy).toMatchObject({
      name: 'TextBolt (copy)',
      domain: 'textbolt.com',
      clientName: 'TextBolt Inc.',
      foundPageCount: 0,
      brandNames: ['TextBolt']
    })
    expect(copy.markets?.map((market) => market.country)).toEqual(['US', 'UK'])
    expect(copy.slug).not.toBe(source.slug)
    const view = await opened.handlers['projectSettings:get']({ projectId: copy.id })
    expect(view.search).toMatchObject({ cap: 300, capRule: 'notify' })
    expect((await opened.handlers['projects:list']()).activeProjectId).toBe(source.id)
    const again = await opened.handlers['projectSettings:duplicate']({ projectId: source.id })
    expect(again.name).toBe('TextBolt (copy 2)')
  })

  test('archive and restore go through projects:update', async () => {
    const opened = adminHarness()
    const project = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const archived = await opened.handlers['projects:update']({
      projectId: project.id,
      status: 'archived'
    })
    expect(archived.status).toBe('archived')
    const rows = await opened.handlers['connections:projectClaude']()
    expect(rows).toEqual([])
    const restored = await opened.handlers['projects:update']({
      projectId: project.id,
      status: 'active'
    })
    expect(restored.status).toBe('active')
    expect((await opened.handlers['connections:projectClaude']()).map((row) => row.name)).toEqual([
      'TextBolt'
    ])
  })
})

describe('projectSettings:delete (FR-10.8)', () => {
  test('needs the exact name and no running check', async () => {
    const opened = adminHarness()
    const project = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    await expect(
      opened.handlers['projectSettings:delete']({ projectId: project.id, confirmName: 'textbolt' })
    ).rejects.toThrow('Type the project name exactly to confirm')
    withProjectFile(opened, project.id, (db) => {
      insertStoredCheckJob(db, {
        id: 'job-running',
        startedAt: '2026-10-19T12:00:00.000Z',
        status: 'running',
        pageIds: ['page-x'],
        marketIds: null,
        promptIds: null,
        reason: 'manual',
        message: null,
        nextStep: null
      })
    })
    await expect(
      opened.handlers['projectSettings:delete']({ projectId: project.id, confirmName: 'TextBolt' })
    ).rejects.toThrow('A check is running for this project')
    expect(getProject(opened.storage.db, project.id)).not.toBeNull()
  })

  test('removes the file and pooled handles, keeps shared keys and spent searches', async () => {
    const opened = adminHarness()
    const doomed = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const other = await opened.handlers['projects:create'](projectRequest('Acme', 'acme.example'))
    await opened.handlers['projects:switch']({ projectId: doomed.id })
    const shared = await serpKey(opened, 'My plan')
    const only = await serpKey(opened, 'TextBolt only', [doomed.id])
    const both = await serpKey(opened, 'Both', [doomed.id, other.id])
    addKeyUsage(opened.storage.db, {
      id: 'usage-doomed',
      keyId: shared,
      projectId: doomed.id,
      month: '2026-10',
      searches: 12,
      calls: 12,
      tokens: 0
    })
    const file = projectDatabasePath(opened.storage.paths.projectsDirectory, doomed.slug)
    writeFileSync(`${file}.before-migration`, 'old copy')
    const pool = projectDatabasePool(opened.storage)
    const pooled = pool.get(doomed.slug)
    pool.get(other.slug)
    expect(pool.stats().open).toBe(2)

    const result = await opened.handlers['projectSettings:delete']({
      projectId: doomed.id,
      confirmName: 'TextBolt'
    })
    expect(result).toEqual({ projectId: doomed.id, activeProjectId: other.id })
    expect(readActiveProjectId(opened.storage.db)).toBe(other.id)
    expect(pooled.open).toBe(false)
    expect(pool.stats().open).toBe(1)
    for (const path of [file, `${file}-wal`, `${file}-shm`, `${file}.before-migration`]) {
      expect(existsSync(path)).toBe(false)
    }
    expect(getProject(opened.storage.db, doomed.id)).toBeNull()
    expect(getApiKey(opened.storage.db, shared)?.projectIds).toEqual([])
    expect(getApiKey(opened.storage.db, only)?.projectIds).toEqual([doomed.id])
    expect(getApiKey(opened.storage.db, both)?.projectIds).toEqual([other.id])
    const usage = opened.storage.db
      .prepare<unknown[], { project_id: string | null; searches: number }>(
        `SELECT project_id, searches FROM key_usage WHERE key_id = ?`
      )
      .all(shared)
    expect(usage).toEqual([{ project_id: null, searches: 12 }])
    expect(
      opened.storage.db.prepare(`SELECT COUNT(*) AS total FROM templates`).get()
    ).toMatchObject({ total: expect.any(Number) as number })
  })

  test('deleting the last project leaves no active project', async () => {
    const opened = adminHarness()
    const project = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const result = await opened.handlers['projectSettings:delete']({
      projectId: project.id,
      confirmName: 'TextBolt'
    })
    expect(result.activeProjectId).toBeNull()
    expect((await opened.handlers['projects:list']()).projects).toEqual([])
  })
})
