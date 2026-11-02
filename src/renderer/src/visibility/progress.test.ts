import { describe, expect, it } from 'vitest'
import { formatMonthDay } from '../m3/model'
import {
  changedPromptCount,
  filterPromptRows,
  marketDelta,
  unchangedPromptsToggle,
  visibleFixRows
} from './progress'
import { progressDetail } from './progress.sample'
import { mockVisibilitySource } from './mocks'
import { liveMarket, promptColumns, promptRows } from './promptHistory'
import { markersFor } from './chart.sample'
import {
  allPromptsPhrase,
  buildTrend,
  citedInOverviews,
  coverageTicks,
  axisDateAnchor,
  layoutMarkers,
  markerBox,
  markerBoxesOverlap,
  markerIntersectsAxis,
  markerLineTop,
  promptsCheckedLabel,
  promptsOf,
  showsAxisDate
} from './trends'

describe('count labels', () => {
  it('pluralizes N of M questions and questions checked', () => {
    expect(promptsOf(0, 0)).toBe('0 of 0 questions')
    expect(promptsOf(1, 1)).toBe('1 of 1 question')
    expect(promptsOf(2, 2)).toBe('2 of 2 questions')
    expect(promptsOf(2014, 2014)).toBe('2,014 of 2,014 questions')
    expect(promptsCheckedLabel(0, 0)).toBe('0 of 0 questions checked')
    expect(promptsCheckedLabel(1, 1)).toBe('1 of 1 question checked')
    expect(promptsCheckedLabel(2, 2)).toBe('2 of 2 questions checked')
    expect(promptsCheckedLabel(2014, 2014)).toBe('2,014 of 2,014 questions checked')
  })

  it('pluralizes all questions, cited overviews, and unchanged questions', () => {
    expect(allPromptsPhrase(0)).toBe('all 0 questions')
    expect(allPromptsPhrase(1)).toBe('all 1 question')
    expect(allPromptsPhrase(2)).toBe('all 2 questions')
    expect(allPromptsPhrase(2014)).toBe('all 2,014 questions')
    expect(citedInOverviews(0, 0)).toBe('Page cited in 0 of 0 AI Overviews shown')
    expect(citedInOverviews(1, 1)).toBe('Page cited in 1 of 1 AI Overview shown')
    expect(citedInOverviews(2, 2)).toBe('Page cited in 2 of 2 AI Overviews shown')
    expect(citedInOverviews(2014, 2014)).toBe('Page cited in 2,014 of 2,014 AI Overviews shown')
    expect(unchangedPromptsToggle(0, false)).toBe('Show the 0 unchanged questions')
    expect(unchangedPromptsToggle(1, false)).toBe('Show the 1 unchanged question')
    expect(unchangedPromptsToggle(2, false)).toBe('Show the 2 unchanged questions')
    expect(unchangedPromptsToggle(2014, false)).toBe('Show the 2,014 unchanged questions')
    expect(unchangedPromptsToggle(0, true)).toBe('Hide the 0 unchanged questions')
    expect(unchangedPromptsToggle(1, true)).toBe('Hide the 1 unchanged question')
    expect(unchangedPromptsToggle(2, true)).toBe('Hide the 2 unchanged questions')
    expect(unchangedPromptsToggle(2014, true)).toBe('Hide the 2,014 unchanged questions')
  })
})

describe('progress sample view-model', () => {
  const detail = progressDetail('alerts')
  if (!detail) throw new Error('sample progress missing')

  it('lists exactly the questions in each What changed group', () => {
    expect(changedPromptCount(detail)).toBe(4)
    expect(detail.unchanged).toHaveLength(6)
    expect(changedPromptCount(detail) + detail.unchanged.length).toBe(10)
    for (const group of detail.groups) {
      expect(group.items).toHaveLength(group.count)
      expect(group.aria).toContain(group.count === 0 ? 'none' : String(group.count))
    }
  })

  it('keeps Fix 1 results and the question history on the same ten questions', () => {
    expect(visibleFixRows(detail.fix1Rows, 'all')).toHaveLength(3)
    expect(visibleFixRows(detail.fix1Rows, 'Worked')).toHaveLength(1)
    expect(visibleFixRows(detail.fix1Rows, 'Planned')).toHaveLength(0)
    expect(detail.prompts).toHaveLength(10)
    expect(detail.prompts.filter((row) => row.fix1)).toHaveLength(3)
    expect(filterPromptRows(detail.prompts, 'verizon')).toHaveLength(1)
    expect(filterPromptRows(detail.prompts, 'nope')).toHaveLength(0)
  })

  it('makes each market change the latest score minus the previous check', () => {
    expect(detail.markets).toHaveLength(4)
    for (const market of detail.markets) {
      expect(market.checks).toHaveLength(3)
      expect(marketDelta(market.scores)).toBe(Number(market.delta))
      const drawn = market.scores.filter((score) => score !== null)
      expect(market.aria).toContain(drawn.join(', '))
    }
  })

  it('returns nothing for a page outside the sample', () => {
    expect(progressDetail('bulk')).toBeNull()
  })
})

