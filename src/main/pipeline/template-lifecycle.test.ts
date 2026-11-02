import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  DEFAULT_TEMPLATE_SETTINGS,
  PLANNED_TEMPLATE_KINDS,
  RETIRED_STEP_NOTICE,
  templateKindLifecycle,
  type GenerationTemplateKind,
  type TemplateLifecycleTables
} from '@shared/domain'
import { isPlaceholderTemplateBody, placeholderTemplateBody } from '../prompts/placeholder'
import { openAppDatabase } from '../storage/app-database'
import { closeDatabase, type SqliteDatabase } from '../storage/database'
import { createProjectDatabase } from '../storage/project-files'
import { listTemplates } from '../storage/template-records'
import {
  getTemplateStep,
  listTemplateSteps,
  resetTemplateOverride,
  saveTemplateOverride
} from './template-steps'
import {
  SHIPPED,
  assertRunnableKind,
  listGenerationTemplates,
  loadGenerationTemplate,
  seedShippedTemplates,
  selectPlaygroundTemplates
} from './templates'

/**
 * Planned and retired kinds (Docs/PROMPT-AUDIT.md section 3, rule 6). The retired
 * path runs on test tables that retire `coverage` in favour of a live kind; the
 * shipped tables retire it in favour of P1's three content-gap steps.
 */
const RETIRE_COVERAGE: TemplateLifecycleTables = {
  planned: PLANNED_TEMPLATE_KINDS,
  retirements: { coverage: ['buyer_prompts'] }
}

/** Nothing retired, so a test can save the old combined step's project version. */
const NOTHING_RETIRED: TemplateLifecycleTables = {
  planned: PLANNED_TEMPLATE_KINDS,
  retirements: {}
}

const NOW = '2026-10-22T09:00:00.000Z'
const databases: SqliteDatabase[] = []
const directories: string[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function appDb(): SqliteDatabase {
  const db = openAppDatabase(':memory:')
  databases.push(db)
  return db
}

function projectDb(): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-lifecycle-'))
  directories.push(directory)
  const db = createProjectDatabase(directory, 'textbolt')
  databases.push(db)
  return db
}

