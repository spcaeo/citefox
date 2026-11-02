import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { DEFAULT_TEMPLATE_SETTINGS } from '@shared/domain'
import { storageCallSink, withCallLog } from '../../llm/call-log'
import { createLogger } from '../../logging/logger'
import { saveTemplateOverride } from '../../pipeline/template-steps'
import {
  createGenerationTemplate,
  setDefaultGenerationTemplate,
  templateHash
} from '../../pipeline/templates'
import type {
  ClaudeCompletion,
  ClaudeCompletionRequest,
  ClaudeProvider
} from '../../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../../providers/claude/parse'
import { openAppStorage, type AppStorage } from '../../storage/app-storage'
import type { SqliteDatabase } from '../../storage/database'
import { closeProjectDatabase, createProjectDatabase } from '../../storage/project-files'
import { insertProject } from '../../storage/records'
import { projectDatabaseRelativePath } from '../../storage/slug'
import { checkReportsRoot } from './report-files'
import { createReportRunner } from './report-runner'
import { seedCheckedProject } from './report-seed.test-helper'
import { renderableCheckTemplates, resolveCheckTemplates } from './report-template-choice'
import { AIO_GAP_TEMPLATE, RUN_SUMMARY_TEMPLATE, SHIPPED_CHECK_TEMPLATES } from './report-templates'
import { writeCheckReports } from './reports'
import { NOW } from './reports.test-helper'

const directories: string[] = []
const closers: (() => void)[] = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

interface Fake extends ClaudeProvider {
  requests: ClaudeCompletionRequest[]
}

function fake(): Fake {
  const requests: ClaudeCompletionRequest[] = []
  return {
    id: 'claude-code',
    requests,
    async complete(request): Promise<ClaudeCompletion> {
      requests.push(request)
      const json =
        request.trace?.templateKind === 'aio_gap'
          ? {
              facts: [
                {
                  fact: 'Carrier gateways shut down and email-to-text stops.',
                  likelySource: 'https://simpletexting.com/blog/text-employees/'
                }
              ]
            }
          : { headline: 'One overview left the page out.', body: 'The page was not cited.' }
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 3,
        model: 'claude-test',
        resolvedModel: 'claude-test',
        usage: { ...emptyClaudeCliUsage(), inputTokens: 4, outputTokens: 2 }
      }
    }
  }
}

