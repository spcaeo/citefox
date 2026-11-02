import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReportSchedule } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { reportExportRequest } from '../email/reports/export-request'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import { closeDatabase } from '../storage/database'
import { changeGroupPages, insertGroup } from '../storage/group-records'
import { insertPage, setPageStatus } from '../storage/pages'
import { createProjectDatabase } from '../storage/project-files'
import { insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { resolveReportScope, scheduleScopePageIds, type ScopeSources } from './report-scope'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

const SOURCES: ScopeSources = {
  pageIds: ['page-1', 'page-2', 'page-3', 'topic-1'],
  groups: [
    { id: 'grp-money', pageIds: ['page-3', 'page-1'] },
    { id: 'grp-empty', pageIds: [] }
  ],
  clusters: [{ id: 'cl-email', pageIds: ['page-2', 'page-gone'] }]
}

describe('report scope resolution', () => {
  test('each kind resolves to its pages in project order; missing ids drop out', () => {
    expect(resolveReportScope(null, SOURCES)).toBeNull()
    expect(resolveReportScope({ kind: 'project', ids: [] }, SOURCES)).toBeNull()
    expect(resolveReportScope({ kind: 'pages', ids: ['page-3', 'page-1', 'x'] }, SOURCES)).toEqual([
      'page-1',
      'page-3'
    ])
    expect(resolveReportScope({ kind: 'topic', ids: ['topic-1'] }, SOURCES)).toEqual(['topic-1'])
    expect(resolveReportScope({ kind: 'group', ids: ['grp-money'] }, SOURCES)).toEqual([
      'page-1',
      'page-3'
    ])
    expect(resolveReportScope({ kind: 'cluster', ids: ['cl-email'] }, SOURCES)).toEqual(['page-2'])
    expect(resolveReportScope({ kind: 'group', ids: ['grp-empty'] }, SOURCES)).toBeNull()
    expect(resolveReportScope({ kind: 'pages', ids: ['gone'] }, SOURCES)).toBeNull()
  })

  test('a group schedule builds an export of exactly the group pages that are live', () => {
    const storage = seed()
    const warnings: string[] = []
    const logger = {
      warn: (message: string) => warnings.push(message),
      info: () => undefined,
      error: () => undefined,
      debug: () => undefined
    } as unknown as Parameters<typeof scheduleScopePageIds>[3]
    const group = schedule({ scope: { kind: 'group', ids: ['grp-money'] } })
    const ids = scheduleScopePageIds(storage, group, 'proj-1', logger)
    // page-2 is in the group but removed; page-4 is not in the group.
    expect(ids).toEqual(['page-1', 'page-3'])
    expect(reportExportRequest(group, 'proj-1', ids)).toMatchObject({
      scope: 'selected',
      pageIds: ['page-1', 'page-3']
    })
    expect(warnings).toEqual([])

    // An all-projects schedule ignores the scope.
    expect(
      scheduleScopePageIds(storage, { ...group, projectId: null }, 'proj-1', logger)
    ).toBeNull()
    // No scope is the whole project.
    expect(scheduleScopePageIds(storage, schedule({}), 'proj-1', logger)).toBeNull()
    // A scope that resolves to nothing falls back to the whole project, with a warning.
    expect(
      scheduleScopePageIds(
        storage,
        schedule({ scope: { kind: 'pages', ids: ['page-2'] } }),
        'proj-1',
        logger
      )
    ).toBeNull()
    expect(warnings).toHaveLength(1)
  })
})

function schedule(overrides: Partial<ReportSchedule>): ReportSchedule {
  return {
    id: 'sched-1',
    name: 'Money pages',
    projectId: 'proj-1',
    timing: { kind: 'weekly', day: 1, time: '08:00' },
    format: 'pdf',
    sections: [],
    marketIds: ['mkt-us'],
    recipients: ['client@example.com'],
    accountId: null,
    timeZone: 'UTC',
    subject: '{project}',
    summaryStyle: null,
    status: 'active',
    createdAt: '2026-02-01T00:00:00.000Z',
    ...overrides
  }
}

function seed(): AppStorage {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-report-scope-'))
  const storage = openAppStorage(directory)
  cleanups.push(() => {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  })
  insertProject(storage.db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.example',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  const project = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  for (const n of [1, 2, 3, 4]) {
    insertPage(project, {
      id: `page-${n}`,
      projectId: 'proj-1',
      url: `https://textbolt.example/p${n}`,
      title: `Page ${n}`,
      label: null,
      folder: null,
      status: 'tracked',
      setupStep: null,
      intervalDays: 14,
      samples: 1,
      promptCount: 5,
      defaultMarketId: null,
      pinned: false,
      score: null,
      promptSetVersion: null
    })
  }
  setPageStatus(project, 'page-2', 'removed', 'proj-1')
  insertGroup(project, {
    id: 'grp-money',
    name: 'Money pages',
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z'
  })
  changeGroupPages(
    project,
    'grp-money',
    ['page-3', 'page-1', 'page-2'],
    [],
    '2026-01-01T00:00:00.000Z'
  )
  closeDatabase(project)
  return storage
}