function capture(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

function saveCoverage(app: SqliteDatabase, project: SqliteDatabase): void {
  saveTemplateOverride(
    app,
    project,
    {
      kind: 'coverage',
      body: 'Old combined gaps for {{ url }}',
      settings: DEFAULT_TEMPLATE_SETTINGS
    },
    { id: 'ovr-coverage', now: NOW },
    NOTHING_RETIRED
  )
}

const PLANNED = Object.keys(PLANNED_TEMPLATE_KINDS) as GenerationTemplateKind[]
const FIRST_PLANNED = PLANNED[0] ?? 'coverage'
const LAST_PLANNED = PLANNED.at(-1) ?? 'coverage'

describe('planned kinds', () => {
  test('ship a placeholder body that names the owning package', () => {
    for (const kind of Object.keys(PLANNED_TEMPLATE_KINDS)) {
      const row = SHIPPED.find((item) => item.kind === kind)
      expect(row, kind).toBeDefined()
      expect(row?.body).toBe(placeholderTemplateBody(kind))
      expect(isPlaceholderTemplateBody(row?.body ?? '')).toBe(true)
      expect(row?.body).toContain(`package ${PLANNED_TEMPLATE_KINDS[kind]} `)
    }
    for (const row of SHIPPED.filter((item) => templateKindLifecycle(item.kind) === 'live')) {
      expect(isPlaceholderTemplateBody(row.body), row.kind).toBe(false)
    }
  })

  // The kinds still planned on this branch; the tests below skip once every package has shipped.
  test.skipIf(PLANNED.length === 0)(
    'are not seeded, listed, run or offered in the playground',
    () => {
      const app = appDb()
      const seeded = seedShippedTemplates(app).map((template) => template.kind)
      expect(seeded).not.toContain(FIRST_PLANNED)
      expect(seeded).not.toContain(LAST_PLANNED)
      expect(listTemplates(app).some((record) => record.kind === FIRST_PLANNED)).toBe(false)
      expect(listGenerationTemplates(app, {}).some((t) => t.kind === LAST_PLANNED)).toBe(false)
      expect(listTemplateSteps(app, null).some((step) => step.kind === LAST_PLANNED)).toBe(false)
      expect(capture(() => loadGenerationTemplate(app, FIRST_PLANNED))).toMatchObject({
        code: 'step_unavailable',
        channel: 'buyerProfile:generate'
      })
      expect(
        capture(() =>
          selectPlaygroundTemplates(app, {
            url: 'https://textbolt.com/',
            kind: FIRST_PLANNED,
            overrides: null
          })
        )
      ).toMatchObject({ code: 'step_unavailable', channel: 'playground:run' })
    }
  )

  test.skipIf(PLANNED.length === 0)('cannot get a project version', () => {
    const app = appDb()
    const project = projectDb()
    const error = capture(() =>
      saveTemplateOverride(
        app,
        project,
        { kind: LAST_PLANNED, body: 'Next', settings: DEFAULT_TEMPLATE_SETTINGS },
        { id: 'ovr-next', now: NOW }
      )
    )
    expect(error).toMatchObject({ code: 'step_unavailable', channel: 'templates:saveOverride' })
    expect(listTemplateSteps(app, project).some((step) => step.kind === LAST_PLANNED)).toBe(false)
  })

  test('seed once the package removes the kind from the planned list', () => {
    const app = appDb()
    const shipped: TemplateLifecycleTables = { planned: {}, retirements: {} }
    const seeded = seedShippedTemplates(app, () => NOW, shipped).map((template) => template.kind)
    expect(seeded).toContain('coverage_matrix')
    expect(seeded).toContain('topic_fix_draft')
  })
})

describe('retired kinds', () => {
  test('list only for a project that has its own version, read-only with the notice', () => {
    const app = appDb()
    const project = projectDb()
    saveCoverage(app, project)

    const step = getTemplateStep(app, project, 'coverage', RETIRE_COVERAGE)
    expect(step.status).toBe('project')
    expect(step.override?.body).toBe('Old combined gaps for {{ url }}')
    expect(step.retired).toEqual({ notice: RETIRED_STEP_NOTICE, replacedBy: ['buyer_prompts'] })

    expect(listTemplateSteps(app, projectDb(), RETIRE_COVERAGE).map((s) => s.kind)).not.toContain(
      'coverage'
    )
    expect(listTemplateSteps(app, null, RETIRE_COVERAGE).map((s) => s.kind)).not.toContain(
      'coverage'
    )
    // Live steps carry no notice.
    expect(getTemplateStep(app, project, 'buyer_prompts', RETIRE_COVERAGE).retired).toBeNull()
  })

  test('refuse a new version, a reset and a run', () => {
    const app = appDb()
    const project = projectDb()
    saveCoverage(app, project)
    expect(
      capture(() =>
        saveTemplateOverride(
          app,
          project,
          { kind: 'coverage', body: 'Edited', settings: DEFAULT_TEMPLATE_SETTINGS },
          { id: 'ovr-coverage-2', now: NOW },
          RETIRE_COVERAGE
        )
      )
    ).toMatchObject({ code: 'step_unavailable', channel: 'templates:saveOverride' })
    expect(
      capture(() => resetTemplateOverride(app, project, 'coverage', NOW, RETIRE_COVERAGE))
    ).toMatchObject({ code: 'step_unavailable', channel: 'templates:resetOverride' })
    expect(
      capture(() => assertRunnableKind('coverage', 'gaps:generate', RETIRE_COVERAGE))
    ).toMatchObject({ code: 'step_unavailable', channel: 'gaps:generate' })
    // The version itself stays in the project file.
    expect(getTemplateStep(app, project, 'coverage', RETIRE_COVERAGE).override?.version).toBe(1)
  })

  test('the shipped tables retire coverage once its three steps ship (P1)', () => {
    const app = appDb()
    const project = projectDb()
    saveCoverage(app, project)
    expect(getTemplateStep(app, project, 'coverage').retired).toEqual({
      notice: RETIRED_STEP_NOTICE,
      replacedBy: ['coverage_matrix', 'page_audit', 'coverage_fixes']
    })
    expect(
      capture(() => loadGenerationTemplate(app, 'coverage', undefined, 'gaps:generate', project))
    ).toMatchObject({ code: 'step_unavailable', channel: 'gaps:generate' })
    expect(seedShippedTemplates(app).map((template) => template.kind)).toContain('coverage_matrix')
  })
})