function setup(): { storage: AppStorage; db: SqliteDatabase; logs: string[] } {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-check-tpl-'))
  directories.push(directory)
  const storage = openAppStorage(directory)
  insertProject(storage.db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  const db = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  closers.push(() => storage.close())
  closers.unshift(() => closeProjectDatabase(db))
  seedCheckedProject(db)
  return { storage, db, logs: [] }
}

function logger(logs: string[]): ReturnType<typeof createLogger> {
  return createLogger({
    write: (_level, line) => {
      logs.push(line)
    }
  })
}

function analysisHashes(db: SqliteDatabase): Record<string, string | null> {
  const rows = db
    .prepare<unknown[], { kind: string; template_hash: string | null }>(
      `SELECT kind, template_hash FROM analyses WHERE run_id = 'run-us'`
    )
    .all()
  return Object.fromEntries(rows.map((row) => [row.kind, row.template_hash]))
}

describe('check report templates (FR-26.8)', () => {
  test('resolve the shipped defaults, an app default copy, and a project version', () => {
    const { storage, db, logs } = setup()
    const shipped = resolveCheckTemplates(storage.db, db, logger(logs))
    expect(shipped.aioGap).toMatchObject({ id: 'tpl-aio-gap', hash: AIO_GAP_TEMPLATE.hash })
    expect(shipped.runSummary).toMatchObject({
      id: 'tpl-run-summary',
      hash: RUN_SUMMARY_TEMPLATE.hash
    })
    const copy = createGenerationTemplate(
      storage.db,
      { kind: 'aio_gap', name: 'Shorter gap', body: `${AIO_GAP_TEMPLATE.body}\nKeep it short.` },
      { id: 'tpl-gap-copy', now: NOW }
    )
    setDefaultGenerationTemplate(storage.db, copy.id)
    saveTemplateOverride(
      storage.db,
      db,
      {
        kind: 'run_summary',
        body: `${RUN_SUMMARY_TEMPLATE.body}\nProject marker.`,
        settings: { ...DEFAULT_TEMPLATE_SETTINGS, language: 'es' }
      },
      { id: 'ovr-summary-1', now: NOW }
    )
    const chosen = resolveCheckTemplates(storage.db, db, logger(logs))
    expect(chosen.aioGap).toMatchObject({ id: 'tpl-gap-copy', hash: copy.templateHash })
    expect(chosen.runSummary).toEqual({
      id: 'ovr-summary-1',
      body: `${RUN_SUMMARY_TEMPLATE.body}\nProject marker.`,
      hash: templateHash(`${RUN_SUMMARY_TEMPLATE.body}\nProject marker.`),
      settings: { ...DEFAULT_TEMPLATE_SETTINGS, language: 'es' }
    })
  })

  test('a project version of run_summary renders with its settings and its hash is stored', async () => {
    const { storage, db, logs } = setup()
    const body = `${RUN_SUMMARY_TEMPLATE.body}\nProject marker.`
    saveTemplateOverride(
      storage.db,
      db,
      { kind: 'run_summary', body, settings: { ...DEFAULT_TEMPLATE_SETTINGS, language: 'es' } },
      { id: 'ovr-summary-1', now: NOW }
    )
    const claude = fake()
    const outcome = await writeCheckReports({
      db,
      projectId: 'proj-1',
      runId: 'run-us',
      domain: 'textbolt.com',
      reportsRoot: checkReportsRoot(storage.paths.root),
      claude,
      logger: logger(logs),
      templates: resolveCheckTemplates(storage.db, db, logger(logs))
    })
    expect(outcome).toBe('written')
    const summary = claude.requests.find((item) => item.trace?.templateKind === 'run_summary')
    expect(summary?.prompt).toContain('Project marker.')
    expect(summary?.prompt).toContain('Write every sentence of the output in Spanish (es).')
    expect(summary?.trace).toMatchObject({
      templateId: 'ovr-summary-1',
      templateHash: templateHash(body)
    })
    expect(analysisHashes(db)).toEqual({
      aio_gap: AIO_GAP_TEMPLATE.hash,
      summary: templateHash(body)
    })
    const generation = db
      .prepare<unknown[], { template_id: string }>(
        `SELECT template_id FROM generations WHERE kind = 'summary'`
      )
      .get()
    expect(generation?.template_id).toBe('ovr-summary-1')
  })

  test('a version with an unknown variable falls back to the shipped body and the job still finishes', async () => {
    const { storage, db, logs } = setup()
    saveTemplateOverride(
      storage.db,
      db,
      {
        kind: 'run_summary',
        body: 'Summarize {{ run.page_citd }} for {{ page.url }}.',
        settings: DEFAULT_TEMPLATE_SETTINGS
      },
      { id: 'ovr-summary-1', now: NOW }
    )
    const claude = fake()
    const outcome = await writeCheckReports({
      db,
      projectId: 'proj-1',
      runId: 'run-us',
      domain: 'textbolt.com',
      reportsRoot: checkReportsRoot(storage.paths.root),
      claude,
      logger: logger(logs),
      templates: resolveCheckTemplates(storage.db, db, logger(logs))
    })
    expect(outcome).toBe('written')
    const summary = claude.requests.find((item) => item.trace?.templateKind === 'run_summary')
    expect(summary?.trace).toMatchObject({
      templateId: 'tpl-run-summary',
      templateHash: RUN_SUMMARY_TEMPLATE.hash
    })
    expect(analysisHashes(db).summary).toBe(RUN_SUMMARY_TEMPLATE.hash)
    expect(logs.join('\n')).toContain('check template fallback')
  })

  test('renderableCheckTemplates keeps bodies that render and leaves the shipped ones alone', () => {
    const logs: string[] = []
    expect(renderableCheckTemplates(SHIPPED_CHECK_TEMPLATES, logger(logs))).toEqual(
      SHIPPED_CHECK_TEMPLATES
    )
    const edited = {
      ...SHIPPED_CHECK_TEMPLATES,
      aioGap: {
        id: 'tpl-gap-copy',
        body: 'Facts for {{ aio.prompt }}',
        hash: templateHash('Facts for {{ aio.prompt }}'),
        settings: DEFAULT_TEMPLATE_SETTINGS
      }
    }
    expect(renderableCheckTemplates(edited, logger(logs))).toEqual(edited)
    const broken = { ...edited, aioGap: { ...edited.aioGap, body: '{{ aio.nope }}' } }
    expect(renderableCheckTemplates(broken, logger(logs)).aioGap).toEqual(
      SHIPPED_CHECK_TEMPLATES.aioGap
    )
    expect(logs).toHaveLength(1)
  })

  test('the report runner logs one report call per step in the project llm_calls', async () => {
    const { storage, db, logs } = setup()
    const log = logger(logs)
    const claude = withCallLog(fake(), storageCallSink(storage, log))
    const runner = createReportRunner({ storage, logger: log, claude })
    runner.schedule({ id: 'job-1', projectId: 'proj-1', domain: 'textbolt.com' }, ['run-us'])
    await runner.idle()
    const rows = db
      .prepare<unknown[], { source: string; template_kind: string; template_id: string }>(
        `SELECT source, template_kind, template_id FROM llm_calls ORDER BY template_kind`
      )
      .all()
    expect(rows.filter((row) => row.template_kind !== 'answer_shape')).toEqual([
      { source: 'report', template_kind: 'aio_gap', template_id: 'tpl-aio-gap' },
      { source: 'report', template_kind: 'run_summary', template_id: 'tpl-run-summary' }
    ])
    // The answer-shape step runs after the reports through the same logged connection.
    const shapes = rows.filter((row) => row.template_kind === 'answer_shape')
    expect(shapes.length).toBeGreaterThan(0)
    expect(new Set(shapes.map((row) => `${row.source}:${row.template_id}`))).toEqual(
      new Set(['report:tpl-answer-shape'])
    )
    const appRows = storage.db
      .prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM llm_calls`)
      .get()
    expect(appRows?.n).toBe(0)
  })
})