describe('chart marks and coverage ticks', () => {
  it('places sample marker labels so none overlap', () => {
    const markers = markersFor('alerts')
    const start = new Date('2026-09-21T16:00:00.000Z').getTime()
    const end = new Date('2026-11-02T16:00:00.000Z').getTime()
    const labels = layoutMarkers(
      markers,
      (iso) => 52 + ((new Date(iso).getTime() - start) / (end - start)) * (800 - 52),
      820
    )
    expect(labels).toHaveLength(4)
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        const left = labels[i]
        const right = labels[j]
        if (!left || !right) continue
        expect(markerBoxesOverlap(left, right)).toBe(false)
      }
    }
    expect(labels.every((label) => label.name.length > 0 && label.promptIds.length > 0)).toBe(true)
    const next = labels.find((label) => label.title === 'next full check')
    expect(next?.anchor).toBe('end')
    expect(next && next.x <= next.lineX).toBe(true)
    expect(next && next.detailY < 220).toBe(true)
    for (const label of labels) {
      expect(markerIntersectsAxis(label)).toBe(false)
    }
    const barDays = new Set(['Sep 21', 'Oct 5', 'Oct 19'])
    const axisDays = markers
      .filter((marker) => showsAxisDate(marker.band, formatMonthDay(marker.at), barDays))
      .map((marker) => formatMonthDay(marker.at))
    expect(axisDays).toEqual([
      formatMonthDay('2026-10-24T16:00:00.000Z'),
      formatMonthDay('2026-11-02T16:00:00.000Z')
    ])
    expect(axisDays).not.toContain(formatMonthDay('2026-10-08T16:00:00.000Z'))
    expect(axisDays).not.toContain(formatMonthDay('2026-10-21T16:00:00.000Z'))
    const fix2 = labels.find((label) => label.title === 'Fix 2 · Oct 21')
    expect(fix2).toBeTruthy()
    if (fix2) expect(markerLineTop(fix2)).toBeGreaterThanOrEqual(markerBox(fix2).y2)
    expect(next && axisDateAnchor(next.lineX, 820)).toBe('end')
  })

  it('draws a coverage tick per check and keeps checked within the total', async () => {
    const source = mockVisibilitySource()
    const history = await source['results:history']({
      projectId: 'textbolt',
      pageId: 'alerts',
      marketId: 'us'
    })
    const runs = new Map()
    for (const point of history.points) {
      runs.set(
        point.runId,
        await source['results:get']({
          projectId: 'textbolt',
          pageId: 'alerts',
          marketId: 'us',
          runId: point.runId
        })
      )
    }
    const trend = buildTrend(history, runs)
    const ticks = coverageTicks(trend.bars, markersFor('alerts'))
    expect(ticks.map((tick) => tick.label)).toEqual([
      '10 of 10 questions',
      '10 of 10 questions',
      '10 of 10 questions',
      '2 of 10 planned',
      '10 of 10 · planned'
    ])
    for (const tick of ticks) {
      expect(tick.checked).toBeLessThanOrEqual(tick.total)
      expect(tick.checked + (tick.total - tick.checked)).toBe(tick.total)
    }
  })

  it('builds each question column from history and keeps one cell per check', async () => {
    const source = mockVisibilitySource()
    const history = await source['results:history']({
      projectId: 'textbolt',
      pageId: 'alerts',
      marketId: 'us'
    })
    const runs = new Map()
    for (const point of history.points) {
      runs.set(
        point.runId,
        await source['results:get']({
          projectId: 'textbolt',
          pageId: 'alerts',
          marketId: 'us',
          runId: point.runId
        })
      )
    }
    const columns = promptColumns(history)
    const rows = promptRows(columns, runs)
    expect(columns.length).toBe(history.points.filter((point) => !point.partial).length)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.cells).toHaveLength(columns.length)
    }
    const market = liveMarket('us', '🇺🇸 US · EN', history)
    expect(market.checks).toHaveLength(columns.length)
    expect(marketDelta(market.scores)).toBe(Number(market.delta))
  })
})
