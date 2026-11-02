import { afterEach, describe, expect, test } from 'vitest'
import type { CreateProjectRequest } from '@shared/ipc'
import { cleanupHarness, harness } from '../handlers/test-harness'
import type { ClaudeCompletion, ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { replaceProductCatalog } from '../storage/products'
import { getProject } from '../storage/records'
import { createMapTransport, fixtureDns } from './fixture-transport'
import { textboltSitemapFixture } from './fixtures/textbolt-sitemaps'

afterEach(cleanupHarness)

const PROJECT: CreateProjectRequest = {
  name: 'TextBolt',
  domain: 'textbolt.com',
  includeSubdomains: false,
  brandNames: ['TextBolt'],
  competitors: [],
  clientName: null,
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop'
}

function scriptedClaude(reply: (prompt: string) => unknown): ClaudeProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    id: 'claude-code',
    calls,
    async complete(request): Promise<ClaudeCompletion> {
      calls.push(request.prompt)
      const json = reply(request.prompt)
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
        model: 'claude-sonnet',
        resolvedModel: 'claude-sonnet',
        usage: emptyClaudeCliUsage()
      }
    }
  }
}

/** Page ids from a prompt's "id<TAB>path<TAB>title" lines. */
function idsInPrompt(prompt: string, match: string): string[] {
  return prompt
    .split('\n')
    .filter((line) => line.includes('\t') && line.includes(match))
    .map((line) => line.split('\t')[0] ?? '')
    .filter((id) => id.length > 0)
}

type Seeded = ReturnType<typeof harness> & { projectId: string }

async function seeded(claude?: ClaudeProvider): Promise<Seeded> {
  const h = harness({
    sitemapFetch: {
      http: createMapTransport(textboltSitemapFixture('base').files),
      dns: fixtureDns
    },
    rereadPage: async () => undefined,
    ...(claude !== undefined ? { claude } : {})
  })
  const created = await h.handlers['projects:create'](PROJECT)
  await h.handlers['sitemaps:discover']({ projectId: created.id, url: null })
  return { ...h, projectId: created.id }
}

function firstChecks(ctx: Seeded): Array<string | null> {
  const record = getProject(ctx.storage.db, ctx.projectId)
  if (record === null) throw new Error('project missing')
  const db = openProjectDatabase(ctx.storage.paths.projectsDirectory, record.slug)
  try {
    return db
      .prepare<unknown[], { first_check_not_before: string | null }>(
        `SELECT first_check_not_before FROM page_markets ORDER BY first_check_not_before`
      )
      .all()
      .map((row) => row.first_check_not_before)
  } finally {
    closeProjectDatabase(db)
  }
}

