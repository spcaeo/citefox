import { afterEach, describe, expect, test } from 'vitest'
import { TEXTBOLT_TOPIC_CHECKS } from '@shared/fixtures/textbolt-topic'
import { pagesView as sharedPagesView } from '@shared/pages-view'
import { isCitedState } from '@shared/topic-scoring'
import { pagesView } from '../../../renderer/src/topics/views/model/pages'
import {
  resultOfStatus,
  resultOfTopicState
} from '../../../renderer/src/topics/views/model/results'
import {
  searchesOfQuestions,
  searchesOfTopic
} from '../../../renderer/src/topics/views/model/searches'
import { closeSeeds, seed } from '../checks/checks.test-helper'
import { getProject } from '../../storage/records'
import { seedTextboltTopic } from '../../topics/fixture-seed'

afterEach(() => {
  closeSeeds()
})

/**
 * One fixture (the TextBolt topic, seeded as real checks), read by every screen that
 * counts "cited": the topic page, Questions, Citations, Check history and Summary. A
 * search is cited when its AI Overview links a page of the site; each screen must agree.
 */
describe('one cited rule on every screen (audit2 #1)', () => {
  test('topic, Questions, Citations, Check history and Summary count the same searches', async () => {
    const seeded = await seed({ progress: [], http: () => ({ status: 500, body: '{}' }) })
    const project = getProject(seeded.storage.db, 'proj-1')
    if (project === null) throw new Error('no project')
    const { topicId } = seedTextboltTopic(seeded.projectDb, project, {
      now: () => new Date('2026-10-19T12:00:00.000Z')
    })
    const { handlers } = seeded

    // The topic page: its rows and the cited count of its latest check.
    const results = await handlers['topics:results']({
      projectId: 'proj-1',
      topicId,
      marketId: null,
      runId: null
    })
    const citedIds = new Set(
      results.rows.filter((row) => isCitedState(row.state)).map((row) => row.promptId)
    )
    expect(citedIds.size).toBeGreaterThan(0)

    // Questions: every topic row has the topic's result and the page Google cited.
    const list = await handlers['questions:list']({ projectId: 'proj-1', marketId: null })
    const questionRows = list.rows.filter((row) => row.sourceId === topicId)
    expect(questionRows).toHaveLength(results.rows.length)
    const byId = new Map(questionRows.map((row) => [row.promptId, row]))
    for (const row of results.rows) {
      const question = byId.get(row.promptId)
      expect(resultOfStatus(question?.status ?? null), row.text).toBe(resultOfTopicState(row.state))
      expect(question?.citedOwnUrl ?? null, row.text).toBe(row.citedOwnUrl)
    }

    // A page's "Cited for" and "Still to win" are the same on the topic and on Questions.
    const topicPages = pagesView(searchesOfTopic(results))
    const questionPages = pagesView(searchesOfQuestions(questionRows, list.sources))
    const counts = (view: ReturnType<typeof pagesView>): Map<string | null, number[]> =>
      new Map(view.pages.map((page) => [page.url, [page.citedFor, page.stillToWin]]))
    expect(counts(questionPages)).toEqual(counts(topicPages))
    expect(questionPages.cited).toBe(citedIds.size)

    // Citations › Pages (every search of the project): the topic's own searches give the
    // same "Cited for" per page.
    const projectSearches = await handlers['fixes:searches']({ projectId: 'proj-1' })
    const citations = sharedPagesView(
      projectSearches.searches.filter((search) => search.sourceId === topicId)
    )
    const citedFor = new Map(
      citations.pages
        .filter((page) => page.citedFor.length > 0)
        .map((page) => [page.url, page.citedFor.length])
    )
    expect(citedFor).toEqual(
      new Map(
        topicPages.pages
          .filter((page) => page.citedFor > 0)
          .map((page) => [page.url, page.citedFor])
      )
    )

    // Check history: each topic check's Cited is the topic's own count of that check.
    const history = await handlers['history:listProject']({ projectId: 'proj-1' })
    const topicChecks = history.checks.filter((check) => check.pageId === topicId)
    expect(topicChecks).toHaveLength(TEXTBOLT_TOPIC_CHECKS.length)
    for (const point of results.progress) {
      const check = topicChecks.find((item) => item.runId === point.runId)
      expect(check?.cited, point.finishedAt).toBe(
        (point.questions?.cited ?? 0) + (point.keywords?.cited ?? 0)
      )
    }
    const latest = topicChecks.find((check) => check.runId === results.progress.at(-1)?.runId)
    expect(latest?.cited).toBe(citedIds.size)

    // Summary: the topic's searches it counts as cited are the topic's cited searches.
    const overview = await handlers['visibility:overview']({
      projectId: 'proj-1',
      period: '90d',
      marketId: null,
      vs: null
    })
    const summaryCited = overview.questions
      .filter((item) => item.pageId === topicId && item.you === 'cited')
      .map((item) => item.promptId)
    expect(new Set(summaryCited)).toEqual(citedIds)
  })
})
