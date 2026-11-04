import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { IndexCheckRun } from '@shared/ipc'
import {
  FIX_LOOP_SEED,
  openFixLoopSeed,
  type FixLoopSeed,
  type FixLoopSeedOptions
} from '../../handlers/fix-loop.test-helper'
import { usageMonth } from '../../keys/present'
import type { HttpResponse } from '../../providers/http'
import { latestIndexChecks } from '../../storage/fix-loop-records'
import { getKeyUsageForMonth } from '../../storage/key-usage'
import { closeProjectDatabase } from '../../storage/project-files'
import { writeProjectScheduleCap } from '../../storage/project-schedule'
import { addKeyUsage } from '../../storage/records'
import { indexStateOf, siteTarget } from './index-check'

const FIXTURES = join(process.cwd(), 'src/main/engine/fix-loop/fixtures')
const NOW = Date.parse('2026-10-23T15:00:00.000Z')
const { projectId, keyId } = FIX_LOOP_SEED
const { alerts, pricing, schedule, gmail } = FIX_LOOP_SEED.pages

const opened: FixLoopSeed[] = []
const directories: string[] = []

afterEach(() => {
  for (const seed of opened.splice(0)) seed.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** A seed whose SerpApi answers come from recorded bodies: `site:` target → fixture file. */
function recordedSeed(
  sites: Readonly<Record<string, string>>,
  options: FixLoopSeedOptions = {}
): { seed: FixLoopSeed; queries: string[] } {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-index-'))
  directories.push(directory)
  const queries: string[] = []
  const seed = openFixLoopSeed(directory, {
    now: NOW,
    ...options,
    http: {
      async request(request) {
        const url = new URL(request.url)
        if (url.searchParams.get('engine') === 'google_ai_overview') {
          return recorded('site-overview-follow-up.json')
        }
        const query = url.searchParams.get('q') ?? ''
        queries.push(query)
        return recorded(sites[query.replace(/^site:/, '')] ?? 'site-no-results.json')
      }
    }
  })
  opened.push(seed)
  return { seed, queries }
}

function recorded(name: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

function used(seed: FixLoopSeed): number {
  const month = usageMonth(seed.host.now())
  let total = 0
  for (const key of getKeyUsageForMonth(seed.storage.db, month).keys) {
    for (const project of key.projects)
      if (project.projectId === projectId) total += project.searches
  }
  return total
}

async function run(seed: FixLoopSeed, pageIds: readonly string[]): Promise<IndexCheckRun> {
  const preview = await seed.handlers['fixes:indexPreview']({ projectId, pageIds: [...pageIds] })
  return seed.handlers['fixes:checkIndex']({
    projectId,
    pageIds: [...pageIds],
    confirmedSearches: preview.searchesMax
  })
}

describe('fixes:checkIndex on recorded SerpApi bodies', () => {
  test('a result for the page (www, no trailing slash) is indexed', async () => {
    const { seed, queries } = recordedSeed({ [siteTarget(alerts.url)]: 'site-indexed.json' })
    const result = await run(seed, [alerts.id])
    expect(queries).toEqual(['site:textbolt.com/blog/how-to-set-up-text-alerts-for-business'])
    expect(result).toMatchObject({ searchesUsed: 1, stoppedReason: null })
    expect(result.results).toEqual([
      {
        pageId: alerts.id,
        check: {
          state: 'indexed',
          checkedAt: expect.stringMatching(/^2026-10-23T15:00:/),
          message: null
        }
      }
    ])
    const db = seed.openProject()
    try {
      expect(latestIndexChecks(db).get(alerts.id)).toMatchObject({
        url: alerts.url,
        state: 'indexed',
        searches: 1
      })
    } finally {
      closeProjectDatabase(db)
    }
  })

  test('"no results" and results for other pages are both not indexed', async () => {
    const { seed } = recordedSeed({
      [siteTarget(schedule.url)]: 'site-no-results.json',
      [siteTarget(gmail.url)]: 'site-other-page.json'
    })
    const result = await run(seed, [schedule.id, gmail.id])
    expect(result.results.map((item) => [item.pageId, item.check.state])).toEqual([
      [schedule.id, 'not_indexed'],
      [gmail.id, 'not_indexed']
    ])
    expect(result.searchesUsed).toBe(2)
  })

  test('an overview on the site search costs its follow-up search too', async () => {
    const { seed } = recordedSeed({ [siteTarget(pricing.url)]: 'site-overview-token.json' })
    const before = used(seed)
    const result = await run(seed, [pricing.id])
    expect(result.results[0]?.check.state).toBe('indexed')
    expect(result.searchesUsed).toBe(2)
    expect(used(seed)).toBe(before + 2)
  })

  test('a rejected key is unknown, and the run stops when no key is left', async () => {
    const { seed, queries } = recordedSeed({ [siteTarget(alerts.url)]: 'site-invalid-key.json' })
    const result = await run(seed, [alerts.id, schedule.id])
    expect(result.results).toEqual([
      {
        pageId: alerts.id,
        check: {
          state: 'unknown',
          checkedAt: expect.any(String),
          message: 'SerpApi rejected this key.'
        }
      }
    ])
    expect(result.stoppedReason).toBe(
      'No search key can search right now (out of searches or refused). The rest were not checked.'
    )
    expect(queries).toHaveLength(1)
    expect(result.searchesUsed).toBe(1)
  })
})

describe('fixes:indexPreview accounting', () => {
  test('the cap room and the key room bound what is left', async () => {
    const { seed } = recordedSeed({})
    const month = usageMonth(seed.host.now())
    addKeyUsage(seed.storage.db, {
      id: 'usage-1',
      keyId,
      projectId,
      month,
      searches: 30,
      calls: 30,
      tokens: 0
    })
    const db = seed.openProject()
    try {
      writeProjectScheduleCap(db, { cap: 33, capRule: 'pause', dedicatedKeyId: null })
    } finally {
      closeProjectDatabase(db)
    }
    const two = await seed.handlers['fixes:indexPreview']({
      projectId,
      pageIds: [alerts.id, schedule.id]
    })
    expect(two).toEqual({
      pages: 2,
      searchesMin: 2,
      searchesMax: 4,
      left: 3,
      canRun: false,
      reason: 'This check needs up to 4 searches and 3 are left this month. No search was sent.'
    })
    const one = await seed.handlers['fixes:indexPreview']({ projectId, pageIds: [alerts.id] })
    expect(one).toMatchObject({ searchesMax: 2, left: 3, canRun: true })
    await expect(
      seed.handlers['fixes:checkIndex']({ projectId, pageIds: [alerts.id], confirmedSearches: 1 })
    ).rejects.toThrow('The number of searches changed')
    const result = await seed.handlers['fixes:checkIndex']({
      projectId,
      pageIds: [alerts.id],
      confirmedSearches: 2
    })
    expect(result.searchesUsed).toBe(1)
    expect(used(seed)).toBe(31)

    // Without a cap, the key's own room is the bound: 250 a month, 205 used elsewhere.
    addKeyUsage(seed.storage.db, {
      id: 'usage-2',
      keyId,
      projectId: null,
      month,
      searches: 174,
      calls: 174,
      tokens: 0
    })
    const db2 = seed.openProject()
    try {
      writeProjectScheduleCap(db2, { cap: null, capRule: 'pause', dedicatedKeyId: null })
    } finally {
      closeProjectDatabase(db2)
    }
    const keyBound = await seed.handlers['fixes:indexPreview']({ projectId, pageIds: [alerts.id] })
    expect(keyBound.left).toBe(250 - 205)
  })

  test('no key, or no page with an address, cannot run', async () => {
    const { seed } = recordedSeed({}, { serpKey: false })
    const noKey = await seed.handlers['fixes:indexPreview']({ projectId, pageIds: [alerts.id] })
    expect(noKey).toMatchObject({
      canRun: false,
      reason: 'Turn on a search key in Connections first. No search was sent.'
    })
    await expect(
      seed.handlers['fixes:checkIndex']({ projectId, pageIds: [alerts.id], confirmedSearches: 2 })
    ).rejects.toThrow('Turn on a search key')
    const { seed: keyed } = recordedSeed({})
    const none = await keyed.handlers['fixes:indexPreview']({ projectId, pageIds: ['page-gone'] })
    expect(none).toMatchObject({ pages: 0, searchesMax: 0, canRun: false })
    expect(none.reason).toContain('Pick at least one page with an address')
  })
})

describe('reading a site search', () => {
  test('the site target drops the scheme and the trailing slash', () => {
    expect(siteTarget('https://textbolt.com/pricing/')).toBe('textbolt.com/pricing')
    expect(siteTarget('http://www.textbolt.com/')).toBe('www.textbolt.com')
  })

  test('an unreadable body is unknown, an empty result list is not indexed', () => {
    expect(
      indexStateOf({ rawSearchJson: null, message: 'The SerpApi search timed out.' }, alerts.url)
    ).toEqual({ state: 'unknown', message: 'The SerpApi search timed out.' })
    expect(
      indexStateOf({ rawSearchJson: '{"organic_results": []}', message: null }, alerts.url)
    ).toEqual({ state: 'not_indexed', message: null })
    expect(
      indexStateOf(
        {
          rawSearchJson: JSON.stringify({ organic_results: [{ link: `${alerts.url}#steps` }] }),
          message: null
        },
        alerts.url
      )
    ).toEqual({ state: 'indexed', message: null })
  })
})
