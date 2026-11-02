import { describe, expect, test } from 'vitest'
import type { PromptCheckStatus, TopicRowState } from '@shared/domain'
import {
  textboltTopicResults,
  TEXTBOLT_TOPIC_ID,
  TEXTBOLT_TOPIC_PROJECT_ID
} from '@shared/fixtures/textbolt-topic'
import { targetRate } from '@shared/topic-scoring'
import type { QuestionRow } from '@shared/ipc'
import {
  questionRow,
  questionsList,
  topicSummary
} from '../../../questions/questions.fixtures.test-helper'
import { topicGoalLabel } from '../../../shell/sidebarTopics'
import { topicLines } from '../../list/model'
import { createMockTopicResultsSource } from '../../results/source/mock'
import { dashboard } from './dashboard'
import { totalsOf } from './results'
import { searchesOfTopic } from './searches'

/** How the Questions list rolls up each topic state (main's `topicStatus`, one to one). */
const STATUS: Readonly<Record<TopicRowState, PromptCheckStatus | null>> = {
  right_page: 'page_cited',
  other_page: 'other_own_page',
  not_cited: 'not_cited',
  no_page: 'not_cited',
  no_aio: 'no_aio',
  failed: 'error',
  not_checked: null
}

/**
 * One sample topic (the TextBolt "text alerts" fixture), seen by every screen that shows
 * its headline: the sidebar (`topics:list`), the Topics list, Tree, Grid and KPIs (the
 * Questions rows), the topic header and its views (`topics:results`), and Progress.
 */
describe('a topic has one headline number', () => {
  test('right page cited, of searches with an AI Overview: the same in every place', async () => {
    const results = textboltTopicResults()
    const topicId = TEXTBOLT_TOPIC_ID
    const rows: QuestionRow[] = results.rows.map((row) => {
      const status = STATUS[row.state]
      return questionRow({
        promptId: row.promptId,
        sourceId: topicId,
        text: row.text,
        promptKind: row.kind,
        status,
        overview: status === null || status === 'error' ? null : status !== 'no_aio',
        cited: status === 'page_cited' || status === 'other_own_page'
      })
    })
    const topics = [topicSummary({ id: topicId, name: results.topic.name })]

    // The rule itself, on the topic's rows.
    const expected = targetRate(results.rows)
    expect(expected).not.toBeNull()

    // Sidebar: `topics:list` gives the headline, the sidebar prints it.
    const [listed] = await createMockTopicResultsSource().list(TEXTBOLT_TOPIC_PROJECT_ID)
    expect(listed?.targetPct).toBe(expected)
    expect(topicGoalLabel(listed?.targetPct ?? null)).toBe(`${expected}%`)

    // Topic header (SummaryCard) and the topic's Tree, Grid and List totals.
    expect(totalsOf(searchesOfTopic(results)).targetPct).toBe(expected)

    // Topics: the List's "Target cited" column, and the Tree/Grid/KPI board.
    const list = questionsList({ rows })
    expect(topicLines(topics, list)[0]?.totals.targetPct).toBe(expected)
    const board = dashboard(topics, [], rows)
    expect(board.topics[0]?.totals.targetPct).toBe(expected)
    expect(board.kpis.targetPct).toBe(expected)

    // Progress: the latest full check's headline point.
    const lastFull = results.progress.filter((point) => !point.partial).at(-1)
    expect(lastFull?.target?.rate).toBe(expected)

    // The questions goal is a different sum, named apart as "Questions goal".
    expect(results.goals.questions.rate).not.toBe(expected)
  })
})
