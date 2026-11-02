import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { DEFAULT_TEMPLATE_SETTINGS } from '@shared/domain'
import { cleanupHarness, harness } from '../handlers/test-harness'
import { parseTemplateVersions } from '../ipc-ai'
import {
  createGenerationTemplate,
  deleteGenerationTemplate,
  restoreGenerationTemplate,
  seedShippedTemplates,
  shippedBody,
  templateHash,
  updateGenerationTemplate
} from '../pipeline/templates'
import { openAppDatabase } from './app-database'
import { closeDatabase, type SqliteDatabase } from './database'
import { listTemplateVersions } from './template-records'

const NOW = '2026-10-19T12:00:00.000Z'
const LATER = '2026-10-19T13:00:00.000Z'

const databases: SqliteDatabase[] = []
const directories: string[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  cleanupHarness()
})

function appDb(): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-template-versions-'))
  directories.push(directory)
  const db = openAppDatabase(join(directory, 'app.sqlite'))
  databases.push(db)
  return db
}

describe('template_versions', () => {
  test('create records v1 and each update records the next version', () => {
    const db = appDb()
    const created = createGenerationTemplate(
      db,
      { kind: 'coverage', name: 'Mine', body: 'First {{ url }}' },
      { id: 'tpl-mine', now: NOW }
    )
    expect(listTemplateVersions(db, created.id)).toEqual([
      {
        templateId: 'tpl-mine',
        version: 1,
        hash: templateHash('First {{ url }}'),
        body: 'First {{ url }}',
        settingsJson: null,
        savedAt: NOW
      }
    ])
    updateGenerationTemplate(db, { id: created.id, body: 'Second {{ title }}' }, LATER)
    const versions = listTemplateVersions(db, created.id)
    expect(versions.map((item) => [item.version, item.body, item.savedAt])).toEqual([
      [2, 'Second {{ title }}', LATER],
      [1, 'First {{ url }}', NOW]
    ])
    expect(versions[0]?.hash).toBe(templateHash('Second {{ title }}'))
  })

  test('a settings change is stored on its version', () => {
    const db = appDb()
    createGenerationTemplate(
      db,
      { kind: 'aio_gap', name: 'Gap', body: 'Gap {{ page.url }}' },
      { id: 'tpl-gap', now: NOW }
    )
    updateGenerationTemplate(
      db,
      { id: 'tpl-gap', settings: { ...DEFAULT_TEMPLATE_SETTINGS, language: 'fr' } },
      LATER
    )
    const [latest] = listTemplateVersions(db, 'tpl-gap')
    expect(latest?.version).toBe(2)
    expect(JSON.parse(latest?.settingsJson ?? '{}')).toMatchObject({ language: 'fr' })
  })

  test('delete and restore keep the version and add no row', () => {
    const db = appDb()
    createGenerationTemplate(
      db,
      { kind: 'coverage', name: 'Mine', body: 'Body' },
      { id: 'tpl-mine', now: NOW }
    )
    deleteGenerationTemplate(db, 'tpl-mine', LATER)
    restoreGenerationTemplate(db, 'tpl-mine')
    expect(listTemplateVersions(db, 'tpl-mine').map((item) => item.version)).toEqual([1])
  })

  test('a new shipped body on upgrade is recorded as the next version', () => {
    const db = appDb()
    seedShippedTemplates(db, () => NOW)
    expect(listTemplateVersions(db, 'tpl-coverage').map((item) => item.version)).toEqual([1])
    // Simulate a file from an older build whose shipped body differs.
    db.prepare(`UPDATE templates SET body = ?, hash = ? WHERE id = 'tpl-coverage'`).run(
      'Old shipped body',
      templateHash('Old shipped body')
    )
    seedShippedTemplates(db, () => LATER)
    const versions = listTemplateVersions(db, 'tpl-coverage')
    expect(versions.map((item) => [item.version, item.savedAt])).toEqual([
      [2, LATER],
      [1, NOW]
    ])
    expect(versions[0]?.body).toBe(shippedBody('coverage'))
    // Seeding again with no change adds nothing.
    seedShippedTemplates(db, () => LATER)
    expect(listTemplateVersions(db, 'tpl-coverage')).toHaveLength(2)
  })
})

describe('templates:versions', () => {
  test('lists an app template and a project step, newest first, with the current one', async () => {
    const { handlers } = harness()
    const created = await handlers['templates:create']({
      kind: 'buyer_profile',
      name: 'Mine',
      body: 'One {{ url }}'
    })
    await handlers['templates:update']({ id: created.id, body: 'Two {{ url }}' })
    const appVersions = await handlers['templates:versions']({ id: created.id })
    expect(appVersions.map((item) => [item.version, item.source, item.current])).toEqual([
      [2, 'app', true],
      [1, 'app', false]
    ])
    expect(appVersions[0]?.hash).toBe(templateHash('Two {{ url }}'))

    const project = await handlers['projects:create']({
      name: 'TextBolt',
      domain: 'textbolt.com',
      includeSubdomains: true,
      brandNames: ['TextBolt'],
      competitors: [],
      clientName: null,
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop'
    })
    expect(
      await handlers['templates:versions']({ projectId: project.id, kind: 'aio_gap' })
    ).toEqual([])
    for (const body of ['Gap one {{ page.url }}', 'Gap two {{ page.url }}']) {
      await handlers['templates:saveOverride']({
        projectId: project.id,
        kind: 'aio_gap',
        body,
        settings: DEFAULT_TEMPLATE_SETTINGS
      })
    }
    const stepVersions = await handlers['templates:versions']({
      projectId: project.id,
      kind: 'aio_gap'
    })
    expect(stepVersions.map((item) => [item.version, item.source, item.current])).toEqual([
      [2, 'project', true],
      [1, 'project', false]
    ])
    expect(stepVersions[1]?.hash).toBe(templateHash('Gap one {{ page.url }}'))

    await handlers['templates:resetOverride']({ projectId: project.id, kind: 'aio_gap' })
    const afterReset = await handlers['templates:versions']({
      projectId: project.id,
      kind: 'aio_gap'
    })
    expect(afterReset.map((item) => item.current)).toEqual([false, false])

    await expect(handlers['templates:versions']({ id: 'tpl-missing' })).rejects.toThrow(
      /templates:versions/
    )
  })

  test('the parser takes an id alone or a project with a kind', () => {
    expect(parseTemplateVersions({ id: 'tpl-1' })).toEqual({ id: 'tpl-1' })
    expect(parseTemplateVersions({ projectId: 'proj-1', kind: 'coverage' })).toEqual({
      projectId: 'proj-1',
      kind: 'coverage'
    })
    for (const bad of [
      {},
      { id: 'tpl-1', projectId: 'proj-1' },
      { id: 'tpl-1', kind: 'coverage' },
      { id: 'tpl-1', projectId: 'proj-1', kind: 'coverage' },
      { projectId: 'proj-1' },
      { kind: 'coverage' },
      { projectId: 'proj-1', kind: 'nope' }
    ]) {
      expect(() => parseTemplateVersions(bad)).toThrow(/templates:versions/)
    }
  })
})
