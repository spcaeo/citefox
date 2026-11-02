import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { excludedResults, textboltResults } from './fixtures'
import {
  aiOverviewLabel,
  aioLabel,
  buyerPromptsLabel,
  checkingHeading,
  citedInstancePreview,
  drillFor,
  formatChecked,
  formatMonthDay,
  formatStamp,
  funnelPrompts,
  identityIssues,
  movementLabel,
  ofPrompts,
  scoredPromptsLabel,
  showingDomains,
  showingPrompts,
  stageSummary,
  stageViews
} from './model'
import { comparisonViews } from './comparison'
import { formatDay, formatMoment } from '../utils/dates'

describe('PageResults payload', () => {
  const results = textboltResults()

  it('matches the TextBolt overview counts', () => {
    expect(identityIssues(results)).toEqual([])
    expect(results.run?.visibilityScore).toBe(50)
    expect(results.run?.points).toBe(12)
    expect(results.run?.pointsPossible).toBe(24)
    expect(results.funnel.map((step) => step.count)).toEqual([10, 8, 5, 3, 2])
    expect(results.funnel.slice(1).map((step) => step.drop?.count)).toEqual([2, 3, 2, 1])
    // Already winning = cited (any own page) and named (REPORT-SPEC), then cited only.
    expect(results.buckets.map((bucket) => bucket.count)).toEqual([2, 3, 1, 2])
    expect(results.ugcOverlay.count).toBe(4)
    expect(results.ugcOverlay.promptIds).toEqual(['tb-1', 'tb-4', 'tb-5', 'tb-9'])
    const simple = results.leaderboard.find((row) => row.domain === 'simpletexting.com')
    expect(simple).toMatchObject({ aioCount: 3, overlap: 2, gap: 1, badge: 'tracked' })
    expect(results.leaderboard[0]).toMatchObject({
      domain: 'textbolt.com',
      badge: 'you',
      overlap: null,
      gap: null
    })
    expect(results.leaderboard[0]?.averagePosition).toBeCloseTo(2.4)
    expect(results.runSummary?.headline).toContain('8 of 10')
  })

  it('keeps no-AIO and error questions out of the score and the buckets', () => {
    const excluded = excludedResults()
    expect(identityIssues(excluded)).toEqual([])
    expect(excluded.run?.visibilityScore).toBe(100)
    expect(excluded.run?.promptsWithAio).toBe(1)
    expect(excluded.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1)
    expect(
      excluded.prompts.filter((row) => row.status === 'no_aio' || row.status === 'error')
    ).toHaveLength(2)
  })

  it('overlap lists the questions that cite a domain and this site, and matches the column', () => {
    const base = textboltResults()
    for (const row of base.leaderboard.filter((item) => item.badge !== 'you')) {
      const drill = drillFor(base, `overlap:${row.domain}`)
      expect(drill?.promptIds.length).toBe(row.overlap ?? 0)
      expect(drill?.promptIds.some((id) => row.gapPromptIds.includes(id))).toBe(false)
    }
    const you = base.leaderboard.find((item) => item.badge === 'you')
    if (you) expect(drillFor(base, `overlap:${you.domain}`)).toBeNull()
  })

  it('names an unknown question set in the checked-step drawer', () => {
    const base = textboltResults()
    expect(drillFor(base, 'funnel:checked')?.description).toBe('Every question in question set v2.')
    for (const version of [null, undefined, 0, 1.5, Number.NaN] as const) {
      const next = {
        ...base,
        scope: { ...base.scope, promptSetVersion: version as number | null }
      }
      const description = drillFor(next, 'funnel:checked')?.description ?? ''
      expect(description).toBe('Every question in question set version unknown.')
      expect(description).not.toContain('v0')
      expect(description).not.toContain('NaN')
    }
  })

  it('titles the AI Overview drop by its reason, so failed searches are not "no AI Overview"', () => {
    const base = textboltResults()
    expect(drillFor(base, 'drop:aio_shown')?.title).toBe('Lost: no AI Overview')
    const failed = {
      ...base,
      funnel: base.funnel.map((step) =>
        step.id === 'aio_shown' && step.drop
          ? {
              ...step,
              drop: { ...step.drop, reason: 'The search failed, so the AI Overview is unknown' }
            }
          : step
      )
    }
    expect(drillFor(failed, 'drop:aio_shown')?.title).toBe(
      'Lost: the search failed, so the AI Overview is unknown'
    )
  })

  it('shows a failed search as an unknown AI Overview, not "No"', () => {
    expect(aioLabel({ status: 'error' })).toBe('Unknown')
    expect(aioLabel({ status: 'no_aio' })).toBe('No')
    expect(aioLabel({ status: 'not_cited' })).toBe('Yes')
  })

  it('formats the lost label from the previous citation and ranks stages', () => {
    expect(movementLabel('lost', 'page_cited', 5)).toBe('Lost (was Right page · 5)')
    const summary = stageSummary(stageViews(results))
    expect(summary).toContain('Best: Problem (67% of overviews cite this page).')
    expect(summary).toContain('Weakest: Trigger and Objection (0%).')
    expect(summary).toContain('Comparison has 1 question, so it isn’t ranked.')
    const rows = comparisonViews(results, '#/history')
    expect(rows.find((row) => row.id === 'score')?.change).toBe('+12')
    expect(rows.find((row) => row.id === 'page_cited')?.current).toBe('3 / 8 · 38%')
    expect(rows.find((row) => row.id === 'avg_position')).toMatchObject({
      change: 'Moved up 1.0',
      tone: 'up'
    })
  })

  it('reads a larger position number as moving down, and an equal one as no change', () => {
    const at = (previous: number, current: number): ReturnType<typeof comparisonViews>[number] => {
      const [base, prior, now] = results.comparison
      const changed = {
        ...results,
        comparison: [
          base,
          { ...prior, averagePosition: previous },
          { ...now, averagePosition: current }
        ] as const
      }
      const row = comparisonViews(changed, '#/history').find((item) => item.id === 'avg_position')
      if (row === undefined) throw new Error('missing position row')
      return row
    }
    expect(at(2, 3)).toMatchObject({ change: 'Moved down 1.0', tone: 'down' })
    expect(at(3, 2)).toMatchObject({ change: 'Moved up 1.0', tone: 'up' })
    expect(at(2, 2)).toMatchObject({ change: 'No change', tone: 'flat' })
  })

  it('folds cited instances after two names', () => {
    expect(citedInstancePreview([])).toEqual({ shown: '—', more: 0, full: '—' })
    expect(citedInstancePreview(['reddit.com'])).toEqual({
      shown: 'reddit.com',
      more: 0,
      full: 'reddit.com'
    })
    expect(citedInstancePreview(['reddit.com', 'simpletexting.com'])).toEqual({
      shown: 'reddit.com, simpletexting.com',
      more: 0,
      full: 'reddit.com, simpletexting.com'
    })
    expect(
      citedInstancePreview(['reddit.com', 'simpletexting.com', 'twilio.com', 'zapier.com'])
    ).toEqual({
      shown: 'reddit.com, simpletexting.com +2 more',
      more: 2,
      full: 'reddit.com, simpletexting.com, twilio.com, zapier.com'
    })
  })

  it('formats a stamp on the computer’s own clock, never a forced 24-hour one', () => {
    const iso = '2026-10-20T16:26:00.000Z'
    expect(formatStamp(iso)).toBe(formatMoment(iso))
    expect(formatChecked(iso)).toBe(formatMoment(iso))
    expect(formatMonthDay(iso)).toBe(formatDay(iso, { year: false }))
    expect(formatStamp(null)).toBe('—')
  })

  it('formats 16:26Z as 12:26 in America/Toronto', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        '--input-type=module',
        '-e',
        [
          "import { existsSync } from 'node:fs'",
          "import { registerHooks } from 'node:module'",
          "import { resolve } from 'node:path'",
          "import { pathToFileURL } from 'node:url'",
          '// strip-types does not add .ts onto extensionless imports, and node cannot see @shared paths',
          'registerHooks({',
          '  resolve(specifier, context, next) {',
          '    if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) {',
          '      return next(`${specifier}.ts`, context)',
          '    }',
          '    if (specifier === "@shared" || specifier.startsWith("@shared/")) {',
          '      const sub = specifier === "@shared" ? "index" : specifier.slice("@shared/".length)',
          '      const base = resolve("src/shared", sub)',
          '      const file = existsSync(`${base}.ts`) ? `${base}.ts` : resolve(base, "index.ts")',
          '      return next(pathToFileURL(file).href, context)',
          '    }',
          '    return next(specifier, context)',
          '  }',
          '})',
          "const { formatStamp } = await import('./src/renderer/src/m3/model.ts')",
          "const iso = '2026-10-20T16:26:00.000Z'",
          'const formatted = formatStamp(iso)',
          'if (new Date(iso).getTimezoneOffset() !== 240) process.exit(2)',
          'if (!/Oct 20/.test(formatted) || !/12:26/.test(formatted)) process.exit(3)',
          'console.log(formatted)'
        ].join('\n')
      ],
      {
        cwd: root,
        env: { ...process.env, TZ: 'America/Toronto' },
        encoding: 'utf8'
      }
    )
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout.trim()).toMatch(/Oct 20.*12:26/)
  })
})

