import { afterEach, describe, expect, test } from 'vitest'
import { page, snapshot } from '../engine/checks/checks.test-helper'
import {
  diffVersions,
  linkedFix,
  listProjectPageChanges,
  listVersions,
  pageHistoryByPage
} from '../engine/page-changes'
import { insertSnapshot, type StoredSnapshot } from '../storage/content-records'
import { openSqliteDatabase, type SqliteDatabase } from '../storage/database'
import { migrate } from '../storage/migrate'
import { applied, closeTracked, track } from '../storage/migrate.test-helper'
import {
  insertPageRead,
  latestPageRead,
  listPageVersions,
  PAGE_VERSIONS_KEPT,
  prunePageReads,
  setPageChangeDismissed
} from '../storage/page-history'
import { insertPage } from '../storage/pages'
import { PROJECT_MIGRATIONS } from '../storage/project-schema'
import { PAGE_HISTORY_VERSION } from '../storage/project-schema-page-history'
import { contentHash } from './hash'
import { changedAtOf, recordPageRead } from './page-history'

afterEach(() => {
  closeTracked()
})

const V1 = `# Email to text alternative

Updated on Jun 4, 2026

Send texts from your inbox.

## Pricing

Plans start at $10 a month.`

const V2 = `# Email to text alternative

Updated on Oct 28, 2026

Send texts from your inbox.

## Pricing and plans

Plans start at $10 a month.

## Compare with AT&T

AT&T closed its gateway in June.

## FAQ

Does it work with Gmail? Yes.`

function read(id: string, at: string, body: string, modifiedAt: string | null): StoredSnapshot {
  return {
    ...snapshot(),
    id,
    fetchedAt: at,
    method: 'file',
    bodyText: body,
    modifiedAt,
    contentHash: contentHash(body)
  }
}

function projectDb(versionsBelow?: number): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(
    db,
    versionsBelow === undefined
      ? PROJECT_MIGRATIONS
      : PROJECT_MIGRATIONS.filter((item) => item.version < versionsBelow)
  )
  insertPage(db, { ...page(), defaultMarketId: null })
  return db
}

function keep(
  db: SqliteDatabase,
  snap: StoredSnapshot,
  readAt = snap.fetchedAt
): ReturnType<typeof recordPageRead> {
  if (snap.fetchedAt === readAt) insertSnapshot(db, snap)
  return recordPageRead(db, {
    pageId: snap.pageId,
    snapshot: snap,
    readAt,
    publishedAt: null,
    modifiedAt: snap.modifiedAt,
    newId: () => `pc-${snap.id}`
  })
}

describe('project migration page_history', () => {
  test('existing snapshots become the first reads, with no change raised', () => {
    const db = projectDb(PAGE_HISTORY_VERSION)
    insertSnapshot(db, read('snap-a', '2026-09-01T10:00:00.000Z', V1, '2026-06-04T00:00:00.000Z'))
    insertSnapshot(db, read('snap-b', '2026-09-20T10:00:00.000Z', V2, '2026-09-19T00:00:00.000Z'))
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db)).toContainEqual({
      version: PAGE_HISTORY_VERSION,
      name: `0${PAGE_HISTORY_VERSION}_page_history`
    })
    expect(latestPageRead(db, 'page-1')).toMatchObject({
      snapshotId: 'snap-b',
      modifiedAt: '2026-09-19T00:00:00.000Z'
    })
    expect(listPageVersions(db, 'page-1').map((row) => row.snapshotId)).toEqual([
      'snap-b',
      'snap-a'
    ])
    expect(listProjectPageChanges(db, 'proj-1', '2026-10-30T00:00:00.000Z').changes).toEqual([])
  })
})

describe('recordPageRead', () => {
  test('the first read only keeps the read', () => {
    const db = projectDb()
    expect(keep(db, read('snap-1', '2026-10-01T09:00:00.000Z', V1, null))).toBeNull()
    expect(latestPageRead(db, 'page-1')?.snapshotId).toBe('snap-1')
  })

  test('a new version raises a change dated by the page’s new "Updated" date', () => {
    const db = projectDb()
    keep(db, read('snap-1', '2026-10-01T09:00:00.000Z', V1, '2026-06-04T00:00:00.000Z'))
    const change = keep(
      db,
      read('snap-2', '2026-10-29T10:27:00.000Z', V2, '2026-10-28T00:00:00.000Z')
    )
    expect(change).toMatchObject({
      fromSnapshotId: 'snap-1',
      toSnapshotId: 'snap-2',
      changedAt: '2026-10-28T00:00:00.000Z',
      modifiedAt: '2026-10-28T00:00:00.000Z',
      previousModifiedAt: '2026-06-04T00:00:00.000Z',
      counts: { sectionsAdded: 2, sectionsRemoved: 0, headingsChanged: 1, textChanged: 0 },
      sections: ['Pricing and plans', 'Compare with AT&T', 'FAQ']
    })
    const list = listProjectPageChanges(db, 'proj-1', '2026-10-30T00:00:00.000Z')
    expect(list.changes).toHaveLength(1)
    expect(list.changes[0]).toMatchObject({
      state: 'open',
      url: page().url,
      label: 'Alerts',
      sentence: '2 sections are new and 1 heading changed.'
    })
    expect(list.dates).toEqual([
      {
        pageId: 'page-1',
        publishedAt: null,
        modifiedAt: '2026-10-28T00:00:00.000Z',
        readAt: '2026-10-29T10:27:00.000Z'
      }
    ])
    expect(pageHistoryByPage(db).get('page-1')?.unlogged).toBe(1)
  })

  test('only a new date, or the same text read again, is no change', () => {
    const db = projectDb()
    keep(db, read('snap-1', '2026-10-01T09:00:00.000Z', V1, null))
    const datesOnly = V1.replace('Jun 4, 2026', 'Oct 28, 2026')
    expect(keep(db, read('snap-2', '2026-10-15T09:00:00.000Z', datesOnly, null))).toBeNull()
    const again = read('snap-2', '2026-10-15T09:00:00.000Z', datesOnly, null)
    expect(keep(db, again, '2026-10-22T09:00:00.000Z')).toBeNull()
    const versions = listPageVersions(db, 'page-1')
    expect(versions.map((row) => [row.snapshotId, row.reads])).toEqual([
      ['snap-2', 2],
      ['snap-1', 1]
    ])
  })

  test('keeps the reads of the newest 24 versions', () => {
    const db = projectDb()
    for (let index = 0; index < PAGE_VERSIONS_KEPT + 3; index += 1) {
      insertPageRead(db, {
        pageId: 'page-1',
        snapshotId: `snap-${index}`,
        readAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
        publishedAt: null,
        modifiedAt: null
      })
    }
    prunePageReads(db, 'page-1')
    const versions = listPageVersions(db, 'page-1')
    expect(versions).toHaveLength(PAGE_VERSIONS_KEPT)
    expect(versions.at(-1)?.snapshotId).toBe('snap-3')
  })
})

