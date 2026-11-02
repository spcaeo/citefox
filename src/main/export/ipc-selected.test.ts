import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PageSummary } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { addPageMarket, insertPage } from '../storage/pages'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { configureExportSaveDialog, resetExportSaveDialog, resetWrittenExports } from './ipc'
import { cleanupExportSeeds, exportRequest, run, seed, tempDir } from './ipc-seed.test-helper'

/**
 * Export "Pages I pick", a group, a cluster, a topic or a saved view: the renderer
 * resolves the pick to page (and topic) ids and sends scope `selected`. The file
 * must hold exactly those pages and no others.
 */

afterEach(() => {
  resetExportSaveDialog()
  resetWrittenExports()
  cleanupExportSeeds()
})

interface JsonDocument {
  selection: { scope: string; pageIds: string[] }
  pages: { id: string; role: string }[]
}

describe('exports with picked pages', () => {
  test('a multi-page export previews and writes exactly the picked pages and topic', async () => {
    const seeded = seed([run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')])
    addPages(seeded.storage)
    const { handlers } = seeded
    const picked = ['page-1', 'page-3', 'topic-1']

    const preview = await handlers['exports:preview'](
      exportRequest({ scope: 'selected', pageIds: picked, format: 'json', csv: null })
    )
    expect(preview.blocked).toBe(false)
    expect(preview.pageCount).toBe(3)

    const saveDir = tempDir()
    configureExportSaveDialog(async (options) => ({
      canceled: false,
      filePath: join(saveDir, options.defaultPath)
    }))
    const written = await handlers['exports:start'](
      exportRequest({ scope: 'selected', pageIds: picked, format: 'json', csv: null })
    )
    expect(written).toMatchObject({ ok: true, format: 'json' })
    if (!written.ok) return
    const document = JSON.parse(readFileSync(written.filePath, 'utf8')) as JsonDocument
    expect(document.selection).toMatchObject({ scope: 'selected', pageIds: picked })
    const tracked = document.pages.filter((page) => page.role === 'tracked').map((page) => page.id)
    expect([...tracked].sort()).toEqual([...picked].sort())
    expect(tracked).not.toContain('page-2')
  })

  test('the whole project holds every page; an unknown pick is blocked', async () => {
    const seeded = seed([run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')])
    addPages(seeded.storage)
    const { handlers } = seeded
    const whole = await handlers['exports:preview'](
      exportRequest({ scope: 'project', pageIds: [], format: 'json', csv: null })
    )
    expect(whole.blocked).toBe(false)
    expect(whole.pageCount).toBe(4)

    const unknown = await handlers['exports:preview'](
      exportRequest({ scope: 'selected', pageIds: ['nope'], format: 'json', csv: null })
    )
    expect(unknown.blocked).toBe(true)
  })
})

function addPages(storage: ReturnType<typeof seed>['storage']): void {
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    for (const n of [2, 3]) {
      insertPage(db, pageRow(`page-${n}`, `https://textbolt.com/p${n}`, `Page ${n}`))
      addPageMarket(db, {
        pageId: `page-${n}`,
        marketId: 'mkt-us',
        addedAt: '2026-10-01T12:00:00.000Z',
        baselineRunId: null
      })
    }
    insertPage(db, { ...pageRow('topic-1', null, 'SMS alerts'), kind: 'topic' })
  } finally {
    closeProjectDatabase(db)
  }
}

function pageRow(id: string, url: string | null, title: string): PageSummary {
  return {
    id,
    projectId: 'proj-1',
    url,
    title,
    label: null,
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 1,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  } as PageSummary
}