describe('count labels', () => {
  it('pluralizes Showing N of M questions', () => {
    expect(showingPrompts(0, 0)).toBe('Showing 0 of 0 questions')
    expect(showingPrompts(1, 1)).toBe('Showing 1 of 1 question')
    expect(showingPrompts(2, 2)).toBe('Showing 2 of 2 questions')
    expect(showingPrompts(2014, 2014)).toBe('Showing 2,014 of 2,014 questions')
  })

  it('pluralizes the checking heading', () => {
    expect(checkingHeading(0, 0)).toBe('Checking 0 questions in 0 markets')
    expect(checkingHeading(1, 1)).toBe('Checking 1 question in 1 market')
    expect(checkingHeading(2, 2)).toBe('Checking 2 questions in 2 markets')
    expect(checkingHeading(2014, 2014)).toBe('Checking 2,014 questions in 2,014 markets')
  })

  it('pluralizes buyer questions, scored questions, and of N questions', () => {
    expect(buyerPromptsLabel(0)).toBe('0 buyer questions')
    expect(buyerPromptsLabel(1)).toBe('1 buyer question')
    expect(buyerPromptsLabel(2)).toBe('2 buyer questions')
    expect(buyerPromptsLabel(2014)).toBe('2,014 buyer questions')
    expect(scoredPromptsLabel(0)).toBe('See the 0 scored questions')
    expect(scoredPromptsLabel(1)).toBe('See the 1 scored question')
    expect(scoredPromptsLabel(2)).toBe('See the 2 scored questions')
    expect(scoredPromptsLabel(2014)).toBe('See the 2,014 scored questions')
    expect(ofPrompts(0)).toBe('of 0 questions')
    expect(ofPrompts(1)).toBe('of 1 question')
    expect(ofPrompts(2)).toBe('of 2 questions')
    expect(ofPrompts(2014)).toBe('of 2,014 questions')
  })

  it('pluralizes funnel shares, AI Overviews, and domain counts', () => {
    expect(funnelPrompts(0, 0, 0)).toBe('0 of 0 questions · 0%')
    expect(funnelPrompts(1, 1, 100)).toBe('1 of 1 question · 100%')
    expect(funnelPrompts(2, 2, 100)).toBe('2 of 2 questions · 100%')
    expect(funnelPrompts(2014, 2014, 100)).toBe('2,014 of 2,014 questions · 100%')
    expect(aiOverviewLabel(0)).toBe('0 AI Overviews')
    expect(aiOverviewLabel(1)).toBe('1 AI Overview')
    expect(aiOverviewLabel(2)).toBe('2 AI Overviews')
    expect(aiOverviewLabel(2014)).toBe('2,014 AI Overviews')
    expect(showingDomains(0, 0)).toBe('showing 0 of 0 domains')
    expect(showingDomains(1, 1)).toBe('showing 1 of 1 domain')
    expect(showingDomains(2, 2)).toBe('showing 2 of 2 domains')
    expect(showingDomains(2014, 2014)).toBe('showing 2,014 of 2,014 domains')
  })
})
