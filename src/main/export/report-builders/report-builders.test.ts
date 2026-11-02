import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  COMMUNITY_SEED,
  fixtureResponse,
  seedCommunitiesProject,
  type SeededHarness
} from '../../communities/seed.test-helper'
import { closeSeeds } from '../../engine/checks/checks.test-helper'
import { createCheckEngine } from '../../engine/checks/engine'
import { fixtureClaude, seedSentiment } from '../../engine/sentiment/sentiment.test-helper'
import type { AppStorage } from '../../storage/app-storage'
import { drillIssues } from '../model/consistency'
import { sampleReportRequest } from '../model/sample.test-helper'
import type { ReportModel } from '../model/types'
import { NOTHING_TO_REPLY } from '../sections/sources'
import { loadReportModel } from '../service'
import { createStorageExportSource } from '../source'
import { storageReportBuilders } from '.'

/**
 * The production section builders (export IPC and scheduled reports) on seeded
 * projects: the reputation and sources sections are filled from brand sentiment and
 * the Communities caches, and every drill still lists exactly its number (NFR-14).
 */

const NOW = new Date('2026-10-20T12:00:00.000Z')
const opened: Array<{ harness: SeededHarness; dir: string }> = []

afterEach(() => {
  closeSeeds()
  for (const { harness, dir } of opened.splice(0)) {
    harness.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

async function modelFor(
  storage: AppStorage,
  request: Parameters<typeof sampleReportRequest>[0]
): Promise<ReportModel> {
  const deps = {
    app: storage.db,
    projectsDirectory: storage.paths.projectsDirectory,
    now: () => NOW
  }
  const loaded = await loadReportModel({
    request: sampleReportRequest(request),
    source: createStorageExportSource(deps),
    now: () => NOW,
    builders: storageReportBuilders(deps, request?.projectId ?? 'proj-1')
  })
  if (!loaded.ok) throw new Error(loaded.reason)
  return loaded.model
}

describe('production report section builders', () => {
  test('reputation comes from brand sentiment, and every drill matches its number', async () => {
    const seeded = await seedSentiment({})
    const engine = createCheckEngine({
      ...seeded.checkDeps,
      claude: fixtureClaude(),
      readSentiment: true
    })
    await engine.start({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    await engine.reportsIdle()

    const model = await modelFor(seeded.storage, {
      projectId: 'proj-1',
      scope: 'page',
      pageIds: ['page-1'],
      marketIds: ['mkt-us']
    })
    const reputation = model.reputation
    expect(reputation.empty).toBeNull()
    expect(reputation.analysed).toBeGreaterThan(0)
    expect(reputation.answers.map((answer) => [answer.prompt, answer.rank])).toEqual([
      ['TextBolt reviews', '#1 of 3 brands named'],
      ['TextBolt pricing', '#2 of 2 brands named']
    ])
    expect(reputation.positive.n + reputation.neutral.n + reputation.negative.n).toBe(
      reputation.analysed
    )
    expect(reputation.issues.map((issue) => issue.claim)).toContain(
      'TextBolt pricing starts at $19 a month for 500 texts.'
    )
    expect(reputation.trend.length).toBeGreaterThan(0)
    expect(drillIssues(model)).toEqual([])
  })

  test('sources carry YouTube channels and views and Reddit reply status from Communities', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'citefox-report-builders-'))
    const harness = await seedCommunitiesProject(dir, {
      cacheVideoDetails: true,
      http: (request) =>
        request.url.includes('/comments/1def45y.json') ||
        request.url.includes('/comments/1abc23x.json')
          ? fixtureResponse('reddit-thread-archived.json')
          : null
    })
    opened.push({ harness, dir })
    const request = {
      projectId: COMMUNITY_SEED.projectId,
      scope: 'project' as const,
      pageIds: [],
      marketIds: [COMMUNITY_SEED.us, COMMUNITY_SEED.uk]
    }
    const before = await modelFor(harness.storage, request)
    expect(before.sources.reddit.threads.map((thread) => thread.replyStatus)).toEqual([
      'unchecked',
      'unchecked'
    ])

    await harness.handlers['communities:checkThreads']({
      projectId: COMMUNITY_SEED.projectId,
      urls: null,
      force: false
    })
    const model = await modelFor(harness.storage, request)
    const sources = model.sources
    expect(sources.empty).toBeNull()
    expect(sources.youtube.videos.length).toBeGreaterThan(0)
    expect(sources.youtube.videos.every((video) => video.views !== null)).toBe(true)
    expect(sources.youtube.detailsMissing).toBe(false)
    expect(sources.youtube.channels.map((row) => row.channel).sort()).toEqual([
      'Ops Shortcuts',
      'SmallBiz Tech Help'
    ])
    expect(sources.reddit.threads.map((thread) => thread.replyStatus)).toEqual([
      'archived',
      'archived'
    ])
    expect(sources.reddit.sentence).toBe(NOTHING_TO_REPLY)
    // Counts and drills are the base section's: enriching never changes a number.
    expect(sources.total).toBe(before.sources.total)
    expect(sources.youtube.videos.map((video) => video.prompts)).toEqual(
      before.sources.youtube.videos.map((video) => video.prompts)
    )
    expect(drillIssues(model)).toEqual([])
  })
})
