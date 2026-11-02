import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { SHIPPED_TEMPLATE_NAME, type BuyerProfile } from '@shared/domain'
import { openAppDatabase } from '../storage/app-database'
import { APP_MIGRATIONS } from '../storage/app-schema'
import {
  insertBuyerProfile,
  insertCoverage,
  insertGeneration,
  insertPromptSet,
  insertSnapshot
} from '../storage/content-records'
import { closeDatabase, type SqliteDatabase } from '../storage/database'
import { insertPage } from '../storage/pages'
import { createProjectDatabase } from '../storage/project-files'
import { ensureProjectSchema, writeProjectProfile } from '../storage/project-profile'
import { getTemplate, insertProject, insertTemplate } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { PipelineError } from './errors'
import {
  COVERAGE_RUBRIC,
  DATA_FENCE_RULE,
  FIX_DRAFT_RULES,
  JSON_ONLY_RULE
} from '../prompts/blocks'
import {
  BUYER_PROFILE_TEMPLATE,
  BUYER_PROMPTS_TEMPLATE,
  COVERAGE_FIXES_TEMPLATE,
  COVERAGE_MATRIX_TEMPLATE,
  COVERAGE_TEMPLATE,
  PAGE_AUDIT_TEMPLATE
} from './template-bodies'
import {
  TemplateContractError,
  createGenerationTemplate,
  deleteGenerationTemplate,
  getGenerationTemplate,
  listGenerationTemplates,
  loadGenerationTemplate,
  readTemplateUsage,
  renderTemplate,
  resetGenerationTemplate,
  restoreGenerationTemplate,
  seedShippedTemplates,
  selectPlaygroundTemplates,
  setDefaultGenerationTemplate,
  templateHash,
  updateGenerationTemplate
} from './templates'

