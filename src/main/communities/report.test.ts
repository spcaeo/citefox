import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { CommunitiesReport } from '@shared/domain'
import { COMMUNITY_SEED, seedCommunitiesProject, type SeededHarness } from './seed.test-helper'

const opened: Array<{ harness: SeededHarness; dir: string }> = []

afterEach(() => {
  for (const { harness, dir } of opened.splice(0)) {
    harness.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

async function seeded(
  options: Parameters<typeof seedCommunitiesProject>[1] = {}
): Promise<SeededHarness> {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-communities-'))
  const harness = await seedCommunitiesProject(dir, options)
  opened.push({ harness, dir })
  return harness
}

function report(
  harness: SeededHarness,
  scope: 'page' | 'project' = 'page',
  marketId: string | null = null
): Promise<CommunitiesReport> {
  return Promise.resolve(
    harness.handlers['communities:get']({
      projectId: COMMUNITY_SEED.projectId,
      scope,
      pageId: scope === 'page' ? COMMUNITY_SEED.pageId : null,
      marketId
    })
  )
}

/** NFR-14: every drill list names answers in the report, and its length is the number shown. */
function expectDrillsConsistent(result: CommunitiesReport): void {
  const keys = new Set(result.aios.map((aio) => aio.key))
  const lists: Array<{ count: number; keys: readonly string[] }> = []
  for (const check of result.checks) {
    lists.push({ count: check.aios, keys: check.aioKeys })
    for (const segment of [...check.types, ...check.owners]) {
      lists.push({ count: segment.aios, keys: segment.aioKeys })
    }
    expect(check.types.reduce((sum, segment) => sum + segment.citations, 0)).toBe(check.citations)
    expect(check.owners.reduce((sum, segment) => sum + segment.citations, 0)).toBe(check.citations)
    // Every citation count drills to its links: the link list has exactly that many.
    const links = result.links.filter((link) => link.checkIndex === check.index)
    expect(links).toHaveLength(check.citations)
    for (const segment of check.types) {
      expect(links.filter((link) => link.type === segment.type)).toHaveLength(segment.citations)
    }
    for (const segment of check.owners) {
      expect(links.filter((link) => link.owner === segment.owner)).toHaveLength(segment.citations)
    }
    for (const link of links) expect(check.aioKeys).toContain(link.aioKey)
  }
  for (const row of [...result.reddit, ...result.youtube, ...result.linkedin, ...result.forums]) {
    lists.push({ count: row.timesCited, keys: row.aioKeys }, { count: row.gap, keys: row.gapKeys })
  }
  for (const list of lists) {
    expect(list.keys).toHaveLength(list.count)
    expect(new Set(list.keys).size).toBe(list.count)
    for (const key of list.keys) expect(keys.has(key)).toBe(true)
  }
  for (const opportunity of result.opportunities) expect(keys.has(opportunity.aioKey)).toBe(true)
}

describe('communities:get (FR-17.1 to FR-17.5)', () => {
  test('page scope: source mix per check, with no extra searches', async () => {
    const harness = await seeded()
    const searchesBefore = harness.requests.length
    const result = await report(harness)
    expect(harness.requests).toHaveLength(searchesBefore)
    expect(result.scope).toBe('page')
    const latestTimes = result.aios.filter((aio) => aio.latest).map((aio) => aio.checkedAt)
    expect(result.checkedAt).toBe([...latestTimes].sort().at(-1))
    expect(result.markets.map((market) => market.id).sort()).toEqual([
      COMMUNITY_SEED.uk,
      COMMUNITY_SEED.us
    ])
    expect(result.checks.map((check) => check.index)).toEqual([0, 1])
    const latest = result.checks[0]
    expect(latest?.aios).toBe(4)
    expect(latest?.citations).toBe(15)
    const byType = Object.fromEntries(
      (latest?.types ?? []).map((segment) => [segment.type, segment.citations])
    )
    expect(byType).toEqual({
      web: 4,
      reddit: 3,
      youtube: 3,
      linkedin: 3,
      review: 1,
      forum: 1,
      other: 0
    })
    const owners = Object.fromEntries(
      (latest?.owners ?? []).map((segment) => [segment.owner, segment.citations])
    )
    expect(owners).toEqual({ yours: 2, competitor: 2, external: 11 })
    expect(result.checks[1]?.citations).toBe(12)
    expectDrillsConsistent(result)
  })

  test('a video linked by youtu.be, m.youtube and a timestamp counts once', async () => {
    const harness = await seeded({ cacheVideoDetails: true })
    const result = await report(harness)
    const grafana = result.youtube.filter((video) => video.videoId === 'Gr4fanaSMS1')
    expect(grafana).toHaveLength(1)
    expect(grafana[0]).toMatchObject({
      url: 'https://youtube.com/watch?v=Gr4fanaSMS1',
      timesCited: 1,
      views: 48210,
      channelTitle: 'Ops Shortcuts',
      yours: false
    })
    expect(result.youtube.map((video) => video.videoId)).toEqual(['Emai1ToSMS2', 'Gr4fanaSMS1'])
    expect(result.youtube[0]?.marketIds).toEqual([COMMUNITY_SEED.uk, COMMUNITY_SEED.us])
    expect(result.extras.videosWithDetails).toBe(2)
  })

  test('lists threads by subreddit, LinkedIn posts, forums and review sites', async () => {
    const harness = await seeded()
    const result = await report(harness)
    expect(result.reddit.map((thread) => [thread.subreddit, thread.timesCited])).toEqual([
      ['r/sysadmin', 2],
      ['r/smallbusiness', 1]
    ])
    const sysadmin = result.reddit[0]
    expect(sysadmin?.threadId).toBe('1abc23x')
    expect(sysadmin?.replyState).toBe('unchecked')
    expect(sysadmin?.firstSeenAt?.startsWith('2026-10-05')).toBe(true)
    // "First seen" names the check and prompt that cited it first (FR-17.3).
    expect(sysadmin?.firstSeenIn).toMatchObject({
      pageId: COMMUNITY_SEED.pageId,
      checkedAt: sysadmin?.firstSeenAt
    })
    const first = sysadmin?.firstSeenIn
    const firstAnswer = result.aios.find(
      (aio) => aio.runId === first?.runId && aio.promptId === first?.promptId
    )
    expect(firstAnswer?.checkedAt).toBe(sysadmin?.firstSeenAt)
    expect(firstAnswer?.promptPosition).toBe(first?.promptPosition)
    expect(sysadmin?.excerpt).toBeNull()
    expect(sysadmin?.brandQuote).toBeNull()
    expect(sysadmin?.gap).toBe(1)
    expect(result.linkedin.map((post) => post.kind)).toEqual(['post', 'article'])
    expect(result.forums.map((row) => [row.site, row.type])).toEqual([
      ['Spiceworks Community', 'forum'],
      ['TrustRadius', 'review']
    ])
  })

  test('opportunities rank answers that cite a community source but not the page', async () => {
    const harness = await seeded()
    const result = await report(harness)
    const aio = (key: string): string => {
      const found = result.aios.find((item) => item.key === key)
      return `${found?.marketId}:${found?.promptId}:${found?.status}`
    }
    expect(
      result.opportunities.map((row) => [row.rank, aio(row.aioKey), row.sourceType, row.gainPoints])
    ).toEqual([
      [1, `${COMMUNITY_SEED.us}:prompt-2:not_cited`, 'youtube', 3],
      [2, `${COMMUNITY_SEED.uk}:prompt-1:not_cited`, 'reddit', 3],
      [3, `${COMMUNITY_SEED.uk}:prompt-2:other_own_page`, 'linkedin', 2]
    ])
    expect(result.opportunities[1]?.channel).toBe('r/sysadmin')
    expect(result.opportunities[1]?.action).toContain('Post it yourself')
    expect(result.opportunities.every((row) => !/caused|because of/i.test(row.why))).toBe(true)
  })

  test('a market filter and project scope keep every drill consistent', async () => {
    const harness = await seeded()
    const us = await report(harness, 'page', COMMUNITY_SEED.us)
    expect(new Set(us.aios.map((aio) => aio.marketId))).toEqual(new Set([COMMUNITY_SEED.us]))
    expect(us.checks[0]?.aios).toBe(2)
    expectDrillsConsistent(us)
    const project = await report(harness, 'project')
    expect(project.scope).toBe('project')
    expect(project.pageId).toBeNull()
    expect(project.pageCount).toBe(1)
    expect(project.checks[0]?.citations).toBe(15)
    expectDrillsConsistent(project)
  })

  test('rejects a page scope with no page, and an unknown page', async () => {
    const harness = await seeded()
    await expect(
      harness.handlers['communities:get']({
        projectId: COMMUNITY_SEED.projectId,
        scope: 'page',
        pageId: null,
        marketId: null
      })
    ).rejects.toThrow(/communities:get/)
    await expect(
      harness.handlers['communities:get']({
        projectId: COMMUNITY_SEED.projectId,
        scope: 'page',
        pageId: 'page-missing',
        marketId: null
      })
    ).rejects.toThrow(/not found/)
  })
})