describe('changedAtOf', () => {
  const from = '2026-10-01T09:00:00.000Z'
  const to = '2026-10-29T09:00:00.000Z'
  test('a stated date between the reads wins; one before them or unchanged does not', () => {
    expect(changedAtOf(to, from, '2026-10-28T00:00:00.000Z', null)).toBe('2026-10-28T00:00:00.000Z')
    expect(changedAtOf(to, from, '2026-06-04T00:00:00.000Z', null)).toBe(to)
    expect(changedAtOf(to, from, '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z')).toBe(to)
    expect(changedAtOf(to, from, null, null)).toBe(to)
  })
})

describe('linking, versions and the diff', () => {
  function seeded(): SqliteDatabase {
    const db = projectDb()
    keep(db, read('snap-1', '2026-10-01T09:00:00.000Z', V1, '2026-06-04T00:00:00.000Z'))
    keep(db, read('snap-2', '2026-10-29T10:27:00.000Z', V2, '2026-10-28T00:00:00.000Z'))
    return db
  }

  test('a fix live within 3 days links the change; "Not a fix" and Undo', () => {
    const db = seeded()
    const row = {
      pageId: 'page-1',
      changedAt: '2026-10-28T00:00:00.000Z',
      detectedAt: '2026-10-29T10:27:00.000Z'
    }
    const fix = (
      liveOn: string
    ): { id: string; pageId: string; url: string | null; number: number; liveOn: string } => ({
      id: 'fix-1',
      pageId: 'page-1',
      url: null,
      number: 2,
      liveOn
    })
    expect(linkedFix(row, [fix('2026-10-30T12:00:00.000Z')])?.id).toBe('fix-1')
    expect(linkedFix(row, [fix('2026-10-25T12:00:00.000Z')])?.id).toBe('fix-1')
    expect(linkedFix(row, [fix('2026-10-20T12:00:00.000Z')])).toBeNull()
    expect(linkedFix(row, [{ ...fix('2026-10-28T12:00:00.000Z'), pageId: 'page-2' }])).toBeNull()
    // A fix stored on a topic links by its page address.
    const onTopic = {
      ...fix('2026-10-28T12:00:00.000Z'),
      pageId: 'topic-1',
      url: 'https://www.acme.test/pricing/'
    }
    expect(linkedFix(row, [onTopic], 'https://acme.test/pricing')?.id).toBe('fix-1')
    expect(linkedFix(row, [onTopic], 'https://acme.test/blog')).toBeNull()

    setPageChangeDismissed(db, 'pc-snap-2', '2026-10-30T08:00:00.000Z')
    expect(listProjectPageChanges(db, 'proj-1', '2026-10-30T09:00:00.000Z').changes[0]?.state).toBe(
      'dismissed'
    )
    expect(pageHistoryByPage(db).get('page-1')?.unlogged).toBe(0)
    setPageChangeDismissed(db, 'pc-snap-2', null)
    expect(listProjectPageChanges(db, 'proj-1', '2026-10-30T09:00:00.000Z').changes[0]?.state).toBe(
      'open'
    )
  })

  test('versions say what changed since the one before; the diff names each block', () => {
    const db = seeded()
    const versions = listVersions(db, 'page-1')
    expect(versions.versions.map((item) => [item.snapshotId, item.previousSnapshotId])).toEqual([
      ['snap-2', 'snap-1'],
      ['snap-1', null]
    ])
    expect(versions.versions[0]?.change?.id).toBe('pc-snap-2')
    expect(versions.versions[0]?.sentence).toBe('2 sections are new and 1 heading changed.')
    const diff = diffVersions(db, 'page-1', 'snap-1', 'snap-2')
    expect(diff?.counts.sectionsAdded).toBe(2)
    expect(diff?.from).toMatchObject({
      snapshotId: 'snap-1',
      modifiedAt: '2026-06-04T00:00:00.000Z'
    })
    expect(diff?.items.find((item) => item.op === 'changed')).toMatchObject({
      kind: 'h2',
      before: 'Pricing',
      after: 'Pricing and plans'
    })
    expect(diff?.fixText).toContain('Changed: Pricing and plans, Compare with AT&T, FAQ.')
    expect(diffVersions(db, 'page-2', 'snap-1', 'snap-2')).toBeNull()
  })
})