const databases: SqliteDatabase[] = []
const directories: string[] = []
const NOW = '2026-10-19T12:00:00.000Z'

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('shipped templates', () => {
  const STEP_BODIES = {
    BUYER_PROFILE_TEMPLATE,
    BUYER_PROMPTS_TEMPLATE,
    COVERAGE_MATRIX_TEMPLATE,
    PAGE_AUDIT_TEMPLATE,
    COVERAGE_FIXES_TEMPLATE
  }

  test('every page step names its kind on the first line and reads only shared names', () => {
    for (const [name, body] of Object.entries(STEP_BODIES)) {
      const kind = /^Template: ([a-z_]+)\.md$/u.exec(body.split('\n')[0] ?? '')?.[1]
      expect(kind, name).toBeDefined()
      expect(body.includes('{%'), name).toBe(false)
      expect(body.includes('page.url'), name).toBe(false)
      expect(body.includes('brand_names'), name).toBe(false)
      expect(body.includes('{{ brand_name }}'), name).toBe(false)
      expect(renderTemplate(body, {}, kind).warnings, name).toEqual([])
    }
    expect(BUYER_PROFILE_TEMPLATE.startsWith('Template: buyer_profile.md\n')).toBe(true)
    expect(BUYER_PROMPTS_TEMPLATE.startsWith('Template: buyer_prompts.md\n')).toBe(true)
    expect(COVERAGE_MATRIX_TEMPLATE.startsWith('Template: coverage_matrix.md\n')).toBe(true)
    expect(PAGE_AUDIT_TEMPLATE.startsWith('Template: page_audit.md\n')).toBe(true)
    expect(COVERAGE_FIXES_TEMPLATE.startsWith('Template: coverage_fixes.md\n')).toBe(true)
    expect(BUYER_PROMPTS_TEMPLATE).toContain('{{ prompt_count }}')
  })

  test('each step reads the context blocks it needs, and the page fenced as data', () => {
    for (const block of ['business_block', 'product_block', 'market_block']) {
      expect(BUYER_PROFILE_TEMPLATE).toContain(`{{ ${block} }}`)
      expect(BUYER_PROMPTS_TEMPLATE).toContain(`{{ ${block} }}`)
    }
    expect(BUYER_PROMPTS_TEMPLATE).toContain('{{ competitor_block }}')
    expect(BUYER_PROFILE_TEMPLATE.includes('{{ competitor_block }}')).toBe(false)
    expect(PAGE_AUDIT_TEMPLATE).toContain('{{ market_block }}')
    expect(COVERAGE_FIXES_TEMPLATE).toContain('{{ business_block }}')
    expect(COVERAGE_FIXES_TEMPLATE).toContain('{{ market_block }}')
    for (const body of [
      BUYER_PROFILE_TEMPLATE,
      BUYER_PROMPTS_TEMPLATE,
      COVERAGE_MATRIX_TEMPLATE,
      PAGE_AUDIT_TEMPLATE
    ]) {
      expect(body).toContain('<page_text>\nURL: {{ url }}\nLast modified: {{ last_modified }}')
      for (const name of ['title', 'meta_description', 'h1', 'outline', 'faqs', 'page_text']) {
        expect(body).toContain(`{{ ${name} }}`)
      }
      expect(body).toContain(`</page_text>\n${DATA_FENCE_RULE}`)
      expect(body.includes('Google:')).toBe(false)
    }
    // The fixes step reads only the headings; the sections it needs follow, fenced, from code.
    expect(COVERAGE_FIXES_TEMPLATE.includes('{{ page_text }}')).toBe(false)
    expect(COVERAGE_FIXES_TEMPLATE).toContain(`</page_text>\n${DATA_FENCE_RULE}`)
    for (const body of Object.values(STEP_BODIES)) expect(body).toContain(JSON_ONLY_RULE)
  })

  test('the buyer profile asks for a concrete six-part profile', () => {
    expect(BUYER_PROFILE_TEMPLATE).toContain('Write six parts')
    for (const phrase of [
      'company size',
      "never a plan's seat, user or licence limit",
      'Region comes from the market',
      'developers',
      'named tools and systems',
      'including price',
      'never a product or brand name',
      'poor fit'
    ]) {
      expect(BUYER_PROFILE_TEMPLATE).toContain(phrase)
    }
  })

  test('the shipped method templates prime no niche: no example from one product page', () => {
    // TextBolt specifics (live run) belong in fixtures and tests, not in the defaults.
    const niche = [
      'Gmail',
      'Outlook',
      'Datadog',
      'Grafana',
      'txt.att.net',
      'vtext',
      '10DLC',
      'Twilio',
      'PagerDuty',
      'carrier',
      'text alert',
      'TextBolt'
    ]
    for (const [name, body] of Object.entries(STEP_BODIES)) {
      for (const word of niche) expect(body.includes(word), `${name}: ${word}`).toBe(false)
    }
  })

  test('the buyer prompts ask for first-person situations and comparisons with listed competitors', () => {
    expect(BUYER_PROMPTS_TEMPLATE).toContain('You are writing buyer prompts')
    expect(BUYER_PROMPTS_TEMPLATE).toContain('one buyer in one situation, in the first person')
    expect(BUYER_PROMPTS_TEMPLATE).toContain('Never a short keyword search')
    expect(BUYER_PROMPTS_TEMPLATE).toContain('before they have seen this page')
    expect(BUYER_PROMPTS_TEMPLATE).toContain("Never reuse the page's own scenarios")
    expect(BUYER_PROMPTS_TEMPLATE).toContain('never more than 32')
    for (const stage of ['problem', 'solution', 'comparison', 'objection', 'trigger']) {
      expect(BUYER_PROMPTS_TEMPLATE).toContain(`- ${stage}: `)
    }
    expect(BUYER_PROMPTS_TEMPLATE).toContain(
      'name one or two direct or partial competitors from the list above'
    )
    expect(BUYER_PROMPTS_TEMPLATE).toContain('Never a switch-from option or a tool used with it')
    expect(BUYER_PROMPTS_TEMPLATE).toContain('at least one comparison prompt names one of them')
    expect(BUYER_PROMPTS_TEMPLATE).toContain('title_meta_h1, trigger_event, and objection')
    for (const banned of [
      '3–8 words',
      'no first person',
      'Never more than 12 words',
      "'best X for Y'"
    ]) {
      expect(BUYER_PROMPTS_TEMPLATE.includes(banned)).toBe(false)
    }
    const rendered = renderTemplate(
      BUYER_PROMPTS_TEMPLATE,
      {
        url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
        title: 'How to Set Up Text Alerts',
        meta_description: 'Turn emails into texts',
        h1: 'How to Set Up Text Alerts',
        page_text: 'The page body.',
        prompt_count: 10,
        outline: 'H2: Steps',
        faqs: 'No FAQs on the page.',
        last_modified: '2026-10-16',
        business_block: 'Business: textbolt.com. Brand names to leave out: TextBolt, Text Bolt.',
        product_block: 'Product: not saved yet.',
        market_block: 'Market: United States, English.',
        competitor_block: 'Direct competitors: ClickSend.'
      },
      'buyer_prompts'
    )
    // Read with the default kind, the competitor block is not one of its names.
    expect(renderTemplate(BUYER_PROMPTS_TEMPLATE, {}).warnings.map((w) => w.name)).toEqual([
      'competitor_block'
    ])
    expect(rendered.warnings).toEqual([])
    expect(rendered.text).toContain('Write exactly 10 prompts, no more and no fewer.')
    expect(rendered.text).toContain('Brand names to leave out: TextBolt, Text Bolt.')
    expect(rendered.text).toContain('Direct competitors: ClickSend.')
    expect(rendered.text).toContain('Last modified: 2026-10-16')
    expect(rendered.text).toContain('Outline:\nH2: Steps')
    expect(rendered.text).toContain('The page body.')
  })

  test('the gap steps split rating, proofreading and fixes into one job each', () => {
    expect(COVERAGE_MATRIX_TEMPLATE).toContain(COVERAGE_RUBRIC)
    for (const field of ['whereCovered', 'mainGap', 'priority', 'actions']) {
      expect(COVERAGE_MATRIX_TEMPLATE).toContain(`- ${field}: `)
    }
    expect(COVERAGE_MATRIX_TEMPLATE).toContain('A strong row uses small_update or none.')
    for (const leaked of ['suggestedFaq', 'currentContent', 'factual_claim']) {
      expect(COVERAGE_MATRIX_TEMPLATE.includes(leaked), leaked).toBe(false)
    }

    for (const type of [
      'title_meta_mismatch',
      'factual_claim',
      'missing_promised_section',
      'typo',
      'other'
    ]) {
      expect(PAGE_AUDIT_TEMPLATE).toContain(`- ${type}: `)
    }
    expect(PAGE_AUDIT_TEMPLATE).toContain('Do not report length.')
    expect(PAGE_AUDIT_TEMPLATE).toContain('An empty list is the right answer for a clean page')
    expect(PAGE_AUDIT_TEMPLATE.includes('title_length')).toBe(false)

    for (const field of ['currentContent', 'whatToUpdate', 'suggestedFaq']) {
      expect(COVERAGE_FIXES_TEMPLATE).toContain(`- ${field}: `)
    }
    expect(COVERAGE_FIXES_TEMPLATE).toContain(FIX_DRAFT_RULES)
    expect(COVERAGE_FIXES_TEMPLATE).toContain('never repeat the wrong one')
  })

  test('the retired combined coverage body stays readable as shipped', () => {
    expect(COVERAGE_TEMPLATE).toContain('coverage matrix')
    expect(COVERAGE_TEMPLATE).toContain('{{ brand_name }}')
    expect(renderTemplate(COVERAGE_TEMPLATE, {}).warnings).toEqual([])
  })

  test('warns on an unknown variable and rejects a syntax error without echoing the body', () => {
    const rendered = renderTemplate('Read {{ missing_name }} and {{ url }}', {
      url: 'https://example.com'
    })
    expect(rendered.warnings.map((warning) => warning.name)).toEqual(['missing_name'])
    expect(rendered.text).toContain('https://example.com')
    expect(rendered.text.includes('missing_name')).toBe(false)

    const secretBody = '{% if %} sk-ant-api03-abcdefghij'
    expect(() => renderTemplate(secretBody, { url: 'https://example.com' })).toThrow(PipelineError)
    try {
      renderTemplate(secretBody, { url: 'https://example.com' })
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineError)
      expect((error as PipelineError).code).toBe('template')
      expect((error as PipelineError).message).toBe('The template has a syntax error.')
      expect((error as PipelineError).message.includes('sk-ant')).toBe(false)
      expect((error as PipelineError).message.includes(secretBody)).toBe(false)
    }
  })

  test('never evaluates code a user writes into a template', () => {
    const globals = globalThis as { citefoxTemplatePwned?: unknown }
    delete globals.citefoxTemplatePwned
    const context = { url: 'https://example.com', page_text: 'body' }
    for (const body of [
      "{{ constructor.constructor('return process')() }}",
      "{{ constructor.constructor('globalThis.citefoxTemplatePwned = 1')() }}",
      "{{ range.constructor('globalThis.citefoxTemplatePwned = 1')() }}",
      "{{ cycler.constructor('globalThis.citefoxTemplatePwned = 1')() }}",
      "{% set x = range.constructor('globalThis.citefoxTemplatePwned = 1')() %}{{ x }}"
    ]) {
      expect(() => renderTemplate(body, context)).toThrow('The template has a syntax error.')
    }
    expect(globals.citefoxTemplatePwned).toBeUndefined()

    const rendered = renderTemplate(
      '[{{ constructor }}][{{ url.constructor }}][{{ __proto__ }}][{{ toString }}]',
      context
    )
    expect(rendered.text).toBe('[][][][]')
    expect(rendered.warnings.map((warning) => warning.name)).toEqual([
      'constructor',
      'url.constructor',
      '__proto__',
      'toString'
    ])

    const db = openAppDatabase(':memory:')
    databases.push(db)
    const error = capture(() =>
      createGenerationTemplate(
        db,
        {
          kind: 'buyer_profile',
          name: 'Hostile',
          body: "{{ constructor.constructor('globalThis.citefoxTemplatePwned = 1')() }}"
        },
        { id: 'tpl-hostile', now: NOW }
      )
    )
    expect(error).toMatchObject({ code: 'syntax', channel: 'templates:create' })
    expect(globals.citefoxTemplatePwned).toBeUndefined()
  })

  test('lists a stored legacy template that uses tags without throwing', () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    seedShippedTemplates(db, () => NOW)
    insertTemplate(db, {
      id: 'tpl-legacy',
      name: 'Legacy',
      version: 1,
      hash: templateHash('{% if url %}{{ url }}{% endif %} {{ title }}'),
      body: '{% if url %}{{ url }}{% endif %} {{ title }}',
      schema: null,
      settingsJson: null,
      kind: 'buyer_profile',
      notes: null,
      isShipped: false,
      isDefault: false,
      createdAt: NOW,
      updatedAt: null,
      deletedAt: null
    })
    const legacy = getGenerationTemplate(db, 'tpl-legacy')
    expect(legacy?.variables).toEqual(['url', 'title'])
    expect(() => renderTemplate(legacy?.body ?? '', { url: 'u' })).toThrow(PipelineError)
  })

  test('seeds version 1 without a new app migration, and a second seed is a no-op', () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    const first = seedShippedTemplates(db)
    expect(first.map((template) => template.updatedAt)).toEqual(first.map(() => null))
    expect(first.every((template) => template.isDefault)).toBe(true)
    const stored = db
      .prepare<unknown[], { version: number }>('SELECT version FROM templates ORDER BY id')
      .all()
    expect(stored.map((row) => row.version)).toEqual(first.map(() => 1))
    const profile = loadGenerationTemplate(db, 'buyer_profile')
    expect(profile.id).toBe('tpl-buyer-profile')
    expect(profile.name).toBe(SHIPPED_TEMPLATE_NAME)
    expect(profile.isShipped).toBe(true)
    expect(profile.notes).toBeNull()
    expect(profile.deletedAt).toBeNull()
    expect(profile.templateHash).toMatch(/^[a-f0-9]{64}$/)
    expect(templateHash(profile.body)).toMatch(/^[a-f0-9]{64}$/)
    const second = seedShippedTemplates(db)
    expect(second.map((template) => template.id)).toEqual(first.map((template) => template.id))
    const versions = db
      .prepare<unknown[], { version: number }>(
        'SELECT version FROM schema_migrations ORDER BY version'
      )
      .all()
      .map((row) => row.version)
    expect(versions).toEqual(APP_MIGRATIONS.map((migration) => migration.version))
  })

  test('replaces a shipped body in place and leaves a user copy alone', () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    seedShippedTemplates(db, () => NOW)
    const copy = createGenerationTemplate(
      db,
      { kind: 'buyer_profile', name: 'My profile', fromId: 'tpl-buyer-profile' },
      { id: 'tpl-copy', now: NOW }
    )
    db.prepare(`UPDATE templates SET body = ?, hash = ? WHERE id = ?`).run(
      `${copy.body}\nEdited by the user.`,
      'f'.repeat(64),
      copy.id
    )
    db.prepare(`UPDATE templates SET body = ?, hash = ? WHERE id = 'tpl-buyer-profile'`).run(
      'stale shipped body',
      'e'.repeat(64)
    )
    const seeded = seedShippedTemplates(db, () => '2026-10-19T13:00:00.000Z')
    const shipped = seeded.find((template) => template.id === 'tpl-buyer-profile')
    expect(shipped?.body).toBe(BUYER_PROFILE_TEMPLATE)
    expect(shipped?.updatedAt).toBe('2026-10-19T13:00:00.000Z')
    expect(shipped?.isDefault).toBe(true)
    const storedCopy = db
      .prepare<unknown[], { body: string; is_default: number }>(
        `SELECT body, is_default FROM templates WHERE id = 'tpl-copy'`
      )
      .get()
    expect(storedCopy?.body).toBe(`${copy.body}\nEdited by the user.`)
    expect(storedCopy?.is_default).toBe(0)
  })

  test('an install seeded with the short-query prompts gets the method back as its default', () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    seedShippedTemplates(db, () => NOW)
    const shortBody =
      'You are writing buyer prompts from the live page.\nWrite each buyer prompt exactly as a person would type it into Google: 3–8 words, lowercase is fine, no first person, no backstory, no brand name. Never more than 12 words.\n{{ page_text }}\nWrite {{ prompt_count }} prompts.'
    db.prepare(
      `UPDATE templates SET body = ?, hash = ?, version = 3 WHERE id = 'tpl-buyer-prompts'`
    ).run(shortBody, templateHash(shortBody))
    seedShippedTemplates(db, () => '2026-10-20T12:00:00.000Z')
    const shipped = loadGenerationTemplate(db, 'buyer_prompts')
    expect(shipped.id).toBe('tpl-buyer-prompts')
    expect(shipped.body).toBe(BUYER_PROMPTS_TEMPLATE)
    expect(shipped.templateHash).toBe(templateHash(BUYER_PROMPTS_TEMPLATE))
    expect(shipped.version).toBe(4)
    expect(shipped.updatedAt).toBe('2026-10-20T12:00:00.000Z')
    expect(shipped.isDefault).toBe(true)

    const custom = createGenerationTemplate(
      db,
      { kind: 'buyer_prompts', name: 'My prompts', body: shortBody },
      { id: 'tpl-mine', now: NOW }
    )
    setDefaultGenerationTemplate(db, custom.id)
    db.prepare(`UPDATE templates SET body = ?, hash = ? WHERE id = 'tpl-buyer-prompts'`).run(
      shortBody,
      templateHash(shortBody)
    )
    seedShippedTemplates(db, () => '2026-10-21T12:00:00.000Z')
    expect(loadGenerationTemplate(db, 'buyer_prompts').id).toBe('tpl-mine')
    expect(getGenerationTemplate(db, 'tpl-mine')?.body).toBe(shortBody)
    expect(getGenerationTemplate(db, 'tpl-buyer-prompts')?.body).toBe(BUYER_PROMPTS_TEMPLATE)
  })

  test('reseeding the buyer-prompt default does not rewrite a user template', () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    seedShippedTemplates(db, () => NOW)
    const copy = createGenerationTemplate(
      db,
      {
        kind: 'buyer_prompts',
        name: 'My prompts',
        body: 'Write {{ prompt_count }} long questions about {{ brand_name }}.'
      },
      { id: 'tpl-user-prompts', now: NOW }
    )
    db.prepare(`UPDATE templates SET body = ?, hash = ? WHERE id = 'tpl-buyer-prompts'`).run(
      'stale shipped prompts',
      'd'.repeat(64)
    )
    const versionsBefore = migrationVersions(db)
    seedShippedTemplates(db, () => '2026-10-20T12:00:00.000Z')
    expect(getGenerationTemplate(db, 'tpl-buyer-prompts')?.body).toBe(BUYER_PROMPTS_TEMPLATE)
    const user = getGenerationTemplate(db, 'tpl-user-prompts')
    expect(user?.body).toBe(copy.body)
    expect(user?.isShipped).toBe(false)
    expect(user?.updatedAt).toBeNull()
    expect(migrationVersions(db)).toEqual(versionsBefore)
  })

  test('enforces shipped, default, delete, restore, and reset rules', () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    const shipped = loadGenerationTemplate(db, 'buyer_profile', undefined, 'templates:get')
    expect(() => updateGenerationTemplate(db, { id: shipped.id, name: 'Renamed' }, NOW)).toThrow(
      TemplateContractError
    )
    expect(capture(() => deleteGenerationTemplate(db, shipped.id, NOW))).toMatchObject({
      code: 'shipped_readonly'
    })
    const copy = createGenerationTemplate(
      db,
      { kind: 'buyer_profile', name: 'Field copy', body: 'Hello {{ url }} {{ missing_one }}' },
      { id: 'tpl-copy', now: NOW }
    )
    expect(copy.isShipped).toBe(false)
    expect(copy.isDefault).toBe(false)
    expect(copy.warnings.map((warning) => warning.name)).toEqual(['missing_one'])
    expect(copy.updatedAt).toBeNull()
    expect(
      capture(() =>
        createGenerationTemplate(
          db,
          { kind: 'buyer_profile', name: 'field copy', body: 'Other {{ url }}' },
          { id: 'tpl-copy-2', now: NOW }
        )
      )
    ).toMatchObject({ code: 'name_taken' })
    expect(
      capture(() =>
        createGenerationTemplate(
          db,
          { kind: 'buyer_profile', name: 'Both', body: 'x', fromId: shipped.id },
          { id: 'tpl-both', now: NOW }
        )
      )
    ).toMatchObject({ code: 'body_or_source' })
    expect(
      capture(() =>
        createGenerationTemplate(
          db,
          { kind: 'buyer_profile', name: '' },
          { id: 'tpl-empty', now: NOW }
        )
      )
    ).toMatchObject({ code: 'name_length' })
    expect(
      capture(() =>
        createGenerationTemplate(
          db,
          { kind: 'buyer_profile', name: 'Neither' },
          { id: 'tpl-neither', now: NOW }
        )
      )
    ).toMatchObject({ code: 'body_or_source' })
    expect(
      capture(() => updateGenerationTemplate(db, { id: copy.id, name: 'x'.repeat(81) }, NOW))
    ).toMatchObject({ code: 'name_length' })
    expect(
      capture(() => updateGenerationTemplate(db, { id: copy.id, notes: 'n'.repeat(501) }, NOW))
    ).toMatchObject({ code: 'notes_length' })
    expect(
      capture(() => updateGenerationTemplate(db, { id: copy.id, body: '{% if %}' }, NOW))
    ).toMatchObject({
      code: 'syntax'
    })
    try {
      updateGenerationTemplate(db, { id: copy.id, body: '{% if %} sk-ant-api03-secret' }, NOW)
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateContractError)
      expect((error as Error).message.includes('sk-ant')).toBe(false)
      expect((error as Error).message.includes('{%')).toBe(false)
    }
    setDefaultGenerationTemplate(db, copy.id)
    expect(loadGenerationTemplate(db, 'buyer_profile', undefined, 'buyerProfile:generate').id).toBe(
      copy.id
    )
    expect(capture(() => deleteGenerationTemplate(db, copy.id, NOW))).toMatchObject({
      code: 'default_in_use'
    })
    setDefaultGenerationTemplate(db, shipped.id)
    const deleted = deleteGenerationTemplate(db, copy.id, '2026-10-19T15:00:00.000Z')
    expect(deleted.deletedAt).toBe('2026-10-19T15:00:00.000Z')
    expect(deleteGenerationTemplate(db, copy.id, NOW).deletedAt).toBe(deleted.deletedAt)
    expect(
      capture(() => loadGenerationTemplate(db, 'buyer_profile', copy.id, 'buyerProfile:generate'))
    ).toMatchObject({ code: 'deleted' })
    expect(
      capture(() => loadGenerationTemplate(db, 'buyer_prompts', shipped.id, 'prompts:generate'))
    ).toMatchObject({ code: 'kind_mismatch' })
    const taken = createGenerationTemplate(
      db,
      { kind: 'buyer_profile', name: 'Field copy', body: 'Hello {{ url }}' },
      { id: 'tpl-live', now: NOW }
    )
    expect(capture(() => restoreGenerationTemplate(db, copy.id))).toMatchObject({
      code: 'name_taken'
    })
    deleteGenerationTemplate(db, taken.id, NOW)
    const restored = restoreGenerationTemplate(db, copy.id)
    expect(restored.deletedAt).toBeNull()
    const before = listGenerationTemplates(db, {})
    const reset = resetGenerationTemplate(db, copy.id)
    expect(reset?.body).toBe(restored.body)
    expect(reset?.isDefault).toBe(false)
    expect(listGenerationTemplates(db, {}).map((template) => template.templateHash)).toEqual(
      before.map((template) => template.templateHash)
    )
    expect(resetGenerationTemplate(db, 'missing-id')).toBeNull()
    const listed = listGenerationTemplates(db, { kind: 'buyer_profile' })
    expect(listed[0]?.isShipped).toBe(true)
    expect(listed.some((template) => template.deletedAt !== null)).toBe(false)
    expect(
      listGenerationTemplates(db, { includeDeleted: true }).some(
        (template) => template.id === taken.id
      )
    ).toBe(true)
  })

  test('counts saved artifacts across two project databases and can filter by project', () => {
    const root = mkdtempSync(join(tmpdir(), 'citefox-usage-'))
    directories.push(root)
    const projects = join(root, 'projects')
    const app = openAppDatabase(join(root, 'app.sqlite'))
    databases.push(app)
    insertProject(app, {
      id: 'proj-a',
      name: 'Alpha',
      slug: 'alpha',
      domain: 'alpha.example',
      dbPath: projectDatabaseRelativePath('alpha'),
      clientName: null,
      status: 'active'
    })
    insertProject(app, {
      id: 'proj-b',
      name: 'Beta',
      slug: 'beta',
      domain: 'beta.example',
      dbPath: projectDatabaseRelativePath('beta'),
      clientName: null,
      status: 'active'
    })
    const alpha = createProjectDatabase(projects, 'alpha')
    const beta = createProjectDatabase(projects, 'beta')
    databases.push(alpha, beta)
    seedProject(alpha, 'page-a', '2026-10-19T10:00:00.000Z')
    seedProject(beta, 'page-b', '2026-10-19T11:00:00.000Z')
    insertBuyerProfile(alpha, buyerProfile('icp-a2', 'page-a', '2026-10-19T16:00:00.000Z'))
    insertGeneration(
      alpha,
      {
        id: 'gen-1',
        pageId: 'page-a',
        kind: 'buyer_profile',
        templateId: 'tpl-buyer-profile',
        templateHash: 'a'.repeat(64),
        startedAt: '2026-10-19T18:00:00.000Z',
        durationMs: 1,
        model: null,
        connection: 'claude-code',
        ok: false,
        error: null,
        inputHash: 'b'.repeat(64),
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          serpapiSearches: 0
        }
      },
      null
    )
    const all = readTemplateUsage(app, projects, { id: 'tpl-buyer-profile' })
    expect(all).toEqual({
      templateId: 'tpl-buyer-profile',
      buyerProfiles: 3,
      promptSets: 2,
      coverageMatrices: 2,
      lastUsedAt: '2026-10-19T16:00:00.000Z'
    })
    expect(
      readTemplateUsage(app, projects, { id: 'tpl-buyer-profile', projectId: 'proj-b' })
    ).toEqual({
      templateId: 'tpl-buyer-profile',
      buyerProfiles: 1,
      promptSets: 1,
      coverageMatrices: 1,
      lastUsedAt: '2026-10-19T11:00:00.000Z'
    })
    expect(
      readTemplateUsage(app, projects, { id: 'tpl-buyer-profile', projectId: 'missing' })
    ).toEqual({
      templateId: 'tpl-buyer-profile',
      buyerProfiles: 0,
      promptSets: 0,
      coverageMatrices: 0,
      lastUsedAt: null
    })
    expect(
      listGenerationTemplates(app, {}).every((template) => !('buyerProfiles' in template))
    ).toBe(true)
  })

  test('update bumps version and keeps schema and settings; delete and restore do not', () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    seedShippedTemplates(db, () => NOW)
    insertTemplate(db, {
      id: 'tpl-keep',
      name: 'Keep me',
      version: 4,
      hash: templateHash('Hello {{ url }}'),
      body: 'Hello {{ url }}',
      schema: '{"type":"object"}',
      settingsJson: '{"voice":"plain"}',
      kind: 'buyer_profile',
      notes: null,
      isShipped: false,
      isDefault: false,
      createdAt: NOW,
      updatedAt: null,
      deletedAt: null
    })
    const updatedResult = updateGenerationTemplate(
      db,
      { id: 'tpl-keep', name: '  Kept  ' },
      '2026-10-19T13:00:00.000Z'
    )
    expect(updatedResult.template.version).toBe(5)
    const updated = getTemplate(db, 'tpl-keep')
    expect(updated).toMatchObject({
      name: 'Kept',
      version: 5,
      schema: '{"type":"object"}',
      settingsJson: '{"voice":"plain"}'
    })
    const deleted = deleteGenerationTemplate(db, 'tpl-keep', '2026-10-19T14:00:00.000Z')
    expect(deleted.version).toBe(5)
    expect(getTemplate(db, 'tpl-keep')).toMatchObject({
      version: 5,
      deletedAt: '2026-10-19T14:00:00.000Z',
      schema: '{"type":"object"}',
      settingsJson: '{"voice":"plain"}'
    })
    const restored = restoreGenerationTemplate(db, 'tpl-keep')
    expect(restored.version).toBe(5)
    expect(getTemplate(db, 'tpl-keep')).toMatchObject({
      version: 5,
      deletedAt: null,
      schema: '{"type":"object"}',
      settingsJson: '{"voice":"plain"}'
    })
    expect(getGenerationTemplate(db, 'tpl-keep')?.version).toBe(5)
    expect(
      listGenerationTemplates(db, { includeDeleted: true }).find(
        (template) => template.id === 'tpl-keep'
      )?.version
    ).toBe(5)
    const duplicate = createGenerationTemplate(
      db,
      { kind: 'buyer_profile', name: 'Copy of kept', fromId: 'tpl-keep' },
      { id: 'tpl-copy', now: '2026-10-19T15:00:00.000Z' }
    )
    expect(duplicate.version).toBe(1)
    expect(
      listGenerationTemplates(db, {}).find((template) => template.id === 'tpl-copy')?.version
    ).toBe(1)
  })

  test('trims a template name and returns name_length for a blank or oversized name', () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    seedShippedTemplates(db, () => NOW)
    expect(
      capture(() =>
        createGenerationTemplate(
          db,
          { kind: 'buyer_profile', name: '   ', body: 'Hello {{ url }}' },
          { id: 'tpl-blank', now: NOW }
        )
      )
    ).toMatchObject({ code: 'name_length' })
    expect(
      capture(() =>
        createGenerationTemplate(
          db,
          { kind: 'buyer_profile', name: `  ${'n'.repeat(81)}  `, body: 'Hello {{ url }}' },
          { id: 'tpl-long', now: NOW }
        )
      )
    ).toMatchObject({ code: 'name_length' })
    const created = createGenerationTemplate(
      db,
      { kind: 'coverage', name: '  Short name  ', body: 'Hello {{ url }}' },
      { id: 'tpl-short', now: NOW }
    )
    expect(created.name).toBe('Short name')
  })

  test('treats an empty playground templateIds list as omitted', () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    const seeded = seedShippedTemplates(db, () => NOW)
    const profile = seeded.find((template) => template.kind === 'buyer_profile')
    if (profile === undefined) throw new Error('missing template')
    const byKind = selectPlaygroundTemplates(db, {
      url: 'https://example.com',
      templateIds: [],
      kind: 'buyer_prompts',
      overrides: null
    })
    expect(byKind.map((template) => template.id)).toEqual(['tpl-buyer-prompts'])
    const byId = selectPlaygroundTemplates(db, {
      url: 'https://example.com',
      templateId: profile.id,
      templateIds: [],
      overrides: null
    })
    expect(byId.map((template) => template.id)).toEqual([profile.id])
    expect(
      capture(() =>
        selectPlaygroundTemplates(db, {
          url: 'https://example.com',
          templateIds: [],
          overrides: null
        })
      )
    ).toMatchObject({ code: 'selection_required' })
  })
})

