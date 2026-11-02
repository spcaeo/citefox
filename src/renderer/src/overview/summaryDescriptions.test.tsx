// @vitest-environment happy-dom
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VERDICT_SETS } from '@shared/report/verdict'
import type { QuestionEngineStatuses } from '@shared/ipc'
import type { FixSearch, PageFix } from '@shared/page-fixes'
import { DrillDrawer, type ItemDrill } from '../drill'
import { RESULT_BUCKETS } from '../ui/resultTones'
import { kpiDrill, trackedDrill, verdictDrill } from './compare'
import {
  citedSiteDrill,
  engineDrill,
  needsWorkDrill,
  ownLinksShareDrill,
  resultDrill,
  shareLinksDrill,
  type EngineSet
} from './drills'
import { QUESTION_NOUN } from './model'
import {
  fixSearchesDrill,
  pageFixesDrill,
  trendDrill,
  weekChangeDrill,
  weekDrill
} from './moreDrills'
import { overview, WEEKS } from './summaryFixture.test-helper'

/**
 * Every drill Summary can open says what its number counts: the drawer's
 * "What this number counts" card is never an empty heading.
 */

const search: FixSearch = {
  id: 't1|a',
  sourceKind: 'topic',
  sourceId: 't1',
  sourceName: 'Gateway',
  promptId: 'a',
  marketId: 'mkt-us',
  runId: 'run-9',
  label: 'Q1',
  kind: 'question',
  text: 'search a',
  state: 'not_cited',
  targetPageId: null,
  targetUrl: 'https://textbolt.com/pricing',
  citedOwnUrl: null,
  citedInstead: [],
  winOdds: null,
  checkedAt: '2026-10-22T09:00:00.000Z'
}
const fix: PageFix = {
  id: 'pf1',
  kind: 'improve',
  page: { pageId: null, url: 'https://textbolt.com/pricing' },
  citedUrl: null,
  proposed: null,
  sources: [{ id: 't1', kind: 'topic', name: 'Gateway', searches: 1 }],
  searches: [search],
  bestOdds: null,
  avgOdds: null
}
const statuses: QuestionEngineStatuses[] = [
  { pageId: 't1', promptId: 'q1', marketId: 'mkt-us', statuses: { chatgpt: 'cited' } }
]
const ENGINE_SETS: readonly EngineSet[] = [
  'checked',
  'answered',
  'cited',
  'named',
  'unavailable',
  'no_answer',
  'gained',
  'lost',
  'moved'
]

function everyDrill(): ItemDrill[] {
  const data = overview({ topSite: { name: 'TextUs', count: 0 } })
  const site = {
    name: 'TextUs',
    domain: 'textus.com',
    count: 0,
    own: false,
    competitor: true,
    before: null,
    keys: []
  }
  return [
    ...VERDICT_SETS.map((set) => verdictDrill(data, { set, n: 0, label: set })),
    ...(['aio', 'cited', 'named'] as const).map((set) => kpiDrill(data, set)),
    ...(['aio', 'cited', 'named'] as const).map((set) => trendDrill(data, set)),
    trackedDrill(data),
    shareLinksDrill(data, 'all markets'),
    ownLinksShareDrill(data, 'all markets'),
    ...RESULT_BUCKETS.map((bucket) => resultDrill(data, bucket.key)),
    needsWorkDrill(data),
    citedSiteDrill(data, site),
    citedSiteDrill(data, { ...site, own: true, name: 'TextBolt' }),
    ...ENGINE_SETS.map((set) => engineDrill(data, statuses, 'chatgpt', set)),
    ...WEEKS.map((_week, index) => weekDrill(data, WEEKS, index)),
    weekChangeDrill(data, WEEKS),
    pageFixesDrill([fix], data),
    fixSearchesDrill(fix, data, QUESTION_NOUN)
  ]
}

afterEach(cleanup)

describe('Summary drill explanations', () => {
  it('gives every drill a plain sentence for what its number counts', () => {
    for (const drill of everyDrill()) {
      expect(drill.description.trim(), drill.id).not.toBe('')
      expect(drill.description, drill.id).toMatch(/[.!?]$/)
    }
  })

  it('never draws the "What this number counts" card empty', () => {
    for (const drill of everyDrill()) {
      const view = render(<DrillDrawer drill={drill} onClose={() => undefined} />)
      const heading = view.getByRole('heading', { name: 'What this number counts' })
      const card = heading.closest('section') ?? heading.parentElement?.parentElement
      if (!card) throw new Error(`no card for ${drill.id}`)
      const text = (card.textContent ?? '').replace('What this number counts', '').trim()
      expect(text, drill.id).not.toBe('')
      expect(within(card as HTMLElement).queryAllByText(/\S/).length, drill.id).toBeGreaterThan(0)
      view.unmount()
    }
  })
})
