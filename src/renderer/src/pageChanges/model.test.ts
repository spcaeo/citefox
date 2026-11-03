import { describe, expect, it } from 'vitest'
import type { PageChange } from '@shared/ipc'
import type { BlockDiffItem } from '@shared/page-diff'
import {
  bannerText,
  changeForVersions,
  changeIdOfEvent,
  datesForChange,
  fixText,
  foldDiff,
  liveDay,
  logFixValues,
  openChanges,
  pageChangeEvents,
  updatedBucket
} from './model'

function change(over: Partial<PageChange> = {}): PageChange {
  return {
    id: 'pc-1',
    pageId: 'page-1',
    url: 'https://acme.test/blog/alerts/',
    label: 'Alerts',
    detectedAt: '2026-10-29T15:00:00.000Z',
    changedAt: '2026-10-28T12:00:00.000Z',
    modifiedAt: '2026-10-28T12:00:00.000Z',
    previousModifiedAt: '2026-06-04T12:00:00.000Z',
    fromSnapshotId: 'snap-1',
    toSnapshotId: 'snap-2',
    counts: { sectionsAdded: 2, sectionsRemoved: 0, headingsChanged: 1, textChanged: 3 },
    sentence: '2 sections are new, 1 heading changed.',
    sections: ['Pricing', 'FAQ'],
    state: 'open',
    fixId: null,
    fixNumber: null,
    dismissedAt: null,
    ...over
  }
}

describe('page change banner words', () => {
  it('asks "Is this a fix?" with the path, the day and what the page says', () => {
    const text = bannerText(change())
    expect(text.lead).toMatch(/^\/blog\/alerts\/? changed on Oct 28, 12:00 PM\.$/)
    expect(text.detail).toBe(
      'The page says "Updated Oct 28". 2 sections are new, 1 heading changed. Is this a fix?'
    )
    expect(bannerText(change({ modifiedAt: null })).detail).toBe(
      '2 sections are new, 1 heading changed. Is this a fix?'
    )
  })

  it('lists only open changes, newest first', () => {
    const list = {
      changes: [
        change({ id: 'old', changedAt: '2026-10-01T00:00:00.000Z' }),
        change({ id: 'done', state: 'linked' }),
        change({ id: 'new', changedAt: '2026-10-30T00:00:00.000Z' }),
        change({ id: 'no', state: 'dismissed' })
      ]
    }
    expect(openChanges(list).map((item) => item.id)).toEqual(['new', 'old'])
    expect(openChanges(null)).toEqual([])
  })
})

describe('the dates under a change', () => {
  it("shows the page's latest dates only under its newest change", () => {
    const dates = [
      {
        pageId: 'page-1',
        publishedAt: null,
        modifiedAt: '2026-10-28T00:00:00.000Z',
        readAt: '2026-10-29T15:00:00.000Z'
      }
    ]
    const older = change({ id: 'old', detectedAt: '2026-10-15T00:00:00.000Z' })
    const list = { dates, changes: [change(), older] }
    expect(datesForChange(list, change())?.modifiedAt).toBe('2026-10-28T00:00:00.000Z')
    expect(datesForChange(list, older)).toBeNull()
  })
})

describe('Log as fix', () => {
  it('prefills the page, the go-live day and a short diff summary', () => {
    const values = logFixValues(change())
    expect(values['fix']).toBe('new')
    expect(values['fix.page']).toBe('page-1')
    expect(values['fix.live']).toBe(liveDay(change()))
    // The whole page changed: Log a fix starts with every question of the page ticked.
    expect(values['fix.from']).toBe('page-change')
    expect(values['fix.text']).toBe('2 sections are new, 1 heading changed. Changed: Pricing, FAQ.')
    expect(fixText(change({ sections: [] }))).toBe('2 sections are new, 1 heading changed.')
  })
})

describe('chart "?" markers', () => {
  it('shows open changes on the chosen pages only, and maps back to the change', () => {
    const changes = [
      change(),
      change({ id: 'pc-2', pageId: 'page-2' }),
      change({ id: 'pc-3', state: 'linked' })
    ]
    const all = pageChangeEvents(changes, null)
    expect(all.map((event) => event.id)).toEqual(['page:pc-1', 'page:pc-2'])
    const one = pageChangeEvents(changes, new Set(['page-2']))
    expect(one).toHaveLength(1)
    expect(one[0]?.kind).toBe('page')
    expect(one[0] && changeIdOfEvent(one[0])).toBe('pc-2')
    expect(changeIdOfEvent({ id: 'fix-1', kind: 'fix' })).toBeNull()
  })

  it('finds the noticed change behind two versions', () => {
    const list = { changes: [change()] }
    expect(changeForVersions(list, 'page-1', 'snap-2')?.id).toBe('pc-1')
    expect(changeForVersions(list, 'page-1', 'snap-9')).toBeNull()
    expect(changeForVersions(list, null, 'snap-2')).toBeNull()
  })
})

describe('Pages "Updated" filter', () => {
  it('splits pages into updated, not updated in 12 months, and no date', () => {
    const now = new Date('2026-11-01T12:00:00.000Z')
    expect(updatedBucket('2026-10-28T00:00:00.000Z', now)).toBe('recent')
    expect(updatedBucket('2025-06-04T00:00:00.000Z', now)).toBe('stale')
    expect(updatedBucket(null, now)).toBe('none')
    expect(updatedBucket('not a date', now)).toBe('none')
  })
})

describe('diff folding', () => {
  const same = (text: string, kind: BlockDiffItem['kind'] = 'p'): BlockDiffItem => ({
    op: 'same',
    kind,
    before: text,
    after: text,
    section: 'Intro'
  })

  it('folds long unchanged runs and keeps a block of context around each change', () => {
    const items: BlockDiffItem[] = [
      same('a'),
      same('b'),
      same('c'),
      same('d'),
      same('e'),
      { op: 'added', kind: 'p', before: null, after: 'new', section: 'Intro' },
      same('f')
    ]
    const rows = foldDiff(items, false)
    expect(rows[0]).toEqual({ kind: 'fold', count: 4, section: 'Intro' })
    expect(rows.slice(1).map((row) => (row.kind === 'item' ? row.item.after : null))).toEqual([
      'e',
      'new',
      'f'
    ])
    expect(foldDiff(items, true)).toHaveLength(items.length)
  })
})
