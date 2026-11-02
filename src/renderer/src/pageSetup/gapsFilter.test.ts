import { describe, expect, it } from 'vitest'
import type { DrillScope } from '../drill'
import { coverageDrill, coverageTotalDrill, workDrill } from './gapsDrills'
import { NO_GAP_FILTER, focusedPromptId, soleLevel, toggleIn } from './gapsFilter'
import { coverageDrillCount, coverageTally, filterGapRows, workOf, type GapListRow } from './model'

const SCOPE: DrillScope = {
  pageId: 'page-1',
  marketId: 'mkt-uk',
  runId: null,
  marketLabel: '',
  checkDateLabel: '',
  brand: '',
  domain: ''
}

function row(index: number, patch: Partial<GapListRow>): GapListRow {
  return {
    id: `row-${index}`,
    promptId: `prompt-${index}`,
    position: index,
    label: `Question **${index}**`,
    text: 'text',
    stage: 'problem',
    source: 'title_meta_h1',
    coverage: 'weak',
    whereCovered: [],
    currentContent: '',
    whatToUpdate: '',
    mainGap: '',
    priority: 'high',
    actions: ['update_existing'],
    suggestedFaq: null,
    done: false,
    claudeFaq: null,
    faqEdited: false,
    status: 'open',
    publishedUrl: null,
    ...patch
  }
}

const ROWS: GapListRow[] = [
  row(1, { coverage: 'strong', actions: ['none'], stage: 'solution' }),
  row(2, { coverage: 'partial', actions: ['new_faq', 'small_update'] }),
  row(3, { coverage: 'weak', actions: ['optional_faq'], source: 'objection' }),
  row(4, { coverage: 'none', actions: ['new_faq'], stage: 'comparison' })
]

describe('Content gaps filters and drills', () => {
  it('stage, source and action filters narrow the rows', () => {
    expect(filterGapRows(ROWS, { ...NO_GAP_FILTER, stage: ['problem'] })).toHaveLength(2)
    expect(filterGapRows(ROWS, { ...NO_GAP_FILTER, source: ['objection'] })).toHaveLength(1)
    expect(filterGapRows(ROWS, { ...NO_GAP_FILTER, action: ['new_faq'] })).toHaveLength(2)
    expect(filterGapRows(ROWS, NO_GAP_FILTER)).toHaveLength(4)
  })

  it('coverage drills list exactly the tile count, and the total adds up', () => {
    for (const level of ['strong', 'partial', 'weak', 'none'] as const) {
      const drill = coverageDrill(level, ROWS, SCOPE)
      expect(drill.items).toHaveLength(coverageDrillCount(ROWS, NO_GAP_FILTER, level))
      expect(drill.items).toHaveLength(coverageTally(ROWS)[level])
    }
    expect(coverageTotalDrill(ROWS, SCOPE).items).toHaveLength(4)
  })

  it('work drills match the work card counts and rows open Question detail in the market', () => {
    const work = workOf(ROWS)
    expect(workDrill('new_faq', ROWS, SCOPE).items).toHaveLength(work.newFaqs)
    expect(workDrill('faqs', ROWS, SCOPE).items).toHaveLength(work.faqRangeHigh)
    expect(workDrill('sections', ROWS, SCOPE).items).toHaveLength(work.sectionEdits)
    const first = coverageDrill('partial', ROWS, SCOPE).items[0]
    expect(first?.primary).toBe('2. Question 2')
    expect(first?.target).toEqual({
      kind: 'prompt',
      pageId: 'page-1',
      promptId: 'prompt-2',
      marketId: 'mkt-uk'
    })
  })

  it('helpers', () => {
    expect(toggleIn(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleIn(['a', 'b'], 'a')).toEqual(['b'])
    expect(soleLevel(['strong'], 'strong')).toEqual([])
    expect(soleLevel([], 'weak')).toEqual(['weak'])
    expect(focusedPromptId('row:prompt-3')).toBe('prompt-3')
    expect(focusedPromptId('row:')).toBeNull()
    expect(focusedPromptId('other')).toBeNull()
    expect(focusedPromptId(null)).toBeNull()
  })
})
