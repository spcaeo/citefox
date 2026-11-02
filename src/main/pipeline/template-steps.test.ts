import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  ASSISTANT_TEMPLATE_KINDS,
  TOPIC_TEMPLATE_KINDS,
  templateKindLifecycle
} from '@shared/domain'
import {
  DEFAULT_TEMPLATE_SETTINGS,
  GENERATION_TEMPLATE_KINDS,
  compareTemplateKinds
} from '@shared/domain'
import { openAppDatabase } from '../storage/app-database'
import { closeDatabase, type SqliteDatabase } from '../storage/database'
import { insertLlmCall } from '../storage/llm-calls'
import { createProjectDatabase } from '../storage/project-files'
import {
  TEMPLATE_SCHEMAS,
  getTemplateStep,
  listTemplateSteps,
  listVersionsOf,
  resetTemplateOverride,
  saveTemplateOverride,
  templateSchemaFor
} from './template-steps'
import {
  TemplateContractError,
  createGenerationTemplate,
  setDefaultGenerationTemplate,
  shippedBody,
  templateHash,
  updateGenerationTemplate
} from './templates'

const databases: SqliteDatabase[] = []
const directories: string[] = []
const NOW = '2026-10-19T12:00:00.000Z'
const LATER = '2026-10-19T13:00:00.000Z'

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
  const directory = mkdtempSync(join(tmpdir(), 'citefox-steps-'))
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

