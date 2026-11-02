import { describe, expect, test } from 'vitest'
import type { BuyerPrompt, CoverageLevel } from '@shared/domain'
import { alertsGaps } from '../mocks/m2/textboltPage'
import {
  chartPopulation,
  chartSegments,
  coverageDrillCount,
  coverageTally,
  faqWordCountMatches,
  filterGapRows,
  groupsSum,
  joinGapRows,
  segmentsSum,
  stageGroups,
  tallySums,
  promptFieldHeight,
  templateProvenanceText,
  templateProvenanceTooltip,
  workOf,
  workDetail,
  workHeadline,
  workSentence,
  type GapFilter,
  type GapListRow
} from './model'
import { PROMPT_COUNT_ERROR, validatePromptCount } from './promptCount'

const EMPTY: GapFilter = { query: '', coverage: [], priority: [] }

function prompt(id: string, position: number, stage: BuyerPrompt['intentStage']): BuyerPrompt {
  return {
    id,
    position,
    label: `Question ${position}`,
    source: 'written_by_user',
    intentStage: stage,
    mappedElement: 'section',
    enabled: true,
    variants: [{ marketId: 'us', language: 'en', text: `Question ${position}`, originalText: null }]
  }
}

function rowsOf(): GapListRow[] {
  const matrix = alertsGaps()
  const stages: BuyerPrompt['intentStage'][] = [
    'problem',
    'solution',
    'problem',
    'trigger',
    'trigger',
    'solution',
    'objection',
    'comparison',
    'problem',
    'objection'
  ]
  return joinGapRows(
    matrix,
    matrix.rows.map((row, index) => prompt(row.promptId, index + 1, stages[index] ?? 'unset'))
  )
}

describe('coverage counts (NFR-14)', () => {
  const rows = rowsOf()

  test('chart segments sum to the population, and each tile matches its drill', () => {
    const tally = coverageTally(rows)
    expect(tally).toEqual({ strong: 5, partial: 4, weak: 1, none: 0, total: 10 })
    expect(tallySums(tally)).toBe(true)
    const segments = chartSegments(tally)
    expect(segments.map((segment) => segment.level)).toEqual(['strong', 'partial', 'weak'])
    expect(segmentsSum(segments, tally.total)).toBe(true)
    for (const level of ['strong', 'partial', 'weak', 'none'] as const) {
      const filter: GapFilter = { ...EMPTY, coverage: [level] }
      expect(filterGapRows(rows, filter)).toHaveLength(coverageDrillCount(rows, filter, level))
      expect(coverageDrillCount(rows, filter, level)).toBe(tally[level])
    }
  })

  test('a search keeps the tile, the chart, and the listed rows on the same population', () => {
    const filter: GapFilter = { ...EMPTY, query: 'outlook' }
    const population = chartPopulation(rows, filter)
    const tally = coverageTally(population)
    expect(tallySums(tally)).toBe(true)
    expect(segmentsSum(chartSegments(tally), tally.total)).toBe(true)
    expect(filterGapRows(rows, filter)).toHaveLength(tally.total)
    const drilled: CoverageLevel = 'strong'
    const drill: GapFilter = { ...filter, coverage: [drilled] }
    expect(filterGapRows(rows, drill)).toHaveLength(coverageDrillCount(rows, drill, drilled))
  })

  test('work numbers are the rows those actions list', () => {
    const work = workOf(rows)
    expect(work.newFaqs).toBe(5)
    expect(work.optionalFaqs).toBe(1)
    expect(work.faqRangeHigh).toBe(6)
    expect(work.sectionEdits).toBe(work.sectionIds.length)
    expect(work.newFaqIds).toHaveLength(work.newFaqs)
    expect(work.optionalIds).toHaveLength(work.optionalFaqs)
    expect(workHeadline(work)).toBe('5–6 new FAQs')
    expect(workDetail(work)).toBe('and edits to 8 sections')
    expect(workSentence(work)).toBe('5–6 new FAQs and 8 section edits')
    const high = rows.filter((row) => row.priority === 'high')
    const highWork = workOf(high)
    expect(highWork.newFaqIds).toHaveLength(highWork.newFaqs)
    expect(highWork.sectionIds).toHaveLength(highWork.sectionEdits)
  })

  test('every FAQ word count matches its answer, and every row has an action', () => {
    for (const row of rows) {
      expect(row.actions.length).toBeGreaterThan(0)
      expect(faqWordCountMatches(row.suggestedFaq)).toBe(true)
    }
  })

  test('stage groups sum to the filtered question list', () => {
    const prompts = rowsOf().map((row) => prompt(row.promptId, row.position, row.stage))
    const groups = stageGroups(prompts)
    expect(groupsSum(groups, prompts.length)).toBe(true)
    const problems = prompts.filter((item) => item.intentStage === 'problem')
    expect(groups.find((group) => group.stage === 'problem')?.prompts).toHaveLength(problems.length)
  })
})

describe('template provenance', () => {
  test('names the template and keeps the id and short hash in the tooltip', () => {
    expect(templateProvenanceText('CiteFox default', false)).toBe('Template: CiteFox default')
    expect(templateProvenanceText('Field buyer', true)).toBe('Template: Field buyer (edited)')
    expect(templateProvenanceText('Field buyer', false)).toBe('Template: Field buyer (default)')
    expect(templateProvenanceText('CiteFox default', false)).toBe('Template: CiteFox default')
    expect(templateProvenanceText('CiteFox default', true)).toBe(
      'Template: CiteFox default (edited)'
    )
    expect(templateProvenanceTooltip('buyer-profile', `4c2e${'b'.repeat(58)}a1`)).toBe(
      'buyer-profile · 4c2e…a1'
    )
    expect(templateProvenanceText('CiteFox default', false)).not.toContain('buyer_profile')
  })
})

describe('question field height', () => {
  test('grows to the measured content so the field does not keep an inner scrollbar', () => {
    expect(promptFieldHeight(0)).toBe('auto')
    expect(promptFieldHeight(-4)).toBe('auto')
    expect(promptFieldHeight(Number.NaN)).toBe('auto')
    expect(promptFieldHeight(48)).toBe('48px')
    expect(promptFieldHeight(72.2)).toBe('73px')
  })
})

describe('question count', () => {
  test('accepts 1 to 1,000 and rejects anything else', () => {
    expect(validatePromptCount('1')).toEqual({ ok: true, count: 1 })
    expect(validatePromptCount('10')).toEqual({ ok: true, count: 10 })
    expect(validatePromptCount('1000')).toEqual({ ok: true, count: 1000 })
    for (const value of ['', '0', '1001', '10.5', 'ten', '-1']) {
      expect(validatePromptCount(value)).toEqual({ ok: false, error: PROMPT_COUNT_ERROR })
    }
  })
})
