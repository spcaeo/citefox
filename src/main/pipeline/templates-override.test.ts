import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { DEFAULT_TEMPLATE_SETTINGS } from '@shared/domain'
import { openAppDatabase } from '../storage/app-database'
import { closeDatabase, type SqliteDatabase } from '../storage/database'
import { createProjectDatabase } from '../storage/project-files'
import { getTemplate } from '../storage/records'
import { listTemplateVersions } from '../storage/template-records'
import { saveTemplateOverride } from './template-steps'
import {
  createGenerationTemplate,
  deleteGenerationTemplate,
  loadGenerationTemplate,
  resetTemplateToShipped,
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
  const directory = mkdtempSync(join(tmpdir(), 'citefox-override-'))
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

const OVERRIDE_BODY = 'Project profile for {{ url }} and {{ title }}'

describe('loadGenerationTemplate with project versions (FR-26.4, FR-26.8)', () => {
  test("resolves the project's current version, the app default without one, and an explicit id wins", () => {
    const app = appDb()
    const project = projectDb()
    expect(loadGenerationTemplate(app, 'buyer_profile', undefined, undefined, project).id).toBe(
      'tpl-buyer-profile'
    )
    saveTemplateOverride(
      app,
      project,
      {
        kind: 'buyer_profile',
        body: OVERRIDE_BODY,
        settings: { model: 'claude-opus-5-5', language: 'es', promptCount: 7, tone: 'plain' }
      },
      { id: 'ovr-abc', now: NOW }
    )
    const resolved = loadGenerationTemplate(app, 'buyer_profile', undefined, undefined, project)
    expect(resolved).toMatchObject({
      id: 'ovr-abc',
      kind: 'buyer_profile',
      name: "This project's version v1",
      body: OVERRIDE_BODY,
      templateHash: templateHash(OVERRIDE_BODY),
      isShipped: false,
      isDefault: false,
      version: 1,
      createdAt: NOW,
      variables: ['url', 'title'],
      warnings: [],
      // promptCount does not apply to the buyer profile.
      settings: { model: 'claude-opus-5-5', language: 'es', promptCount: null, tone: 'plain' }
    })
    expect(resolved.id.startsWith('ovr-')).toBe(true)

    // No project database: the app default.
    expect(loadGenerationTemplate(app, 'buyer_profile').id).toBe('tpl-buyer-profile')
    // Another kind in the same project is not overridden.
    expect(
      loadGenerationTemplate(app, 'coverage_matrix', undefined, 'gaps:generate', project).id
    ).toBe('tpl-coverage-matrix')

    const picked = createGenerationTemplate(
      app,
      { kind: 'buyer_profile', name: 'Picked', body: 'Picked {{ url }}' },
      { id: 'tpl-picked', now: NOW }
    )
    expect(
      loadGenerationTemplate(app, 'buyer_profile', picked.id, 'buyerProfile:generate', project).id
    ).toBe('tpl-picked')
    expect(
      loadGenerationTemplate(app, 'buyer_profile', 'tpl-buyer-profile', undefined, project).id
    ).toBe('tpl-buyer-profile')
  })

  test('an explicit id that is deleted or of another kind is a typed error', () => {
    const app = appDb()
    const project = projectDb()
    createGenerationTemplate(
      app,
      { kind: 'coverage_matrix', name: 'Gone', body: 'Gone {{ url }}' },
      { id: 'tpl-gone', now: NOW }
    )
    deleteGenerationTemplate(app, 'tpl-gone', LATER)
    expect(
      capture(() =>
        loadGenerationTemplate(app, 'coverage_matrix', 'tpl-gone', 'gaps:generate', project)
      )
    ).toMatchObject({ code: 'deleted', channel: 'gaps:generate' })
    expect(
      capture(() =>
        loadGenerationTemplate(app, 'buyer_profile', 'tpl-coverage-matrix', 'buyerProfile:generate')
      )
    ).toMatchObject({ code: 'kind_mismatch', channel: 'buyerProfile:generate' })
    expect(
      capture(() =>
        loadGenerationTemplate(app, 'buyer_profile', 'tpl-none', 'buyerProfile:generate')
      )
    ).toMatchObject({ code: 'not_found' })
  })
})

describe('template settings on app templates (FR-26.3)', () => {
  test('templates:update persists settings, drops ones that do not apply, and bumps the version', () => {
    const app = appDb()
    createGenerationTemplate(
      app,
      { kind: 'buyer_profile', name: 'Mine', body: 'Mine {{ url }}' },
      { id: 'tpl-mine', now: NOW }
    )
    const updated = updateGenerationTemplate(
      app,
      {
        id: 'tpl-mine',
        settings: {
          model: 'claude-haiku-5-5',
          language: 'fr',
          promptCount: 9,
          tone: 'search_short'
        }
      },
      LATER
    )
    expect(updated.template.version).toBe(2)
    expect(updated.template.updatedAt).toBe(LATER)
    expect(updated.template.settings).toEqual({
      model: 'claude-haiku-5-5',
      language: 'fr',
      promptCount: null,
      tone: null
    })
    const stored = getTemplate(app, 'tpl-mine')
    expect(JSON.parse(stored?.settingsJson ?? 'null')).toEqual({
      model: 'claude-haiku-5-5',
      language: 'fr',
      promptCount: null,
      tone: null
    })
    expect(stored?.body).toBe('Mine {{ url }}')

    const again = updateGenerationTemplate(
      app,
      {
        id: 'tpl-mine',
        settings: { model: 'claude-haiku-5-5', language: 'fr', promptCount: null, tone: null }
      },
      '2026-10-19T14:00:00.000Z'
    )
    expect(again.template.version).toBe(3)
    expect(again.template.updatedAt).toBe(LATER)
    expect(getTemplate(app, 'tpl-mine')?.settingsJson).toBe(stored?.settingsJson)

    // Omitting settings keeps them.
    const renamed = updateGenerationTemplate(app, { id: 'tpl-mine', name: 'Mine 2' }, LATER)
    expect(renamed.template.settings.model).toBe('claude-haiku-5-5')
  })

  test('the shipped template stays read-only for settings', () => {
    const app = appDb()
    loadGenerationTemplate(app, 'coverage_matrix')
    expect(
      capture(() =>
        updateGenerationTemplate(
          app,
          { id: 'tpl-coverage-matrix', settings: DEFAULT_TEMPLATE_SETTINGS },
          LATER
        )
      )
    ).toMatchObject({ code: 'shipped_readonly', channel: 'templates:update' })
  })
})

describe('resetTemplateToShipped (FR-26.5)', () => {
  test('copies the shipped body and settings into the next version', () => {
    const app = appDb()
    createGenerationTemplate(
      app,
      { kind: 'buyer_prompts', name: 'Edited', body: 'Edited {{ url }}' },
      { id: 'tpl-edit', now: NOW }
    )
    updateGenerationTemplate(
      app,
      {
        id: 'tpl-edit',
        settings: { model: 'claude-opus-5-5', language: 'es', promptCount: 5, tone: 'plain' }
      },
      NOW
    )
    const reset = resetTemplateToShipped(app, 'tpl-edit', LATER)
    const shipped = shippedBody('buyer_prompts') ?? ''
    expect(reset.template).toMatchObject({
      id: 'tpl-edit',
      name: 'Edited',
      body: shipped,
      templateHash: templateHash(shipped),
      version: 3,
      updatedAt: LATER,
      isShipped: false,
      settings: DEFAULT_TEMPLATE_SETTINGS
    })
    expect(reset.warnings).toEqual([])
    expect(reset.template.templateHash).toBe(getTemplate(app, 'tpl-buyer-prompts')?.hash)
    const versions = listTemplateVersions(app, 'tpl-edit')
    expect(versions.map((version) => version.version)).toEqual([3, 2, 1])
    expect(versions[0]?.hash).toBe(templateHash(shipped))
    expect(versions[0]?.savedAt).toBe(LATER)
    expect(versions[2]?.body).toBe('Edited {{ url }}')
  })

  test('rejects the shipped template, a deleted template, and an unknown id', () => {
    const app = appDb()
    loadGenerationTemplate(app, 'aio_gap')
    expect(capture(() => resetTemplateToShipped(app, 'tpl-aio-gap', LATER))).toMatchObject({
      code: 'shipped_readonly',
      channel: 'templates:resetToShipped'
    })
    createGenerationTemplate(
      app,
      { kind: 'aio_gap', name: 'Old gap', body: 'Old {{ page.url }}' },
      { id: 'tpl-old', now: NOW }
    )
    deleteGenerationTemplate(app, 'tpl-old', LATER)
    expect(capture(() => resetTemplateToShipped(app, 'tpl-old', LATER))).toMatchObject({
      code: 'deleted'
    })
    expect(capture(() => resetTemplateToShipped(app, 'tpl-nope', LATER))).toMatchObject({
      code: 'not_found'
    })
  })
})
