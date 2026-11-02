import { afterEach, describe, expect, test } from 'vitest'
import type { CreateProjectRequest, StructureView } from '@shared/ipc'
import { cleanupHarness, harness } from '../handlers/test-harness'
import { createMapTransport, fixtureDns } from './fixture-transport'
import { textboltSitemapFixture } from './fixtures/textbolt-sitemaps'
import { parseCreateCluster, parseMovePages, parseSplitCluster, parseClusterId } from './parse'

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

type Seeded = ReturnType<typeof harness> & { projectId: string; view: StructureView }

/** 2,014 TextBolt pages from the sitemap fixture, clustered by the rules. */
async function seeded(): Promise<Seeded> {
  const h = harness({
    sitemapFetch: {
      http: createMapTransport(textboltSitemapFixture('base').files),
      dns: fixtureDns
    },
    rereadPage: async () => undefined
  })
  const created = await h.handlers['projects:create'](PROJECT)
  await h.handlers['sitemaps:discover']({ projectId: created.id, url: null })
  const clustered = await h.handlers['structure:recluster']({
    projectId: created.id,
    method: 'topic',
    useClaude: false,
    instruction: null
  })
  return { ...h, projectId: created.id, view: clustered.view }
}

async function pagesOf(ctx: Seeded, clusterId: string): Promise<string[]> {
  const list = await ctx.handlers['structure:clusterPages']({
    projectId: ctx.projectId,
    clusterId
  })
  return list.pages.map((page) => page.pageId)
}

function total(view: StructureView): number {
  return view.clusters.reduce((sum, cluster) => sum + cluster.pageCount, 0)
}