describe('template steps (FR-26.1)', () => {
  test('without a project every step is listed in run order as shipped', () => {
    const steps = listTemplateSteps(appDb(), null)
    expect(steps.map((step) => step.kind)).toEqual([
      'buyer_profile',
      'buyer_prompts',
      'brand_prompts',
      'coverage_matrix',
      'page_audit',
      'coverage_fixes',
      'aio_gap',
      'answer_shape',
      'sentiment_claims_v2',
      'sentiment_fact_check',
      'video_brief',
      'run_summary',
      // Planned kinds are not written yet; retired kinds are hidden from the run order.
      ...TOPIC_TEMPLATE_KINDS.filter((kind) => templateKindLifecycle(kind) === 'live'),
      ...ASSISTANT_TEMPLATE_KINDS
    ])
    expect(steps.map((step) => step.position)).toEqual(steps.map((_, index) => index + 1))
    for (const step of steps) {
      expect(step.status).toBe('shipped')
      expect(step.override).toBeNull()
      expect(step.lastRunAt).toBeNull()
      expect(step.shipped.id).toBe(step.appDefault.id)
      expect(step.effective.source).toBe('app')
      expect(step.effective.id).toBe(step.shipped.id)
      expect(step.effective.body).toBe(shippedBody(step.kind))
      expect(step.effective.hash).toBe(templateHash(step.effective.body))
      expect(step.effective.settings).toEqual(DEFAULT_TEMPLATE_SETTINGS)
      expect(step.schema).not.toBeNull()
      expect(JSON.parse(step.schema ?? 'null')).toEqual(TEMPLATE_SCHEMAS[step.kind])
      expect(step.variables.length).toBeGreaterThan(0)
    }
    const names = (kind: string): string[] =>
      (steps.find((step) => step.kind === kind)?.variables ?? []).map((item) => item.name)
    expect(names('buyer_profile')).toContain('page_text')
    expect(names('buyer_profile')).not.toContain('page.url')
    expect(names('aio_gap')).toContain('page.url')
    expect(names('run_summary')).toContain('run.page_cited')
    expect(names('run_summary')).not.toContain('page_text')
  })

  test('a user template set as the app default shows as edited', () => {
    const app = appDb()
    const copy = createGenerationTemplate(
      app,
      { kind: 'coverage_matrix', name: 'Our coverage', body: 'Coverage for {{ url }}' },
      { id: 'tpl-ours', now: NOW }
    )
    setDefaultGenerationTemplate(app, copy.id)
    const step = getTemplateStep(app, null, 'coverage_matrix')
    expect(step.status).toBe('edited')
    expect(step.shipped.isShipped).toBe(true)
    expect(step.appDefault.id).toBe('tpl-ours')
    expect(step.effective).toMatchObject({
      source: 'app',
      id: 'tpl-ours',
      name: 'Our coverage',
      body: 'Coverage for {{ url }}',
      hash: templateHash('Coverage for {{ url }}'),
      version: 1
    })
    expect(getTemplateStep(app, null, 'buyer_profile').status).toBe('shipped')
  })

  test('the app default carries its own settings into the effective template', () => {
    const app = appDb()
    createGenerationTemplate(
      app,
      { kind: 'aio_gap', name: 'Gap ES', body: 'Gap for {{ page.url }}' },
      { id: 'tpl-gap', now: NOW }
    )
    updateGenerationTemplate(
      app,
      {
        id: 'tpl-gap',
        settings: { model: 'claude-haiku-5-5', language: 'es', promptCount: 4, tone: 'plain' }
      },
      LATER
    )
    setDefaultGenerationTemplate(app, 'tpl-gap')
    const step = getTemplateStep(app, null, 'aio_gap')
    expect(step.effective.settings).toEqual({
      model: 'claude-haiku-5-5',
      language: 'es',
      promptCount: null,
      tone: null
    })
  })

  test('project versions save v1 and v2, reset to the app default, and continue at v3', () => {
    const app = appDb()
    const project = projectDb()
    const first = saveTemplateOverride(
      app,
      project,
      {
        kind: 'buyer_prompts',
        body: 'Prompts v1 for {{ url }}',
        settings: { model: null, language: 'es', promptCount: 4, tone: 'search_short' }
      },
      { id: 'ovr-1', now: NOW }
    )
    expect(first.status).toBe('project')
    expect(first.override?.version).toBe(1)
    expect(first.override?.baseTemplateId).toBe('tpl-buyer-prompts')
    // search_short never applies to buyer prompts.
    expect(first.override?.settings).toEqual({
      model: null,
      language: 'es',
      promptCount: 4,
      tone: null
    })

    const second = saveTemplateOverride(
      app,
      project,
      {
        kind: 'buyer_prompts',
        body: 'Prompts v2 for {{ url }}',
        settings: { model: 'claude-opus-5-5', language: null, promptCount: null, tone: 'plain' }
      },
      { id: 'ovr-2', now: LATER }
    )
    expect(second.status).toBe('project')
    expect(second.override).toMatchObject({ id: 'ovr-2', version: 2, kind: 'buyer_prompts' })
    expect(second.effective).toEqual({
      source: 'project',
      id: 'ovr-2',
      name: "This project's version v2",
      body: 'Prompts v2 for {{ url }}',
      hash: templateHash('Prompts v2 for {{ url }}'),
      version: 2,
      settings: { model: 'claude-opus-5-5', language: null, promptCount: null, tone: 'plain' }
    })
    // Other steps and the app-only list are untouched.
    expect(getTemplateStep(app, project, 'buyer_profile').status).toBe('shipped')
    expect(getTemplateStep(app, null, 'buyer_prompts').status).toBe('shipped')

    const projectVersions = listVersionsOf(app, { projectDb: project, kind: 'buyer_prompts' })
    expect(projectVersions.map((entry) => [entry.version, entry.current, entry.source])).toEqual([
      [2, true, 'project'],
      [1, false, 'project']
    ])
    expect(projectVersions[0]?.hash).toBe(templateHash('Prompts v2 for {{ url }}'))
    expect(projectVersions[1]?.savedAt).toBe(NOW)

    const reset = resetTemplateOverride(app, project, 'buyer_prompts', LATER)
    expect(reset.status).toBe('shipped')
    expect(reset.override).toBeNull()
    expect(reset.effective.source).toBe('app')
    expect(reset.effective.id).toBe('tpl-buyer-prompts')
    expect(
      listVersionsOf(app, { projectDb: project, kind: 'buyer_prompts' }).map(
        (entry) => entry.current
      )
    ).toEqual([false, false])

    const third = saveTemplateOverride(
      app,
      project,
      { kind: 'buyer_prompts', body: 'Prompts v3', settings: DEFAULT_TEMPLATE_SETTINGS },
      { id: 'ovr-3', now: LATER }
    )
    expect(third.override?.version).toBe(3)
    expect(third.effective.name).toBe("This project's version v3")
    expect(
      listVersionsOf(app, { projectDb: project, kind: 'buyer_prompts' }).map((entry) => [
        entry.version,
        entry.current
      ])
    ).toEqual([
      [3, true],
      [2, false],
      [1, false]
    ])
  })

  test('reset with no project version is a typed error, and a syntax error rejects a save', () => {
    const app = appDb()
    const project = projectDb()
    const error = capture(() => resetTemplateOverride(app, project, 'coverage_matrix', NOW))
    expect(error).toBeInstanceOf(TemplateContractError)
    expect(error).toMatchObject({ code: 'no_override', channel: 'templates:resetOverride' })

    const syntax = capture(() =>
      saveTemplateOverride(
        app,
        project,
        {
          kind: 'coverage_matrix',
          body: '{% if url %}x{% endif %}',
          settings: DEFAULT_TEMPLATE_SETTINGS
        },
        { id: 'ovr-bad', now: NOW }
      )
    )
    expect(syntax).toMatchObject({ code: 'syntax', channel: 'templates:saveOverride' })
    expect(getTemplateStep(app, project, 'coverage_matrix').status).toBe('shipped')
  })

  test('app template versions are listed newest first with the current one marked', () => {
    const app = appDb()
    createGenerationTemplate(
      app,
      { kind: 'run_summary', name: 'Summary', body: 'One {{ page.url }}' },
      { id: 'tpl-sum', now: NOW }
    )
    updateGenerationTemplate(app, { id: 'tpl-sum', body: 'Two {{ page.url }}' }, LATER)
    const versions = listVersionsOf(app, { id: 'tpl-sum' })
    expect(versions.map((entry) => [entry.version, entry.current, entry.source])).toEqual([
      [2, true, 'app'],
      [1, false, 'app']
    ])
    expect(versions[0]?.hash).toBe(templateHash('Two {{ page.url }}'))
    expect(versions[0]?.savedAt).toBe(LATER)
    expect(versions[1]?.savedAt).toBe(NOW)
    expect(capture(() => listVersionsOf(app, { id: 'tpl-missing' }))).toMatchObject({
      code: 'not_found',
      channel: 'templates:versions'
    })
  })

  test('lastRunAt is the newest Claude call of that kind in the project', () => {
    const app = appDb()
    const project = projectDb()
    for (const [id, startedAt] of [
      ['llm-1', '2026-10-18T09:00:00.000Z'],
      ['llm-2', '2026-10-19T10:00:00.000Z']
    ] as const) {
      insertLlmCall(
        project,
        {
          id,
          connection: 'claude-code',
          model: 'claude-sonnet-5-5',
          source: 'report',
          templateKind: 'aio_gap',
          templateId: 'tpl-aio-gap',
          templateHash: templateHash('x'),
          assistId: null,
          startedAt,
          durationMs: 10,
          tokensIn: 1,
          tokensOut: 1,
          ok: true,
          error: null
        },
        { table: 'project' }
      )
    }
    const steps = listTemplateSteps(app, project)
    expect(steps.find((step) => step.kind === 'aio_gap')?.lastRunAt).toBe(
      '2026-10-19T10:00:00.000Z'
    )
    expect(steps.find((step) => step.kind === 'run_summary')?.lastRunAt).toBeNull()
  })

  test('run order puts the check steps in place and unknown kinds last by name', () => {
    const sorted = [...GENERATION_TEMPLATE_KINDS, 'zeta_step', 'alpha_step'].sort(
      compareTemplateKinds
    )
    // Planned kinds (Docs/PROMPT-AUDIT.md) already have their place next to the step they split.
    expect(sorted).toEqual([
      'buyer_profile',
      'buyer_prompts',
      'brand_prompts',
      'coverage',
      'coverage_matrix',
      'page_audit',
      'coverage_fixes',
      'aio_gap',
      'answer_shape',
      'sentiment_claims',
      'sentiment_claims_v2',
      'sentiment_fact_check',
      'video_brief',
      'run_summary',
      'topic_seed_discover',
      'topic_buyer_profile',
      'topic_profile_discover',
      'topic_profile_discover_v2',
      'topic_profile_rewrite',
      'topic_journey_questions',
      'topic_questions_discover',
      'topic_keyword_terms',
      'topic_keyword_expand',
      'topic_keyword_competitor',
      'topic_page_match',
      'topic_page_brief',
      'topic_target_suggest',
      'topic_questions_cleanup',
      'competitor_page_questions',
      'competitor_page_questions_v2',
      'competitor_page_claims',
      'topic_summary',
      'topic_next_actions',
      'topic_why_not_cited',
      'topic_explain_citation',
      'topic_citation_diagnosis',
      'topic_fix_draft',
      'topic_page_edit',
      'topic_owner_why',
      'topic_cluster_suggest',
      'topic_cluster_sort',
      'topic_cluster_name',
      'assistant_explain',
      'assistant_why_not_cited',
      'assistant_next_steps',
      'assistant_draft',
      'assistant_questions',
      'assistant_changes',
      'assistant_summary',
      'assistant_help',
      'alpha_step',
      'zeta_step'
    ])
    expect(sorted.indexOf('aio_gap')).toBeLessThan(sorted.indexOf('run_summary'))
  })

  test('templateSchemaFor uses the known schema, then the stored JSON, else none', () => {
    expect(templateSchemaFor('coverage', '{"type":"string"}')).toBe(TEMPLATE_SCHEMAS.coverage)
    expect(templateSchemaFor('answer_shape', null)).toBe(TEMPLATE_SCHEMAS.answer_shape)
    expect(templateSchemaFor('future_step', '{"type":"object","required":["title"]}')).toEqual({
      type: 'object',
      required: ['title']
    })
    expect(templateSchemaFor('future_step', null)).toBeNull()
    expect(templateSchemaFor('future_step', '{not json')).toBeNull()
    expect(templateSchemaFor('future_step', '[1,2]')).toBeNull()
    expect(templateSchemaFor('future_step', '"text"')).toBeNull()
  })
})
