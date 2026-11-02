import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Ajv from 'ajv'
import { describe, expect, test } from 'vitest'
import { textboltTopicResults } from '@shared/fixtures/textbolt-topic'
import { prepareExport } from '../prepare'
import { buildReportBlocks } from '../pdf/report-model'
import { renderHtmlReport } from '../html'
import { buildReportTables } from '../report-tables'
import { reportSchemas } from '../schema/report-schema'
import { DrillRegistry } from './drills'
import { reportModelFor } from './from-dataset'
import { richSampleDataset } from './sample-dataset.test-helper'
import { SAMPLE_BUILT_AT, sampleReportModel, sampleReportRequest } from './sample.test-helper'
import { buildTopicCoverageTopic, topicCoverageSection } from './topic-coverage'
import type { ReportModel, TopicCount, TopicCoverageTopic } from './types'

const SCHEMA_DIR = resolve('src/main/export/schema')

/** Report rows for every fixture prompt in US, so every topic number can drill. */
function fullContext(): {
  registry: DrillRegistry
  rows: { id: string; promptId: string; pageId: string; marketId: string }[]
} {
  const results = textboltTopicResults()
  return {
    registry: new DrillRegistry(),
    rows: results.rows.map((row, index) => ({
      id: `r${index + 1}`,
      promptId: row.promptId,
      pageId: results.topic.id,
      marketId: results.topic.marketId
    }))
  }
}

function countsOf(topic: TopicCoverageTopic): TopicCount[] {
  return [
    ...topic.goals.flatMap((goal) => [
      goal.withAio,
      goal.cited,
      goal.rightPage,
      goal.otherPage,
      goal.named,
      goal.noAio,
      goal.failed
    ]),
    ...topic.stages.flatMap((stage) => [stage.aio, stage.cited]),
    ...topic.todo.map((group) => group.count),
    ...Object.values(topic.keywords).flatMap((rows) =>
      rows.flatMap((row) => [row.keywords, row.aio, row.cited, row.named])
    )
  ]
}

/** A model with a topic coverage section for the TextBolt topic fixture. */
function topicModel(): ReportModel {
  const dataset = richSampleDataset()
  const request = sampleReportRequest()
  const prepared = prepareExport(dataset, request)
  return reportModelFor(dataset, prepared.pages, request, SAMPLE_BUILT_AT, {
    topicCoverage: (context) =>
      topicCoverageSection([
        buildTopicCoverageTopic(textboltTopicResults(), null, context, 'US · EN')
      ])
  })
}