describe('clusters made by hand (FR-19.5)', () => {
  test('create, split, move many pages and delete, each undone by structure:undoClusters', async () => {
    const ctx = await seeded()
    const before = ctx.view.clusters.length
    const [a, b] = [...ctx.view.clusters].sort((x, y) => y.pageCount - x.pageCount)
    if (a === undefined || b === undefined) throw new Error('clusters missing')
    const fromA = (await pagesOf(ctx, a.id)).slice(0, 3)
    const fromB = (await pagesOf(ctx, b.id)).slice(0, 2)

    // Create: the picked pages leave their clusters; unknown ids are ignored.
    const made = await ctx.handlers['structure:createCluster']({
      projectId: ctx.projectId,
      name: '  Pricing pages ',
      pageIds: [...fromA, ...fromB, 'page-unknown']
    })
    expect(made.movedCount).toBe(5)
    const mine = made.view.clusters.find((cluster) => cluster.id === made.clusterId)
    expect(mine).toMatchObject({ name: 'Pricing pages', madeBy: 'user', pageCount: 5 })
    expect(made.view.clusters).toHaveLength(before + 1)
    expect(total(made.view)).toBe(total(ctx.view))
    expect(made.view.clusters.find((cluster) => cluster.id === a.id)?.pageCount).toBe(
      a.pageCount - 3
    )
    const created = await ctx.handlers['structure:clusterPages']({
      projectId: ctx.projectId,
      clusterId: made.clusterId
    })
    expect(created.pages.every((page) => page.movedByUser && page.role === 'supporting')).toBe(true)
    await expect(
      ctx.handlers['structure:createCluster']({
        projectId: ctx.projectId,
        name: 'pricing PAGES',
        pageIds: fromA
      })
    ).rejects.toThrow(/already exists/)
    await expect(
      ctx.handlers['structure:createCluster']({
        projectId: ctx.projectId,
        name: 'Nothing',
        pageIds: ['page-unknown']
      })
    ).rejects.toThrow(/Pick at least one page/)

    // Split: two of the five move to a new cluster; all of them cannot.
    const split = await ctx.handlers['structure:splitCluster']({
      projectId: ctx.projectId,
      clusterId: made.clusterId,
      name: 'Plans',
      pageIds: fromB
    })
    expect(split.movedCount).toBe(2)
    expect(split.view.clusters.find((c) => c.id === made.clusterId)?.pageCount).toBe(3)
    expect(split.view.clusters.find((c) => c.id === split.clusterId)?.pageCount).toBe(2)
    await expect(
      ctx.handlers['structure:splitCluster']({
        projectId: ctx.projectId,
        clusterId: made.clusterId,
        name: 'Other',
        pageIds: fromB
      })
    ).rejects.toThrow(/not all in this cluster/)
    await expect(
      ctx.handlers['structure:splitCluster']({
        projectId: ctx.projectId,
        clusterId: made.clusterId,
        name: 'Other',
        pageIds: fromA
      })
    ).rejects.toThrow(/Leave at least one page/)

    // Undo the split: the two pages are back in "Pricing pages".
    const undoSplit = await ctx.handlers['structure:undoClusters']({ projectId: ctx.projectId })
    expect(undoSplit.clusters.find((c) => c.id === split.clusterId)).toBeUndefined()
    expect(undoSplit.clusters.find((c) => c.id === made.clusterId)?.pageCount).toBe(5)

    // Move many: into another cluster, then out of every cluster.
    const moved = await ctx.handlers['structure:movePages']({
      projectId: ctx.projectId,
      pageIds: fromB,
      clusterId: b.id
    })
    expect(moved.clusters.find((c) => c.id === made.clusterId)?.pageCount).toBe(3)
    expect(moved.clusters.find((c) => c.id === b.id)?.pageCount).toBe(b.pageCount)
    const out = await ctx.handlers['structure:movePages']({
      projectId: ctx.projectId,
      pageIds: fromA,
      clusterId: null
    })
    expect(out.clusters.find((c) => c.id === made.clusterId)?.pageCount).toBe(0)
    expect(total(out)).toBe(total(ctx.view) - 3)
    const undoMove = await ctx.handlers['structure:undoClusters']({ projectId: ctx.projectId })
    expect(undoMove.clusters.find((c) => c.id === made.clusterId)?.pageCount).toBe(3)

    // Delete: its pages become unclustered; undo brings the cluster back.
    const deleted = await ctx.handlers['structure:deleteCluster']({
      projectId: ctx.projectId,
      clusterId: made.clusterId
    })
    expect(deleted.clusters.find((c) => c.id === made.clusterId)).toBeUndefined()
    expect(deleted.canUndoClusters).toBe(true)
    expect(total(deleted)).toBe(total(ctx.view) - 3)
    await expect(
      ctx.handlers['structure:deleteCluster']({
        projectId: ctx.projectId,
        clusterId: made.clusterId
      })
    ).rejects.toThrow(/cluster was not found/)
    const undoDelete = await ctx.handlers['structure:undoClusters']({ projectId: ctx.projectId })
    expect(undoDelete.clusters.find((c) => c.id === made.clusterId)?.pageCount).toBe(3)

    // Undo the create: the first five pages are back where they were.
    await ctx.handlers['structure:undoClusters']({ projectId: ctx.projectId })
    const undoCreate = await ctx.handlers['structure:undoClusters']({ projectId: ctx.projectId })
    expect(undoCreate.clusters.find((c) => c.id === made.clusterId)).toBeUndefined()
    expect(undoCreate.clusters.find((c) => c.id === a.id)?.pageCount).toBe(a.pageCount)
    expect(undoCreate.clusters.find((c) => c.id === b.id)?.pageCount).toBe(b.pageCount)
  })

  test('a moved pillar is cleared from its old cluster', async () => {
    const ctx = await seeded()
    const withPillar = ctx.view.clusters.find((cluster) => cluster.pillarPageId !== null)
    if (withPillar === undefined || withPillar.pillarPageId === null) {
      throw new Error('no pillar')
    }
    const made = await ctx.handlers['structure:createCluster']({
      projectId: ctx.projectId,
      name: 'Took the pillar',
      pageIds: [withPillar.pillarPageId]
    })
    expect(made.view.clusters.find((c) => c.id === withPillar.id)?.pillarPageId).toBeNull()
  })
})

describe('cluster request parsing', () => {
  test('rejects unknown keys, empty page lists, blank names and bad ids', () => {
    const base = { projectId: 'proj-1', name: 'A', pageIds: ['p1'] }
    expect(parseCreateCluster(base)).toEqual(base)
    expect(() => parseCreateCluster({ ...base, extra: 1 })).toThrow()
    expect(() => parseCreateCluster({ ...base, pageIds: [] })).toThrow()
    expect(() => parseCreateCluster({ ...base, name: '   ' })).toThrow()
    expect(() => parseCreateCluster({ ...base, name: 'x'.repeat(121) })).toThrow()
    expect(() => parseCreateCluster({ ...base, pageIds: ['bad id'] })).toThrow()
    expect(parseSplitCluster({ ...base, clusterId: 'c1' })).toMatchObject({ clusterId: 'c1' })
    expect(() => parseSplitCluster(base)).toThrow()
    expect(parseMovePages({ projectId: 'proj-1', pageIds: ['p1', 'p1'], clusterId: null })).toEqual(
      { projectId: 'proj-1', pageIds: ['p1'], clusterId: null }
    )
    expect(() => parseMovePages({ projectId: 'proj-1', pageIds: [], clusterId: 'c1' })).toThrow()
    expect(() => parseMovePages({ projectId: 'proj-1', pageIds: ['p1'] })).toThrow()
    expect(() =>
      parseClusterId({ projectId: 'proj-1', clusterId: 'c1', x: 1 }, 'structure:deleteCluster')
    ).toThrow()
  })
})
