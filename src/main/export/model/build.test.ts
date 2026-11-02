import { describe, expect, test } from 'vitest'
import { REPORT_SECTIONS } from '@shared/domain'
import { headlineNoun, reportHeadline } from '@shared/report-copy'
import { drillCounts, drillIssues } from './consistency'
import { sampleReportModel } from './sample.test-helper'

describe('report model', () => {
  const scopes = {
    page: sampleReportModel(),
    project: sampleReportModel({ scope: 'project', pageIds: [] }),
    oneMarket: sampleReportModel({ marketIds: ['mkt-us'] }),
    latest: sampleReportModel({ checks: 'latest' })
  }

  test.each(Object.entries(scopes))(
    'NFR-14: every drillable number lists exactly n rows (%s)',
    (_, model) => {
      expect(drillIssues(model)).toEqual([])
      expect(drillCounts(model).length).toBeGreaterThan(40)
    }
  )

  test('rows come from the latest full check; the partial follow-up stays out of totals', () => {
    const model = scopes.page
    const us = model.rows.filter((row) => row.marketId === 'mkt-us')
    expect(us).toHaveLength(10)
    expect(new Set(us.map((row) => row.runId))).toEqual(new Set(['run-us-3']))
    expect(model.overview.tracked.n).toBe(20)
    const partial = model.trends.series.filter((point) => point.partial)
    expect(partial).toHaveLength(1)
    expect(partial[0]?.at).toBe('2026-10-20T09:00:00.000Z')
  })

  test('headline uses the same counts as the KPI tiles; AIO share is of all tracked prompts', () => {
    const { overview } = scopes.page
    expect(overview.measured).toBe(19)
    expect(overview.headline).toBe(
      reportHeadline({
        measured: 19,
        aio: overview.aio.n,
        cited: overview.cited.n,
        named: overview.named.n,
        notVisible: overview.notVisible.n,
        failed: overview.failed.n,
        noun: headlineNoun(2, false)
      })
    )
    // The headline counts every tracked prompt (20) like the 85% tile, and names the failed
    // search. The report spans 2 markets, so 20 is prompt checks (one per prompt and market),
    // not 20 buyer prompts: the page screen shows one market at a time.
    expect(overview.headline).toMatch(
      /^Google shows an AI Overview for 17 of your 20 buyer question checks across 2 markets \(1 search failed\)\. You are cited in 6 of them \(35%\)/
    )
    expect(overview.aioPct).toBe(Math.round((17 / 20) * 100))
    expect(overview.failed.n).toBe(20 - 19)
    expect(overview.citedPct).toBe(Math.round((6 / 17) * 100))
  })

  test('funnel steps are subsets and drill to their own rows', () => {
    const steps = scopes.project.overview.funnel
    expect(steps.map((step) => step.id)).toEqual(['tracked', 'aio', 'cited', 'page_cited', 'named'])
    for (let index = 1; index < steps.length; index += 1) {
      const step = steps[index]
      const previous = steps[index - 1]
      if (step === undefined || previous === undefined) continue
      const before = new Set(scopes.project.drills[previous.count.drill ?? ''])
      for (const id of scopes.project.drills[step.count.drill ?? ''] ?? []) {
        expect(before.has(id)).toBe(true)
      }
    }
  })

  test('opportunity is ordered by not visible, largest first', () => {
    const bars = scopes.page.overview.opportunityByStage
    const values = bars.map((bar) => bar.notVisible.n)
    expect(values).toEqual([...values].sort((a, b) => b - a))
    for (const bar of bars) {
      expect(bar.notVisible.n + bar.namedOnly.n + bar.citedOnly.n + bar.winning.n).toBe(bar.total.n)
    }
    expect(scopes.page.overview.opportunityByPage).toEqual([])
    expect(scopes.project.overview.opportunityByPage.length).toBe(2)
  })

  test('share of voice parts add up to the prompts with an AI Overview', () => {
    const { sov } = scopes.project.competition
    expect(sov.you.n + sov.competitor.n + sov.others.n + sov.none.n).toBe(sov.total.n)
    expect(sov.total.n).toBe(scopes.project.overview.aio.n)
    expect(sov.you.n).toBe(scopes.project.overview.cited.n)
  })

  test('leaderboard authority follows the spec formula and folds youtu.be into youtube.com', () => {
    const model = scopes.page
    const aio = model.overview.aio.n
    const markets = new Set(model.rows.map((row) => row.marketId)).size
    for (const row of model.competition.leaderboard) {
      const prominence =
        row.avgPosition === null ? 0 : Math.min(1, Math.max(0, 1 - (row.avgPosition - 1) / 9))
      expect(row.reach).toBeCloseTo(row.prompts.n / aio)
      expect(row.prominence).toBeCloseTo(prominence, 1)
      expect(row.authority).toBe(
        Math.round(100 * (0.5 * row.reach + 0.3 * row.prominence + 0.2 * row.marketCoverage))
      )
      expect(row.marketCoverage).toBeLessThanOrEqual(1)
      if (row.who !== 'you') expect((row.overlap?.n ?? 0) + (row.gap?.n ?? 0)).toBe(row.prompts.n)
    }
    expect(markets).toBe(2)
    const domains = model.competition.leaderboard.map((row) => row.domain)
    expect(domains).toContain('youtube.com')
    expect(domains).not.toContain('youtu.be')
    expect(model.competition.leaderboard.find((row) => row.who === 'you')?.prompts.n).toBe(
      model.overview.cited.n
    )
  })

  test('changes since the previous full check, with before → after', () => {
    const { trends } = scopes.oneMarket
    expect(trends.gained.items.map((item) => item.prompt)).toEqual([
      expect.stringContaining('without hiring a developer'),
      expect.stringContaining('txt.att.net')
    ])
    expect(trends.gained.items[0]).toMatchObject({ before: 'Not cited', after: 'Target page #2' })
    expect(trends.lost.items[0]).toMatchObject({ before: 'Target page #1', after: 'Not cited' })
    expect(trends.noLongerNamed.count.n).toBe(2)
    expect(trends.verdicts[0]).toMatchObject({ number: 1, verdict: 'partly' })
    expect(trends.verdicts[0]?.label).toBe('Partly worked · 1 of 2 prompts')
  })

  test('universe maps funnel stages and names best and weakest only for segments of 5+', () => {
    const model = scopes.project
    const funnel = model.universe.dimensions.find((dimension) => dimension.id === 'funnel')
    expect(funnel?.rows.map((row) => row.key)).toEqual(['TOFU', 'MOFU', 'BOFU'])
    const stage = model.universe.dimensions.find((dimension) => dimension.id === 'stage')
    const total = stage?.rows.reduce((sum, row) => sum + row.prompts.n, 0)
    expect(total).toBe(model.rows.length)
    expect(model.universe.dimensions.map((dimension) => dimension.id)).toEqual([
      'stage',
      'funnel',
      'source',
      'page',
      'market'
    ])
    expect(scopes.oneMarket.universe.dimensions.map((dimension) => dimension.id)).not.toContain(
      'market'
    )
  })

  test('sources count citations, normalise YouTube ids and group Reddit by subreddit', () => {
    const { sources } = scopes.page
    expect(sources.yours + sources.competitor + sources.external).toBe(sources.total)
    expect(sources.youtube.videos).toHaveLength(1)
    expect(sources.youtube.videos[0]).toMatchObject({
      videoId: 'Abc123XYZ00',
      url: 'https://www.youtube.com/watch?v=Abc123XYZ00',
      citations: 3,
      channel: null
    })
    expect(sources.reddit.subreddits[0]?.name).toBe('r/sysadmin')
    expect(sources.reddit.threads[0]?.replyStatus).toBe('unchecked')
    expect(sources.platforms.reduce((sum, row) => sum + row.citations, 0)).toBe(sources.total)
  })

  test('answer shape: analysed vs waiting, journeys, and changed shape', () => {
    const shape = scopes.page.answerShape
    expect(shape.analysed.n + shape.notAnalysed.n).toBe(scopes.page.overview.aio.n)
    expect(shape.mostCommon?.fingerprint).toBe('A1 → C4 → D2')
    expect(shape.journeys.reduce((sum, journey) => sum + journey.prompts.n, 0)).toBe(
      shape.analysed.n
    )
    expect(shape.changed.n).toBe(shape.changes.length)
    expect(shape.legend.flatMap((group) => group.codes)).toHaveLength(19)
  })

  test('content gaps only in page scope, with the owner-method summary line', () => {
    const gaps = scopes.page.contentGaps
    expect(gaps.empty).toBeNull()
    expect(gaps.matrix).toHaveLength(10)
    expect(gaps.summary).toBe(
      '5 strong, 4 partial, 1 weak — 5–6 new FAQs plus edits to 8 sections.'
    )
    expect(gaps.pageRead?.titleTruncated).toBe(true)
    expect(gaps.oneByOne.filter((item) => item.newFaq)).toHaveLength(6)
    expect(gaps.pageWide.map((item) => item.kind)).toContain('factual_claim')
    expect(scopes.project.contentGaps.empty?.title).toBe('Page scope only')
  })

  test('your pages: other own pages flag likely noise; wrong page list matches the KPI', () => {
    const pages = scopes.page.pagesSection
    expect(pages.otherOwn.find((page) => page.path === '/login')?.likelyNoise).toBe(true)
    expect(pages.otherOwn.find((page) => page.path === '/blog/email-to-sms/')?.likelyNoise).toBe(
      false
    )
    expect(pages.wrongPage).toHaveLength(scopes.page.overview.wrongPage.n)
    expect(scopes.project.pagesSection.pagesTracked).toBe(2)
  })

  test('cover and sections', () => {
    const { cover, sections } = scopes.page
    expect(cover.scope).toBe('page')
    expect(cover.scopeSlug).toBe('how-to-set-up-text-alerts-for-business')
    expect(cover.brandColor).toBe('#C2410C')
    // Topic coverage is left out of a page report even when every section is chosen.
    expect(sections).toEqual(REPORT_SECTIONS.filter((id) => id !== 'topic_coverage'))
    expect(scopes.project.cover.scopeLabel).toBe('Project · 2 tracked pages')
    expect(scopes.page.markets.map((market) => `${market.flag} ${market.label}`)).toEqual([
      '🇺🇸 US · EN',
      '🇨🇦 CA · EN'
    ])
    expect(scopes.page.reputation.empty?.title).toBe('Not measured yet')
  })

  test('the model is plain JSON (structured-cloneable) and deterministic', () => {
    const again = sampleReportModel()
    expect(JSON.parse(JSON.stringify(scopes.page))).toEqual(again)
  })
})
