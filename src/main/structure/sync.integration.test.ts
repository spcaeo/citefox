import { afterEach, describe, expect, test } from 'vitest'
import type { CreateProjectRequest } from '@shared/ipc'
import { cleanupHarness, harness } from '../handlers/test-harness'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { getProject } from '../storage/records'
import { createLookupTransport, fixtureDns, type RecordingTransport } from './fixture-transport'
import { textboltSitemapFixture } from './fixtures/textbolt-sitemaps'

afterEach(cleanupHarness)

const ALERTS = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const GONE = 'https://textbolt.com/blog/carrier-email-to-text-list-2024/'

function project(): CreateProjectRequest {
  return {
    name: 'TextBolt',
    domain: 'textbolt.com',
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: ['Twilio'],
    clientName: null,
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop'
  }
}

type SyncCtx = ReturnType<typeof harness> & {
  projectId: string
  transport: RecordingTransport
  rereads: Array<{ pageId: string; withGaps: boolean }>
  use: (next: 'base' | 'next') => void
}

/** Real IPC handlers over a switchable recorded site. */
async function setup(
  options: { status?: Map<string, number>; files?: Map<string, string> } = {}
): Promise<SyncCtx> {
  let variant: 'base' | 'next' = 'base'
  const rereads: Array<{ pageId: string; withGaps: boolean }> = []
  const sites = { base: textboltSitemapFixture('base'), next: textboltSitemapFixture('next') }
  const transport: RecordingTransport = createLookupTransport(
    (url) => (options.files ?? sites[variant].files).get(url),
    options.status
  )
  const h = harness({
    sitemapFetch: { http: transport, dns: fixtureDns },
    rereadPage: async (_projectId, pageId, withGaps) => {
      rereads.push({ pageId, withGaps })
    }
  })
  const created = await h.handlers['projects:create'](project())
  return {
    ...h,
    projectId: created.id,
    transport,
    rereads,
    use: (next: 'base' | 'next') => {
      variant = next
    }
  }
}

function pageIdFor(ctx: SyncCtx, url: string): string {
  const record = getProject(ctx.storage.db, ctx.projectId)
  if (record === null) throw new Error('project missing')
  const db = openProjectDatabase(ctx.storage.paths.projectsDirectory, record.slug)
  try {
    const row = db.prepare<unknown[], { id: string }>(`SELECT id FROM pages WHERE url = ?`).get(url)
    if (row === undefined) throw new Error(`no page for ${url}`)
    return row.id
  } finally {
    closeProjectDatabase(db)
  }
}

function statusOf(ctx: SyncCtx, url: string): string {
  const record = getProject(ctx.storage.db, ctx.projectId)
  if (record === null) throw new Error('project missing')
  const db = openProjectDatabase(ctx.storage.paths.projectsDirectory, record.slug)
  try {
    return (
      db.prepare<unknown[], { status: string }>(`SELECT status FROM pages WHERE url = ?`).get(url)
        ?.status ?? 'none'
    )
  } finally {
    closeProjectDatabase(db)
  }
}

