import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { loadExportSourceExtras } from '../../communities/export-extras'
import {
  COMMUNITY_SEED,
  fixtureResponse,
  seedCommunitiesProject,
  type SeededHarness
} from '../../communities/seed.test-helper'
import { closeProjectDatabase, openProjectDatabase } from '../../storage/project-files'
import { createStorageExportSource } from '../source'
import type { ExportDataset } from '../types'
import { buildExportSources, NOTHING_TO_REPLY, SOURCES_NOTE } from './sources'

const opened: Array<{ harness: SeededHarness; dir: string }> = []

afterEach(() => {
  for (const { harness, dir } of opened.splice(0)) {
    harness.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

async function seededDataset(): Promise<{ harness: SeededHarness; dataset: ExportDataset }> {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-sources-'))
  const harness = await seedCommunitiesProject(dir, {
    cacheVideoDetails: true,
    http: (request) =>
      request.url.includes('/comments/1def45y.json')
        ? fixtureResponse('reddit-thread-archived.json')
        : request.url.includes('/comments/1abc23x.json')
          ? fixtureResponse('reddit-thread-archived.json')
          : null
  })
  opened.push({ harness, dir })
  const dataset = await createStorageExportSource({
    app: harness.storage.db,
    projectsDirectory: harness.storage.paths.projectsDirectory,
    now: () => new Date('2026-10-20T09:00:00.000Z')
  }).loadExportDataset({
    projectId: COMMUNITY_SEED.projectId,
    scope: 'project',
    pageIds: [],
    viewId: null,
    marketIds: [COMMUNITY_SEED.us, COMMUNITY_SEED.uk],
    checks: 'all',
    from: null,
    to: null,
    timeZone: 'UTC'
  })
  return { harness, dataset }
}

function extrasOf(harness: SeededHarness): ReturnType<typeof loadExportSourceExtras> {
  const db = openProjectDatabase(harness.storage.paths.projectsDirectory, 'textbolt')
  try {
    return loadExportSourceExtras(db)
  } finally {
    closeProjectDatabase(db)
  }
}

describe('export sources block (REPORT-SPEC §8)', () => {
  test('matches the Communities tab for the same scope and check', async () => {
    const { harness, dataset } = await seededDataset()
    const sources = buildExportSources(
      dataset,
      { pageIds: null, marketIds: null },
      extrasOf(harness)
    )
    const tab = await harness.handlers['communities:get']({
      projectId: COMMUNITY_SEED.projectId,
      scope: 'project',
      pageId: null,
      marketId: null
    })
    const latest = tab.checks[0]
    expect(sources.note).toBe(SOURCES_NOTE)
    expect(sources.totals.citations).toBe(latest?.citations)
    for (const owner of sources.owners) {
      expect(owner.citations).toBe(
        latest?.owners.find((row) => row.owner === owner.owner)?.citations
      )
    }
    for (const platform of sources.platforms) {
      const segment = latest?.types.find((row) => row.type === platform.type)
      expect(platform.citations).toBe(segment?.citations)
      expect(platform.prompts).toBe(segment?.aios)
    }
    expect(sources.platforms.reduce((sum, row) => sum + row.citations, 0)).toBe(
      sources.totals.citations
    )
    expect(sources.totals.yours + sources.totals.competitor + sources.totals.external).toBe(
      sources.totals.citations
    )
    expect(sources.youtube.map((video) => [video.videoId, video.prompts, video.views])).toEqual(
      tab.youtube.map((video) => [video.videoId, video.timesCited, video.views])
    )
    expect(sources.youtubeChannels.map((row) => row.channel)).toEqual([
      'SmallBiz Tech Help',
      'Ops Shortcuts'
    ])
    expect(sources.reddit.map((group) => group.subreddit)).toEqual([
      'r/sysadmin',
      'r/smallbusiness'
    ])
    expect(sources.redditNote).toBeNull()
    expect(sources.linkedin.map((post) => post.kind)).toEqual(['post', 'article'])
    expect(sources.influential[0]?.prompts).toBeGreaterThanOrEqual(
      sources.influential[1]?.prompts ?? 0
    )
    expect(sources.totals.gapCitations).toBeGreaterThan(0)
  })

  test('says there is nothing to reply to when every checked thread is closed', async () => {
    const { harness, dataset } = await seededDataset()
    await harness.handlers['communities:checkThreads']({
      projectId: COMMUNITY_SEED.projectId,
      urls: null,
      force: false
    })
    const sources = buildExportSources(
      dataset,
      { pageIds: null, marketIds: null },
      extrasOf(harness)
    )
    expect(
      sources.reddit.flatMap((group) => group.threads.map((thread) => thread.canReply))
    ).toEqual(['archived', 'archived'])
    expect(sources.redditNote).toBe(NOTHING_TO_REPLY)
  })

  test('a market filter narrows every count; without extras views are unknown', async () => {
    const { dataset } = await seededDataset()
    const us = buildExportSources(dataset, { pageIds: null, marketIds: [COMMUNITY_SEED.us] })
    const all = buildExportSources(dataset, { pageIds: null, marketIds: null })
    expect(us.totals.citations).toBeLessThan(all.totals.citations)
    expect(us.youtube.every((video) => video.views === null && video.channel === null)).toBe(true)
    expect(buildExportSources(dataset, { pageIds: ['nope'], marketIds: null }).totals).toEqual({
      citations: 0,
      yours: 0,
      yoursShare: null,
      competitor: 0,
      external: 0,
      gapCitations: 0
    })
  })
})
