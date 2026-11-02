import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { isCited } from '@shared/fix-loop'
import { rollupPageFixes } from '@shared/page-fixes'
import { closeSeeds, envelope, seed } from '../checks/checks.test-helper'
import {
  buildFixLoopStory,
  FIX_LOOP_SEED,
  openFixLoopSeed,
  type FixLoopSeed
} from '../../handlers/fix-loop.test-helper'

/** `fixes:searches` through the real handlers: stored checks only, no network, no Claude. */

describe('fixes:searches on the tracked pages of the fix-loop story', () => {
  const NOW = Date.parse('2026-10-23T15:00:00.000Z')
  const { projectId } = FIX_LOOP_SEED
  let story: FixLoopSeed
  let directory: string

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'citefox-searches-'))
    story = openFixLoopSeed(directory, { now: NOW })
    await buildFixLoopStory(story)
  })

  afterAll(() => {
    story.close()
    rmSync(directory, { recursive: true, force: true })
  })

  test("each page's searches are its latest full check, the page as target", async () => {
    const built = await story.handlers['fixes:searches']({ projectId })
    const ledger = await story.handlers['fixes:ledger']({ projectId })
    expect(built.domain).toBe('textbolt.com')
    expect(built.builtAt).toBe(new Date(NOW).toISOString())
    expect(built.searches.length).toBeGreaterThan(4)
    expect(new Set(built.searches.map((search) => search.state)).size).toBeGreaterThan(1)
    for (const row of ledger.rows) {
      const mine = built.searches.filter((search) => search.sourceId === row.pageId)
      expect(mine.length, row.url).toBe(row.now?.rows.length ?? 0)
      expect(mine.filter((search) => search.state === 'right_page').length, row.url).toBe(
        (row.now?.rows ?? []).filter(isCited).length
      )
      expect(
        mine.every((search) => search.sourceKind === 'page' && search.targetUrl === row.url)
      ).toBe(true)
    }
    expect(new Set(built.searches.map((search) => search.id)).size).toBe(built.searches.length)
    expect(built.sources.map((source) => source.id)).toEqual([
      ...new Set(built.searches.map((search) => search.sourceId))
    ])
    const rollup = rollupPageFixes(built.searches)
    expect(
      rollup.needWork + rollup.targetCited.length + rollup.noAio.length + rollup.notChecked.length
    ).toBe(built.searches.length)
  })

  test('the badge count is the rollup counted in main', async () => {
    const built = await story.handlers['fixes:searches']({ projectId })
    const rollup = rollupPageFixes(built.searches)
    expect(await story.handlers['fixes:pageFixCount']({ projectId })).toEqual({
      pageFixes: rollup.fixes.length,
      needWork: rollup.needWork,
      topicFixes: rollup.fixes.filter((fix) => fix.sources.some((s) => s.kind === 'topic')).length
    })
    expect(rollup.fixes.length).toBeGreaterThan(0)
  })

  test('an unknown project is refused', async () => {
    await expect(story.handlers['fixes:searches']({ projectId: 'nope' })).rejects.toThrow()
  })
})

describe('fixes:searches on a topic', () => {
  afterEach(closeSeeds)

  test("a topic's searches match its own results", async () => {
    const { handlers } = await seed({
      progress: [],
      http(request) {
        return new URL(request.url).searchParams.get('engine') === 'google_ai_overview'
          ? envelope('google-ai-overview.json')
          : envelope('google-page-token.json')
      }
    })
    const base = { projectId: 'proj-1' }
    const draft = await handlers['topics:createDraft']({ ...base, path: 'questions', name: 'Crew' })
    await handlers['topics:importQuestions']({
      ...base,
      draftId: draft.id,
      text: 'How do I send an urgent text to my whole field crew from Outlook?'
    })
    const started = await handlers['topics:start']({ ...base, draftId: draft.id, plan: 'all_now' })
    let job = await handlers['checks:get']({ jobId: started.jobId ?? '' })
    for (let i = 0; i < 200 && (job === null || job.status === 'running'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      job = await handlers['checks:get']({ jobId: started.jobId ?? '' })
    }
    const results = await handlers['topics:results']({
      ...base,
      topicId: started.topicId,
      marketId: null,
      runId: null
    })
    const built = await handlers['fixes:searches'](base)
    const mine = built.searches.filter((search) => search.sourceId === started.topicId)
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.map((search) => [search.promptId, search.state, search.label])).toEqual(
      results.rows.map((row) => [row.promptId, row.state, `Q${row.number}`])
    )
    expect(built.sources.find((source) => source.id === started.topicId)).toEqual({
      id: started.topicId,
      kind: 'topic',
      name: results.topic.name
    })
  })
})