describe('topic coverage section', () => {
  test('every topic number drills to exactly n rows when the report holds the prompts', () => {
    const { registry, rows } = fullContext()
    const topic = buildTopicCoverageTopic(
      textboltTopicResults(),
      null,
      { rows, count: (token, ids) => registry.count(token, ids) },
      'US · EN'
    )
    const drills = registry.toRecord()
    for (const count of countsOf(topic)) {
      expect(count.drill).not.toBeNull()
      expect(drills[count.drill ?? '']?.length).toBe(count.n)
    }
    const questions = topic.goals.find((goal) => goal.kind === 'question')
    expect(questions?.cited.n).toBe(11)
    expect(questions?.withAio.n).toBe(26)
    expect(questions?.toReachBand).toBe(2)
    expect(topic.todo.map((group) => group.state)).toEqual([
      'not_cited',
      'other_page',
      'no_page',
      'right_page'
    ])
    for (const group of topic.todo) expect(group.rows).toHaveLength(group.count.n)
  })

  test('numbers the report does not hold are plain, with the same n', () => {
    const topic = buildTopicCoverageTopic(
      textboltTopicResults(),
      null,
      { rows: [], count: () => ({ n: -1, drill: 'never' }) },
      'US · EN'
    )
    for (const count of countsOf(topic)) {
      // An empty list holds no prompt the report lacks, so only non-zero numbers go plain.
      if (count.n !== -1) expect(count.drill).toBeNull()
      expect(count.n === -1 || count.n > 0).toBe(true)
    }
    expect(topic.goals.find((goal) => goal.kind === 'question')?.cited.n).toBe(11)
  })

  test('the executive summary and next actions come from saved data, else from the numbers', () => {
    const context = { rows: [], count: () => ({ n: 0, drill: null }) }
    const built = buildTopicCoverageTopic(textboltTopicResults(), null, context, 'US · EN')
    expect(built.executiveSaved).toBe(false)
    expect(built.executive).toContain('Buyer questions: 11 of 26 cited (42%), goal 50–70%')
    expect(built.nextActions).toHaveLength(3)
    const saved = buildTopicCoverageTopic(
      textboltTopicResults(),
      {
        line: 'Since Oct 5: 4 more cited.',
        executive: 'AI Overviews cite TextBolt in 11 of 26 buyer questions.',
        actions: [{ text: 'Strengthen the multi-location page for Q6.', verify: null }],
        createdAt: '2026-10-19T09:20:00.000Z'
      },
      context,
      'US · EN'
    )
    expect(saved.executiveSaved).toBe(true)
    expect(saved.executive).toBe('AI Overviews cite TextBolt in 11 of 26 buyer questions.')
    expect(saved.nextActions).toEqual([
      { text: 'Strengthen the multi-location page for Q6.', verify: null }
    ])
  })

  test('a page export leaves the section out even when it is selected', () => {
    const model = sampleReportModel()
    expect(model.sections).not.toContain('topic_coverage')
    expect('topicCoverage' in model).toBe(false)
    const html = renderHtmlReport(model, { secrets: [] })
    // The section element and its anchor are absent (CSS may still name the class).
    expect(html).not.toMatch(/<section[^>]*data-section="topic_coverage"/u)
    expect(html).not.toMatch(/id="[^"]*topic[-_]coverage[^"]*"/u)
  })

  test('HTML, PDF, tables and the JSON schema carry the section', () => {
    const model = topicModel()
    expect(model.sections[1]).toBe('topic_coverage')
    const html = renderHtmlReport(model, { secrets: [] })
    expect(html).toContain('id="sec-topic-coverage"')
    expect(html).toContain('Goal per kind')
    expect(html).toContain('Keyword universe')
    // Mock-up markup: KPI row, goal bars with ticks, win odds chips, one count per to-do title.
    expect(html).toContain('<div class="kpis">')
    expect(html).toContain('<p class="kpi-label">To reach the band</p>')
    expect(html).toContain('<div class="goal-track">')
    expect(html).toMatch(
      /<div class="goal-ticks num"><span style="left:0%">0<\/span>.*class="goal-now"/u
    )
    expect(html).toMatch(
      /<span class="chip (tone-positive|v-partly|s-none)">(High|Medium|Low)<\/span>/u
    )
    expect(html).not.toMatch(/Page exists, not cited · \d/u)
    for (const match of html.matchAll(/data-drill="([^"]+)" data-n="(\d+)"/g)) {
      const token = (match[1] ?? '').replaceAll('&amp;', '&')
      expect(model.drills[token]?.length, token).toBe(Number(match[2]))
    }
    const { blocks } = buildReportBlocks(
      model,
      { pageSize: 'letter', charts: true, preparedFor: null, hideBranding: false },
      { secrets: [] }
    )
    expect(
      blocks.some((block) => block.kind === 'section' && block.title === 'Topic coverage')
    ).toBe(true)
    const ids = buildReportTables(model).map((table) => table.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'topic-summary',
        'topic-goals',
        'topic-stages',
        'topic-todo',
        'topic-kw-groups',
        'topic-kw-intent',
        'topic-kw-funnel',
        'topic-kw-page-type'
      ])
    )
    const todo = buildReportTables(model).find((table) => table.id === 'topic-todo')
    const open = model.topicCoverage?.topics[0]?.todo.reduce((sum, g) => sum + g.rows.length, 0)
    expect(todo?.rows).toHaveLength(open ?? -1)

    const ajv = new Ajv({ allErrors: true, strict: true })
    for (const file of Object.keys(reportSchemas())) {
      ajv.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')) as object)
    }
    const check = ajv.getSchema('https://citefox.app/schema/citefox-report.v2.json')
    expect(check).toBeDefined()
    const ok = check?.(JSON.parse(JSON.stringify(model)))
    expect(check?.errors ?? []).toEqual([])
    expect(ok).toBe(true)
  })
})