describe('sitemap discovery and sync (FR-19.1 to FR-19.3)', () => {
  test('finds sitemaps through robots.txt and reads the 2,014-page TextBolt site as a baseline', async () => {
    const ctx = await setup()
    const started = performance.now()
    const report = await ctx.handlers['sitemaps:discover']({ projectId: ctx.projectId, url: null })
    const elapsed = performance.now() - started
    expect(report.trigger).toBe('first_read')
    expect(report.status).toBe('ok')
    expect(report.pageCount).toBe(2014)
    expect(report.newCount).toBe(2014)
    expect(report.removedCount).toBe(0)
    expect(elapsed).toBeLessThan(8000)
    expect(ctx.transport.requests[0]).toBe('https://textbolt.com/robots.txt')
    expect(ctx.transport.requests.some((url) => url.endsWith('tag-sitemap.xml'))).toBe(false)

    const overview = await ctx.handlers['sitemaps:get']({ projectId: ctx.projectId })
    expect(overview.foundPageCount).toBe(2014)
    expect(overview.trackedPageCount).toBe(0)
    const index = overview.sitemaps.find((sitemap) => sitemap.kind === 'index')
    expect(index?.source).toBe('robots')
    expect(index?.pageCount).toBe(7)
    const tag = overview.sitemaps.find((sitemap) => sitemap.url.endsWith('tag-sitemap.xml'))
    expect(tag).toMatchObject({ included: false, lowValue: true, parentId: index?.id })
    const childTotal = overview.sitemaps
      .filter((sitemap) => sitemap.kind === 'urlset')
      .reduce((sum, sitemap) => sum + sitemap.pageCount, 0)
    expect(childTotal).toBe(2014)

    const pages = await ctx.handlers['pages:list']({ projectId: ctx.projectId })
    expect(pages.foundPageCount).toBe(2014)
    expect(pages.pages).toHaveLength(0)
  })

  test('a second sync reports new, removed and changed pages and applies the rules', async () => {
    const ctx = await setup()
    await ctx.handlers['sitemaps:discover']({ projectId: ctx.projectId, url: null })
    const alerts = pageIdFor(ctx, ALERTS)
    const gone = pageIdFor(ctx, GONE)
    const tracked = await ctx.handlers['import:track']({
      projectId: ctx.projectId,
      pageIds: [alerts, gone],
      urls: [],
      markets: [],
      intervalDays: 30,
      samples: 1,
      promptCount: 5,
      stagger: false
    })
    expect(tracked.trackedCount).toBe(2)
    await ctx.handlers['sitemaps:setRules']({
      projectId: ctx.projectId,
      rules: { frequency: 'weekly', onNew: 'ask', onRemoved: 'pause', onChanged: 'reread_gaps' }
    })
    ctx.use('next')
    const report = await ctx.handlers['sitemaps:sync']({ projectId: ctx.projectId })
    expect(report.trigger).toBe('manual')
    expect([report.newCount, report.removedCount, report.changedCount]).toEqual([6, 1, 14])
    expect(report.newPages.every((page) => page.action === 'awaiting_you')).toBe(true)
    expect(report.removedPages[0]).toMatchObject({ url: GONE, action: 'paused', wasTracked: true })
    const changed = report.changedPages.find((page) => page.url === ALERTS)
    expect(changed).toMatchObject({ action: 'reread_queued', wasTracked: true })
    expect(report.changedPages.filter((page) => page.action === 'date_updated')).toHaveLength(13)
    expect(statusOf(ctx, GONE)).toBe('paused')
    expect(statusOf(ctx, 'https://textbolt.com/blog/grafana-sms-alerts/')).toBe('not_tracked')
    expect(ctx.rereads).toEqual([{ pageId: alerts, withGaps: true }])
    const overview = await ctx.handlers['sitemaps:get']({ projectId: ctx.projectId })
    expect(overview.lastSync?.id).toBe(report.id)
    expect(overview.nextSyncAt).not.toBeNull()
    // 2,019 in the sitemap, plus the removed page that was tracked: paused, history kept.
    expect(overview.foundPageCount).toBe(2020)
  })

  test('track with default markets and a tracked silo track new pages; untracked removed pages leave', async () => {
    const ctx = await setup()
    await ctx.handlers['sitemaps:discover']({ projectId: ctx.projectId, url: null })
    await ctx.handlers['structure:setSilo']({
      projectId: ctx.projectId,
      path: '/compare/',
      trackAll: true
    })
    await ctx.handlers['sitemaps:setRules']({
      projectId: ctx.projectId,
      rules: {
        frequency: 'daily',
        onNew: 'add_untracked',
        onRemoved: 'delete',
        onChanged: 'nothing'
      }
    })
    ctx.use('next')
    const report = await ctx.handlers['sitemaps:sync']({ projectId: ctx.projectId })
    const compare = report.newPages.find((page) => page.url.includes('/compare/'))
    expect(compare?.action).toBe('tracked')
    expect(statusOf(ctx, compare?.url ?? '')).toBe('setting_up')
    expect(report.newPages.filter((page) => page.action === 'added_untracked')).toHaveLength(5)
    expect(statusOf(ctx, GONE)).toBe('removed')
    expect(report.changedPages.every((page) => page.action === 'date_updated')).toBe(true)
    expect(ctx.rereads).toEqual([])
  })

  test('a sitemap that fails keeps its pages, and skipping a sitemap leaves its untracked pages out', async () => {
    const status = new Map<string, number>()
    const ctx = await setup({ status })
    await ctx.handlers['sitemaps:discover']({ projectId: ctx.projectId, url: null })
    status.set('https://textbolt.com/feature-sitemap.xml', 503)
    const report = await ctx.handlers['sitemaps:sync']({ projectId: ctx.projectId })
    expect(report.status).toBe('partial')
    expect(report.removedCount).toBe(0)
    expect(report.problems.join(' ')).toContain('feature-sitemap.xml')
    expect(report.nextStep).toContain('Some sitemaps could not be read')

    const overview = await ctx.handlers['sitemaps:get']({ projectId: ctx.projectId })
    const features = overview.sitemaps.find((sitemap) =>
      sitemap.url.endsWith('feature-sitemap.xml')
    )
    expect(features?.state).toBe('error')
    const skipped = await ctx.handlers['sitemaps:setIncluded']({
      projectId: ctx.projectId,
      sitemapId: features?.id ?? '',
      included: false
    })
    expect(skipped.foundPageCount).toBe(2014 - 96)
    await expect(
      ctx.handlers['sitemaps:setIncluded']({
        projectId: ctx.projectId,
        sitemapId: overview.sitemaps.find((sitemap) => sitemap.kind === 'index')?.id ?? '',
        included: false
      })
    ).rejects.toThrow('always read')
  })

  test('never fetches a private address a robots.txt points at', async () => {
    const files = new Map([
      [
        'https://textbolt.com/robots.txt',
        'Sitemap: http://127.0.0.1/sitemap.xml\nSitemap: http://localhost/s.xml'
      ],
      [
        'http://127.0.0.1/sitemap.xml',
        '<urlset><url><loc>https://textbolt.com/x/</loc></url></urlset>'
      ]
    ])
    const ctx = await setup({ files })
    const report = await ctx.handlers['sitemaps:discover']({ projectId: ctx.projectId, url: null })
    expect(report.status).toBe('error')
    expect(ctx.transport.requests).toEqual(['https://textbolt.com/robots.txt'])
    expect(report.problems.join(' ')).toContain('private or local address')
  })

  test('a user-added sitemap is read, and a page on another domain is ignored', async () => {
    const files = new Map([
      [
        'https://textbolt.com/custom.xml',
        `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://textbolt.com/a/</loc><lastmod>2026-10-01</lastmod></url>
          <url><loc>https://other.example/b/</loc></url></urlset>`
      ]
    ])
    const ctx = await setup({ files })
    const added = await ctx.handlers['sitemaps:add']({
      projectId: ctx.projectId,
      url: 'https://textbolt.com/custom.xml'
    })
    expect(added.sitemaps[0]).toMatchObject({ source: 'user', state: 'pending' })
    const report = await ctx.handlers['sitemaps:sync']({ projectId: ctx.projectId })
    expect(report.pageCount).toBe(1)
    expect(report.otherDomainCount).toBe(1)
    const removed = await ctx.handlers['sitemaps:remove']({
      projectId: ctx.projectId,
      sitemapId: added.sitemaps[0]?.id ?? ''
    })
    expect(removed.sitemaps).toHaveLength(0)
    expect(removed.foundPageCount).toBe(0)
  })
})