describe('Import pages (FR-20.6)', () => {
  test('lists candidates by folder, validates pasted URLs and CSV, estimates, and tracks with stagger', async () => {
    const ctx = await seeded()
    const list = await ctx.handlers['import:candidates']({ projectId: ctx.projectId })
    expect(list.rows).toHaveLength(2014)
    expect(list.folders[0]).toMatchObject({ folder: '/blog/', pageCount: 1420, trackedCount: 0 })
    expect(list.sitemapCount).toBe(6)
    expect(list.skippedSitemaps).toEqual(['tag-sitemap.xml'])
    expect(list.markets).toHaveLength(1)
    expect(list.rows.filter((row) => row.moneyPage).length).toBeGreaterThan(40)
    expect(list.rows.filter((row) => row.lastmod !== null)).toHaveLength(2014)
    expect(list.hasLinkData).toBe(false)

    const pasted = await ctx.handlers['import:parseUrls']({
      projectId: ctx.projectId,
      format: 'lines',
      text: [
        'https://textbolt.com/pricing/',
        'https://textbolt.com/new-landing/',
        'https://twilio.com/pricing/',
        'not a url',
        'https://textbolt.com/pricing/'
      ].join('\n')
    })
    expect(pasted.rows.map((row) => [row.path, row.pageId === null])).toEqual([
      ['/pricing/', false],
      ['/new-landing/', true]
    ])
    expect(pasted.rejected.map((row) => row.line)).toEqual([3, 4])
    expect(pasted.duplicates).toBe(1)
    const csv = await ctx.handlers['import:parseUrls']({
      projectId: ctx.projectId,
      format: 'csv',
      text: 'title,URL\n"Pricing, plans",https://textbolt.com/pricing/\n'
    })
    expect(csv.rows).toHaveLength(1)
    await expect(
      ctx.handlers['import:parseUrls']({ projectId: ctx.projectId, format: 'csv', text: 'name\nx' })
    ).rejects.toThrow('column of web addresses')

    const features = list.rows.filter((row) => row.folder === '/features/')
    const estimate = await ctx.handlers['import:estimate']({
      projectId: ctx.projectId,
      pageCount: features.length,
      setupPageCount: features.length,
      marketCount: 1,
      promptCount: 5,
      samples: 1,
      intervalDays: 30,
      stagger: true
    })
    expect(estimate).toMatchObject({
      minSearches: 480,
      maxSearches: 960,
      claudeCalls: 288,
      perDayMax: 138
    })

    const result = await ctx.handlers['import:track']({
      projectId: ctx.projectId,
      pageIds: features.map((row) => row.pageId ?? ''),
      urls: ['https://textbolt.com/new-landing/'],
      markets: [],
      intervalDays: 30,
      samples: 1,
      promptCount: 5,
      stagger: true
    })
    expect(result).toMatchObject({ trackedCount: 97, addedCount: 1, skippedCount: 0 })
    const holds = firstChecks(ctx)
    expect(holds.filter((value) => value === null).length).toBeGreaterThan(0)
    const spread = new Set(
      holds.filter((value) => value !== null).map((value) => value?.slice(0, 10))
    )
    expect(spread.size).toBe(6)
    const again = await ctx.handlers['import:candidates']({ projectId: ctx.projectId })
    expect(again.trackedCount).toBe(97)
    await expect(
      ctx.handlers['import:track']({
        projectId: ctx.projectId,
        pageIds: [],
        urls: ['https://twilio.com/x/'],
        markets: [],
        intervalDays: 30,
        samples: 1,
        promptCount: 5,
        stagger: false
      })
    ).rejects.toThrow('Only textbolt.com pages')
  })

  test('keeps the labels an imported file gave its pages (W3I-C2)', async () => {
    const ctx = await seeded()
    const csv = await ctx.handlers['import:parseUrls']({
      projectId: ctx.projectId,
      format: 'csv',
      text: [
        'url,label',
        'https://textbolt.com/pricing/,Pricing page',
        'https://textbolt.com/use-cases/restaurants/,"Restaurants, cafes"',
        'https://textbolt.com/features/,'
      ].join('\n')
    })
    expect(csv.rows.map((row) => [row.path, row.label ?? null])).toEqual([
      ['/pricing/', 'Pricing page'],
      ['/use-cases/restaurants/', 'Restaurants, cafes'],
      ['/features/', null]
    ])
    const pricing = csv.rows[0]
    await ctx.handlers['import:track']({
      projectId: ctx.projectId,
      pageIds: [pricing?.pageId ?? ''],
      urls: ['https://textbolt.com/use-cases/restaurants/'],
      markets: [],
      intervalDays: 30,
      samples: 1,
      promptCount: 5,
      stagger: false,
      labels: [
        { url: 'https://textbolt.com/pricing/', label: 'Pricing page' },
        { url: 'https://textbolt.com/use-cases/restaurants/', label: 'Restaurants, cafes' }
      ]
    })
    const labels = await ctx.handlers['pages:list']({ projectId: ctx.projectId })
    const labelOf = (path: string): string | null =>
      labels.pages.find((page) => page.url?.endsWith(path))?.label ?? null
    expect(labelOf('/pricing/')).toBe('Pricing page')
    expect(labelOf('/use-cases/restaurants/')).toBe('Restaurants, cafes')

    // A label set in CiteFox is kept; a later file does not overwrite it.
    const page = labels.pages.find((item) => item.url?.endsWith('/pricing/'))
    await ctx.handlers['pages:update']({
      projectId: ctx.projectId,
      pageId: page?.id ?? '',
      label: 'Plans'
    })
    await ctx.handlers['import:track']({
      projectId: ctx.projectId,
      pageIds: [page?.id ?? ''],
      urls: [],
      markets: [],
      intervalDays: 30,
      samples: 1,
      promptCount: 5,
      stagger: false,
      labels: [{ url: 'https://textbolt.com/pricing/', label: 'Something else' }]
    })
    const after = await ctx.handlers['pages:list']({ projectId: ctx.projectId })
    expect(after.pages.find((item) => item.id === page?.id)?.label).toBe('Plans')
  })

  test("Claude's pick returns only known, untracked pages", async () => {
    const claude = scriptedClaude((prompt) => ({
      pageIds: [...idsInPrompt(prompt, '/compare/').slice(0, 3), 'page-unknown'],
      reasons: ['Comparison pages answer buyer questions directly.']
    }))
    const ctx = await seeded(claude)
    const pick = await ctx.handlers['import:claudePick']({
      projectId: ctx.projectId,
      instruction: 'Prefer comparisons'
    })
    expect(pick.pageIds).toHaveLength(3)
    expect(pick.reasons).toEqual(['Comparison pages answer buyer questions directly.'])
    expect(claude.calls[0]).toContain('Prefer comparisons')
  })

  test("Claude's pick names the products and tags each page with its product", async () => {
    const claude = scriptedClaude((prompt) => ({
      pageIds: idsInPrompt(prompt, '/compare/').slice(0, 2),
      reasons: []
    }))
    const ctx = await seeded(claude)
    const record = getProject(ctx.storage.db, ctx.projectId)
    if (record === null) throw new Error('project missing')
    const db = openProjectDatabase(ctx.storage.paths.projectsDirectory, record.slug)
    try {
      replaceProductCatalog(db, {
        products: [
          {
            id: 'prod-compare',
            name: 'Comparisons',
            job: 'pick a texting tool',
            buyer: 'small teams',
            evidencePath: '/compare/'
          }
        ],
        competitors: [
          {
            name: 'Twilio',
            domain: 'twilio.com',
            productId: 'prod-compare',
            tier: 'direct',
            startingPrice: null,
            sources: []
          }
        ]
      })
    } finally {
      closeProjectDatabase(db)
    }
    const pick = await ctx.handlers['import:claudePick']({
      projectId: ctx.projectId,
      instruction: null
    })
    expect(pick.pageIds).toHaveLength(2)
    const prompt = claude.calls[0] ?? ''
    expect(prompt.split('\n')[0]).toBe('Assist: structure.import')
    expect(prompt).toContain('Business: textbolt.com (brand: TextBolt).')
    expect(prompt).toContain('- Comparisons · pick a texting tool · Twilio · 0')
    const compareLine = prompt.split('\n').find((line) => line.includes('\t/compare/'))
    expect(compareLine?.endsWith('\tComparisons')).toBe(true)
  })
})

