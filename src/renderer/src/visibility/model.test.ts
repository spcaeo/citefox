import { describe, expect, it } from 'vitest'
import { identityIssues } from '../m3/model'
import { linkCountLabel, linkSegments } from './citations'
import { mockVisibilitySource, sampleRuns } from './mocks'
import {
  averageScore,
  buildTrend,
  chartAccessibleName,
  citedPromptIds,
  meanChange,
  pointAccessibleName,
  pointNote,
  rateTable,
  segmentSum,
  trendLines,
  versionChangeMarker
} from './trends'
import type { ResultsHistory, TrendPoint } from '@shared/domain'

describe('citation and score maths', () => {
  const source = mockVisibilitySource()

  it('splits own-domain links so the segments add up to the total', async () => {
    const results = await source['results:get']({
      projectId: 'textbolt',
      pageId: 'alerts',
      marketId: 'us',
      runId: null
    })
    const links = linkSegments(results)
    expect(links.thisPage.count + links.otherOwn.count).toBe(links.total)
    expect(links.thisPage.items).toHaveLength(links.thisPage.count)
    expect(links.otherOwn.items).toHaveLength(links.otherOwn.count)
    expect(links.total).toBe(5)
    expect(linkCountLabel(0)).toBe('0 links')
    expect(linkCountLabel(1)).toBe('1 link')
    expect(linkCountLabel(2)).toBe('2 links')
    expect(linkCountLabel(2014)).toBe('2,014 links')
    expect(linkCountLabel(links.total)).toBe('5 links')
    expect(links.thisPage.count).toBe(3)
    expect(links.otherOwn.count).toBe(2)
  })

  it('keeps each leaderboard drill list the same length as the count that opens it', async () => {
    const results = await source['results:get']({
      projectId: 'textbolt',
      pageId: 'alerts',
      marketId: null,
      runId: null
    })
    for (const row of results.leaderboard) {
      expect(row.promptIds).toHaveLength(row.aioCount)
      if (row.gap !== null) expect(row.gapPromptIds).toHaveLength(row.gap)
    }
  })

  it('builds trend segments that add up to AI Overviews shown', async () => {
    const history = await source['results:history']({
      projectId: 'textbolt',
      pageId: 'alerts',
      marketId: 'us-en'
    })
    const runs = new Map<string, Awaited<ReturnType<(typeof source)['results:get']>>>()
    for (const point of history.points) {
      runs.set(
        point.runId,
        await source['results:get']({
          projectId: 'textbolt',
          pageId: 'alerts',
          marketId: 'us-en',
          runId: point.runId
        })
      )
    }
    const model = buildTrend(history, runs)
    expect(model.issues).toEqual([])
    expect(model.bars.map((bar) => bar.score)).toEqual([24, 38, 50])
    expect(model.bars.map((bar) => bar.rateLabel)).toEqual(['14%', '25%', '38%'])
    expect(model.bars.map((bar) => bar.citations)).toEqual([3, 4, 5])
    for (const bar of model.bars) {
      expect(segmentSum(bar.segments)).toBe(bar.aiosShown)
      expect(citedPromptIds(bar)).toHaveLength(bar.pageCited)
    }
    expect(model.lines).toHaveLength(1)
    expect(model.lines[0]).toHaveLength(3)
    expect(model.bars.map((bar) => bar.versionChanged)).toEqual([false, false, false])
    expect(pointNote(model.bars[0]!, [])).toBe('First check with question set v2.')
  })

  it('leaves partial checks out of the trend line and starts a new line for a new question set', () => {
    const history: ResultsHistory = {
      pageId: 'p',
      marketId: 'm',
      promptSetVersion: 2,
      points: [
        point('a', false, 1, '2026-09-01T00:00:00.000Z'),
        point('b', true, 1, '2026-09-08T00:00:00.000Z'),
        point('c', false, 1, '2026-09-15T00:00:00.000Z'),
        point('d', false, 2, '2026-10-01T00:00:00.000Z')
      ]
    }
    const model = buildTrend(history, new Map())
    expect(model.bars.find((bar) => bar.runId === 'b')?.inTrendLine).toBe(false)
    expect(trendLines(model.bars).map((line) => line.map((bar) => bar.runId))).toEqual([
      ['a', 'c'],
      ['d']
    ])
    expect(versionChangeMarker(model.bars[3]!)).toBe('v2')
    expect(model.bars[1]?.versionChanged).toBe(false)
  })

  it('renders a null question set as version unknown and does not mark a change to 0', () => {
    const history: ResultsHistory = {
      pageId: 'p',
      marketId: 'm',
      promptSetVersion: null,
      points: [
        point('a', false, null, '2026-09-01T00:00:00.000Z'),
        point('b', false, 0, '2026-09-08T00:00:00.000Z'),
        point('c', false, undefined, '2026-09-15T00:00:00.000Z'),
        point('d', false, 1.5, '2026-10-01T00:00:00.000Z'),
        point('e', false, Number.NaN, '2026-10-15T00:00:00.000Z')
      ]
    }
    const model = buildTrend(history, new Map())
    expect(model.issues).toEqual([])
    expect(trendLines(model.bars).map((line) => line.map((bar) => bar.runId))).toEqual([
      ['a', 'b', 'c', 'd', 'e']
    ])
    expect(model.bars.map((bar) => bar.versionChanged)).toEqual([false, false, false, false, false])
    expect(model.bars.every((bar) => versionChangeMarker(bar) === null)).toBe(true)
    const table = rateTable(model.bars, [])
    expect(table.map((row) => row.promptSet)).toEqual([
      'version unknown',
      'version unknown',
      'version unknown',
      'version unknown',
      'version unknown'
    ])
    expect(table.some((row) => row.promptSet === 'v0' || row.promptSet === '')).toBe(false)
    for (const bar of model.bars) {
      expect(pointNote(bar, [])).toContain('version unknown')
      expect(pointNote(bar, [])).not.toContain('v0')
      expect(pointNote(bar, [])).not.toContain('NaN')
      expect(pointAccessibleName(bar, 'Sep 1')).toContain('version unknown')
      expect(pointAccessibleName(bar, 'Sep 1')).not.toContain('question set changed')
    }
    const name = chartAccessibleName(model.bars, [], 'US')
    expect(name).toContain('version unknown')
    expect(name).not.toContain('Question set changed')
    expect(name).not.toContain('v0')
    expect(name).not.toContain('v1')
  })

  it('marks a real version change to an unknown question set without calling it v0', () => {
    const history: ResultsHistory = {
      pageId: 'p',
      marketId: 'm',
      promptSetVersion: null,
      points: [
        point('a', false, 2, '2026-09-01T00:00:00.000Z'),
        point('b', false, null, '2026-10-01T00:00:00.000Z')
      ]
    }
    const model = buildTrend(history, new Map())
    expect(trendLines(model.bars).map((line) => line.map((bar) => bar.runId))).toEqual([
      ['a'],
      ['b']
    ])
    expect(versionChangeMarker(model.bars[0]!)).toBeNull()
    expect(versionChangeMarker(model.bars[1]!)).toBe('version unknown')
    expect(pointAccessibleName(model.bars[1]!, 'Oct 1')).toContain(
      'question set changed to version unknown'
    )
    expect(chartAccessibleName(model.bars, [], 'US')).toContain(
      'Question set changed to version unknown'
    )
    expect(pointNote(model.bars[1]!, [])).toBe('First check with question set version unknown.')
  })

  it('leaves pages with no score out of the average and the mean change', async () => {
    const pages = await source['scores:listPages']({ projectId: 'textbolt' })
    const projects = await source['scores:listProjects']()
    expect(pages.summary.averageScore).toBe(41)
    expect(pages.summary.change).toBe(4)
    expect(
      projects.projects.find((project) => project.projectId === 'textbolt')?.averageScore
    ).toBe(41)
    expect(averageScore([{ score: null }, { score: 10 }, { score: 11 }])).toBe(11)
    expect(averageScore([{ score: null }])).toBeNull()
    expect(meanChange([{ change: 12 }, { change: -4 }, { change: null }])).toBe(4)
    expect(meanChange([{ change: null }])).toBeNull()
  })

  it('keeps the three sample checks consistent', () => {
    for (const results of sampleRuns().values()) {
      expect(identityIssues(results)).toEqual([])
    }
  })
})

function point(
  runId: string,
  partial: boolean,
  promptSetVersion: number | null | undefined,
  finishedAt: string
): ResultsHistory['points'][number] {
  return {
    runId,
    finishedAt,
    promptSetVersion: promptSetVersion as TrendPoint['promptSetVersion'],
    partial,
    pageCitedRate: partial ? 1 : 0.5,
    promptsChecked: partial ? 2 : 10,
    promptsTotal: 10,
    visibilityScore: partial ? null : 40,
    contentChanged: false
  }
}
