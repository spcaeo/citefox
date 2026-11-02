import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { PageSummary } from '@shared/domain'
import {
  cycleSort,
  facetCount,
  filterPageRows,
  flattenFolderTree,
  folderTree,
  nextRowIndex,
  rowWindow,
  sortPages,
  type PageFilter
} from './gridModel'

function page(index: number, patch: Partial<PageSummary> = {}): PageSummary {
  return {
    id: `p-${index}`,
    projectId: 'textbolt',
    url: `https://textbolt.com/blog/page-${index}/`,
    title: `Page ${String(index).padStart(4, '0')}`,
    label: null,
    folder: index % 2 === 0 ? 'blog' : null,
    status: index % 10 === 0 ? 'paused' : 'tracked',
    setupStep: null,
    intervalDays: index % 3 === 0 ? 30 : 14,
    samples: 1,
    promptCount: (index % 5) + 1,
    defaultMarketId: 'us',
    pinned: false,
    score: index % 17 === 0 ? null : index % 100,
    promptSetVersion: 1,
    ...patch
  }
}

describe('page grid model', () => {
  test('sorts with nulls last, filters, and counts facets with the other filters applied', () => {
    const pages = [0, 1, 2, 3, 4].map((index) => page(index))
    const byScore = sortPages(pages, [{ key: 'score', dir: 'asc' }])
    expect(byScore.at(-1)?.score).toBeNull()
    const filter: PageFilter = { statuses: ['paused'], folders: [] }
    expect(filterPageRows(pages, filter).every((item) => item.status === 'paused')).toBe(true)
    const withFolder: PageFilter = { statuses: [], folders: ['blog'] }
    expect(facetCount(pages, withFolder, 'status', 'paused')).toBe(
      pages.filter((item) => item.folder === 'blog' && item.status === 'paused').length
    )
    expect(cycleSort([], 'title', false)).toEqual([{ key: 'title', dir: 'asc' }])
    expect(cycleSort([{ key: 'title', dir: 'asc' }], 'title', false)).toEqual([
      { key: 'title', dir: 'desc' }
    ])
    expect(cycleSort([{ key: 'title', dir: 'asc' }], 'score', true)).toEqual([
      { key: 'title', dir: 'asc' },
      { key: 'score', dir: 'asc' }
    ])
    expect(nextRowIndex(0, 4, 'ArrowUp')).toBe(3)
    expect(nextRowIndex(3, 4, 'End')).toBe(3)
  })

  test('a folder count matches the pages listed under it', () => {
    const pages = [0, 1, 2].map((index) => page(index))
    const flat = flattenFolderTree(folderTree(pages))
    const folder = flat.find((item) => item.kind === 'folder' && item.label === 'blog')
    const listed = flat.filter((item) => item.kind === 'page' && item.page.folder === 'blog')
    expect(folder && folder.kind === 'folder' ? folder.count : 0).toBe(listed.length)
  })

  test('sort, filter, and a window of 2,000 rows render in under 300 ms', () => {
    const pages = Array.from({ length: 2014 }, (_, index) => page(index))
    const filter: PageFilter = { statuses: ['tracked'], folders: [] }
    const started = performance.now()
    const sorted = sortPages(filterPageRows(pages, filter), [
      { key: 'score', dir: 'desc' },
      { key: 'title', dir: 'asc' }
    ])
    const window = rowWindow(sorted.length, 1500 * 44, 640, 44, 4)
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        sorted
          .slice(window.start, window.end)
          .map((item, offset) =>
            createElement('div', { key: item.id, 'data-row': window.start + offset }, item.title)
          )
      )
    )
    const elapsed = performance.now() - started
    const rendered = html.match(/data-row=/g)?.length ?? 0
    expect(sorted.length).toBeGreaterThanOrEqual(1800)
    expect(window.end - window.start).toBe(rendered)
    expect(rendered).toBeLessThan(40)
    expect(rendered).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(300)
  })
})

describe('rowWindow past the estimated end', () => {
  test('a scroll beyond the estimated rows still shows the last rows', () => {
    // Ten prompt rows that wrap to ~280px each, estimated at 72px: scrolling the
    // seventh row into view puts scrollTop near 1,700px, past 10 x 72px.
    const window = rowWindow(10, 1700, 560, 72, 5)
    expect(window.end).toBe(10)
    expect(window.start).toBeLessThan(window.end)
    expect(window.paddingTop + (window.end - window.start) * 72 + window.paddingBottom).toBe(720)
  })

  test('a long list scrolled to the very end keeps a full window', () => {
    const window = rowWindow(1000, 10_000_000, 640, 44, 4)
    expect(window.end).toBe(1000)
    expect(window.end - window.start).toBeGreaterThanOrEqual(Math.ceil(640 / 44))
  })
})