describe('Clusters, silos and groups (FR-19.4 to FR-19.8)', () => {
  test('rule clusters keep manual edits on re-cluster, undo restores, and merge and track work', async () => {
    const ctx = await seeded()
    const first = await ctx.handlers['structure:recluster']({
      projectId: ctx.projectId,
      method: 'topic',
      useClaude: false,
      instruction: null
    })
    expect(first.previousCount).toBe(0)
    expect(first.view.clusters.length).toBeGreaterThan(5)
    expect(first.view.canUndoClusters).toBe(false)
    const clustered = first.view.clusters.reduce((sum, cluster) => sum + cluster.pageCount, 0)
    expect(clustered).toBe(2014)
    expect(first.view.clusters.every((cluster) => cluster.madeBy === 'rules')).toBe(true)

    const [a, b] = first.view.clusters
    if (a === undefined || b === undefined) throw new Error('clusters missing')
    await ctx.handlers['structure:renameCluster']({
      projectId: ctx.projectId,
      clusterId: a.id,
      name: 'My topic'
    })
    const pagesOfB = await ctx.handlers['structure:clusterPages']({
      projectId: ctx.projectId,
      clusterId: b.id
    })
    const moved = pagesOfB.pages.find((page) => page.role !== 'pillar')
    if (moved === undefined) throw new Error('page missing')
    await ctx.handlers['structure:movePage']({
      projectId: ctx.projectId,
      pageId: moved.pageId,
      clusterId: a.id
    })

    const again = await ctx.handlers['structure:recluster']({
      projectId: ctx.projectId,
      method: 'topic',
      useClaude: false,
      instruction: null
    })
    expect(again.view.canUndoClusters).toBe(true)
    const renamed = again.view.clusters.find((cluster) => cluster.id === a.id)
    expect(renamed).toMatchObject({ name: 'My topic', editedByUser: true })
    const aPages = await ctx.handlers['structure:clusterPages']({
      projectId: ctx.projectId,
      clusterId: a.id
    })
    expect(aPages.pages.find((page) => page.pageId === moved.pageId)?.movedByUser).toBe(true)
    expect(again.changes.join(' ')).toContain('manual edits are kept')

    const merged = await ctx.handlers['structure:mergeClusters']({
      projectId: ctx.projectId,
      fromClusterId: b.id,
      intoClusterId: a.id
    })
    expect(merged.clusters.find((cluster) => cluster.id === b.id)).toBeUndefined()
    const undone = await ctx.handlers['structure:undoClusters']({ projectId: ctx.projectId })
    expect(undone.clusters.find((cluster) => cluster.id === b.id)).toBeDefined()

    const pillarTarget = (
      await ctx.handlers['structure:clusterPages']({ projectId: ctx.projectId, clusterId: b.id })
    ).pages[1]
    if (pillarTarget === undefined) throw new Error('page missing')
    const withPillar = await ctx.handlers['structure:setPageRole']({
      projectId: ctx.projectId,
      clusterId: b.id,
      pageId: pillarTarget.pageId,
      role: 'pillar'
    })
    expect(withPillar.clusters.find((cluster) => cluster.id === b.id)?.pillarPageId).toBe(
      pillarTarget.pageId
    )

    const tracked = await ctx.handlers['structure:trackCluster']({
      projectId: ctx.projectId,
      clusterId: b.id,
      track: true
    })
    const bNow = tracked.view.clusters.find((cluster) => cluster.id === b.id)
    expect(tracked.trackedCount).toBe(bNow?.pageCount)
    expect(bNow).toMatchObject({ trackWhole: true, trackedCount: bNow?.pageCount })

    const summary = await ctx.handlers['structure:clusterSummary']({
      projectId: ctx.projectId,
      limit: 3
    })
    expect(summary.clusters).toHaveLength(3)
    expect(summary.totalClusters).toBe(tracked.view.clusters.length)
    const links = await ctx.handlers['structure:suggestLinks']({
      projectId: ctx.projectId,
      clusterId: b.id
    })
    expect(links.links.length).toBeGreaterThan(0)
    expect(
      links.links.every(
        (link) => link.toPageId === pillarTarget.pageId || link.fromPageId === pillarTarget.pageId
      )
    ).toBe(true)
  })

  test('Auto-cluster with Claude goes through the provider, and pages Claude skips are still clustered', async () => {
    const claude = scriptedClaude((prompt) => ({
      clusters: [
        {
          name: '10DLC & compliance',
          pillar: idsInPrompt(prompt, '10dlc')[0],
          pages: idsInPrompt(prompt, '10dlc'),
          themes: ['10DLC for alerts to own staff']
        }
      ]
    }))
    const ctx = await seeded(claude)
    const result = await ctx.handlers['structure:recluster']({
      projectId: ctx.projectId,
      method: 'topic',
      useClaude: true,
      instruction: 'Keep compliance together'
    })
    expect(claude.calls).toHaveLength(1)
    const tenDlc = result.view.clusters.find((cluster) => cluster.name === '10DLC & compliance')
    expect(tenDlc?.madeBy).toBe('claude')
    expect(tenDlc?.themes).toEqual(['10DLC for alerts to own staff'])
    expect(result.view.clusters.reduce((sum, cluster) => sum + cluster.pageCount, 0)).toBe(2014)
    await expect(
      ctx.handlers['structure:recluster']({
        projectId: ctx.projectId,
        method: 'links',
        useClaude: false,
        instruction: null
      })
    ).rejects.toThrow('no internal-link data')
  })

  test('a topic (a page with no URL) does not break the structure view or sync', async () => {
    const ctx = await seeded()
    const record = getProject(ctx.storage.db, ctx.projectId)
    if (record === null) throw new Error('project missing')
    const db = openProjectDatabase(ctx.storage.paths.projectsDirectory, record.slug)
    try {
      db.prepare(
        `INSERT INTO pages (id, url, title, status, interval_days, samples, prompt_count, kind)
         VALUES ('topic-1', NULL, 'Replacing a carrier gateway', 'tracked', 14, 1, 5, 'topic')`
      ).run()
    } finally {
      closeProjectDatabase(db)
    }
    const view = await ctx.handlers['structure:get']({ projectId: ctx.projectId })
    expect(view.silos.find((silo) => silo.path === '/')?.pageCount).toBe(2014)
    await expect(
      ctx.handlers['sitemaps:discover']({ projectId: ctx.projectId, url: null })
    ).resolves.toBeDefined()
  })

  test('silos come from folders, inherit markets, and groups are user lists in memberships', async () => {
    const ctx = await seeded()
    const view = await ctx.handlers['structure:get']({ projectId: ctx.projectId })
    const root = view.silos.find((silo) => silo.path === '/')
    expect(root?.pageCount).toBe(2014)
    expect(view.silos.find((silo) => silo.path === '/blog/')?.pageCount).toBe(1420)
    const nested = view.silos.find(
      (silo) => silo.path.startsWith('/use-cases/') && silo.depth === 2
    )
    expect(nested?.marketIds).toBeNull()
    expect(nested?.effectiveMarketIds).toEqual([view.markets[0]?.id])
    expect(view.insights.some((insight) => insight.kind === 'template_pages')).toBe(true)

    const group = await ctx.handlers['structure:createGroup']({
      projectId: ctx.projectId,
      name: 'Money pages',
      note: null
    })
    await expect(
      ctx.handlers['structure:createGroup']({
        projectId: ctx.projectId,
        name: 'money pages',
        note: null
      })
    ).rejects.toThrow('already exists')
    const candidates = await ctx.handlers['import:candidates']({ projectId: ctx.projectId })
    const money = candidates.rows.filter((row) => row.moneyPage).map((row) => row.pageId ?? '')
    const updated = await ctx.handlers['structure:setGroupPages']({
      projectId: ctx.projectId,
      groupId: group.id,
      add: [...money.slice(0, 5), 'page-unknown'],
      remove: []
    })
    expect(updated.pageCount).toBe(5)
    const other = await ctx.handlers['structure:createGroup']({
      projectId: ctx.projectId,
      name: 'Q4 refresh',
      note: 'Before Dec 15'
    })
    await ctx.handlers['structure:setGroupPages']({
      projectId: ctx.projectId,
      groupId: other.id,
      add: money.slice(0, 1),
      remove: []
    })
    const listed = await ctx.handlers['structure:groupPages']({
      projectId: ctx.projectId,
      groupId: group.id
    })
    expect(listed.pages).toHaveLength(5)

    await ctx.handlers['structure:recluster']({
      projectId: ctx.projectId,
      method: 'topic',
      useClaude: false,
      instruction: null
    })
    const memberships = await ctx.handlers['structure:listMemberships']({
      projectId: ctx.projectId
    })
    expect(memberships.pages).toHaveLength(2014)
    const first = memberships.pages.find((page) => page.pageId === money[0])
    expect([...(first?.groupIds ?? [])].sort()).toEqual([group.id, other.id].sort())
    expect(first?.clusterId).not.toBeNull()
    expect(memberships.pages.every((page) => page.siloPath.startsWith('/'))).toBe(true)
    // Re-clustering never touches groups.
    expect(
      (await ctx.handlers['structure:groupPages']({ projectId: ctx.projectId, groupId: group.id }))
        .pages
    ).toHaveLength(5)

    const afterDelete = await ctx.handlers['structure:deleteGroup']({
      projectId: ctx.projectId,
      groupId: other.id
    })
    expect(afterDelete.groups.map((item) => item.id)).toEqual([group.id])
  })
})