function migrationVersions(db: SqliteDatabase): number[] {
  return db
    .prepare<unknown[], { version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version'
    )
    .all()
    .map((row) => row.version)
}

function capture(run: () => unknown): unknown {
  try {
    run()
    return undefined
  } catch (error) {
    return error
  }
}

function seedProject(db: SqliteDatabase, pageId: string, at: string): void {
  ensureProjectSchema(db)
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: [],
    market: {
      id: 'mkt-us',
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    }
  })
  insertPage(db, {
    id: pageId,
    projectId: 'proj',
    url: 'https://example.com/page',
    title: null,
    label: null,
    folder: null,
    status: 'setting_up',
    setupStep: 'check',
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: 1
  })
  insertSnapshot(db, {
    id: `snap-${pageId}`,
    pageId,
    fetchedAt: at,
    method: 'direct',
    httpStatus: 200,
    durationMs: 1,
    title: 'Title',
    metaDescription: null,
    h1: 'Heading',
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    bodyText: 'Body',
    wordCount: 1,
    contentHash: 'c'.repeat(64),
    summary: null
  })
  insertBuyerProfile(db, buyerProfile(`icp-${pageId}`, pageId, at))
  insertPromptSet(
    db,
    {
      id: `pset-${pageId}`,
      pageId,
      version: 1,
      savedAt: at,
      icpId: `icp-${pageId}`,
      templateId: 'tpl-buyer-profile',
      templateName: 'CiteFox default',
      templateHash: 'a'.repeat(64),
      templateUpdatedAt: null,
      prompts: [
        {
          id: `prompt-${pageId}`,
          position: 1,
          label: 'Saturday',
          source: 'title_meta_h1',
          intentStage: 'problem',
          mappedElement: 'intro',
          enabled: true,
          variants: [
            {
              marketId: 'mkt-us',
              language: 'en',
              text: 'How do I alert the crew?',
              originalText: null
            }
          ]
        }
      ]
    },
    ['TextBolt']
  )
  insertCoverage(db, {
    runId: `run-${pageId}`,
    pageId,
    recordedAt: at,
    templateId: 'tpl-buyer-profile',
    templateName: 'CiteFox default',
    templateHash: 'a'.repeat(64),
    templateUpdatedAt: null,
    contentHash: 'c'.repeat(64),
    reused: false,
    stale: false,
    rows: [
      {
        id: `cov-${pageId}`,
        runId: `run-${pageId}`,
        pageId,
        promptId: `prompt-${pageId}`,
        coverage: 'partial',
        whereCovered: ['Heading'],
        currentContent: 'The page mentions the heading.',
        whatToUpdate: 'Say more.',
        mainGap: 'Thin.',
        priority: 'low',
        actions: ['update_existing'],
        suggestedFaq: null,
        done: false
      }
    ],
    findings: []
  })
}

function buyerProfile(id: string, pageId: string, createdAt: string): BuyerProfile {
  return {
    id,
    pageId,
    snapshotId: `snap-${pageId}`,
    who: 'Office managers.',
    environment: 'They send email.',
    segments: [{ name: 'Field', reason: 'Away from the desk.' }],
    triggers: ['A missed alert.'],
    values: ['Clear pricing.'],
    poorFit: [{ name: 'Marketers', reason: 'Not this page.' }],
    templateId: 'tpl-buyer-profile',
    templateName: 'CiteFox default',
    templateHash: 'a'.repeat(64),
    templateUpdatedAt: null,
    createdAt,
    promptsStale: false
  }
}
