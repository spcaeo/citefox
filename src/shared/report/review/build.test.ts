import { describe, expect, it } from 'vitest'
import { buildReport } from './build'
import { partsText } from './figures'
import { sampleContext, sampleMetrics } from './sample.test-helper'
import type { Num, ReviewReport } from './types'

function nums(report: ReviewReport): { path: string; num: Num }[] {
  const out: { path: string; num: Num }[] = []
  const walk = (value: unknown, path: string): void => {
    if (path === 'drills' || value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.n === 'number' && typeof record.drill === 'string') {
      out.push({ path, num: record as unknown as Num })
      return
    }
    for (const [key, item] of Object.entries(record)) walk(item, `${path}.${key}`)
  }
  walk(report, '')
  return out
}

describe('Impact review model', () => {
  const report = buildReport(sampleMetrics(), sampleContext())

  it('every number opens a drawer with exactly that many rows, and every row resolves', () => {
    const found = nums(report)
    expect(found.length).toBeGreaterThan(40)
    for (const { path, num } of found) {
      const drill = report.drills[num.drill]
      expect(drill, path).toBeDefined()
      expect(drill?.ids.length, path).toBe(num.n)
    }
    for (const [id, drill] of Object.entries(report.drills)) {
      for (const item of drill.ids) {
        const known = drill.kind === 'pages' ? report.pagesByUrl[item] : report.questionsById[item]
        expect(known, `${id} → ${item}`).toBeDefined()
      }
    }
    for (const kpi of report.verdict.kpis) expect(report.drills[kpi.drill]).toBeDefined()
    for (const tile of [...report.published.tiles, ...report.changed.tiles]) {
      if (tile.drill !== null)
        expect(report.drills[tile.drill]?.ids.length).toBe(Number(tile.value.replace(/[+−]/, '')))
    }
  })

  it('counts a question once under All engines and splits market vs work exactly', () => {
    const kpi = (label: string): unknown => report.verdict.kpis.find((k) => k.label === label)
    const citing = kpi('Questions citing your site')
    const answers = kpi('Questions with an AI answer')
    // q1 q2 q3 q9 q11 q12 cite on Google; q8 only on ChatGPT: 7 questions, counted once.
    expect(citing).toMatchObject({ now: '7', before: '5' })
    expect(answers).toMatchObject({ now: '11', before: '9' })
    const split = report.verdict.split
    expect(split).not.toBeNull()
    expect((split?.marketTenths ?? 0) + (split?.workTenths ?? 0)).toBe(split?.totalTenths)
    expect(partsText(report.verdict.headline)).toContain('went from 5 to 7')
  })

  it('applies the 14-day rule and flags lost ground and pages Google has not indexed', () => {
    const byPath = Object.fromEntries(report.published.rows.map((row) => [row.path, row]))
    expect(byPath['/email-to-sms-outlook']?.status).toBe('cited')
    expect(byPath['/features']?.status).toBe('lost')
    expect(byPath['/textbolt-for-schools']).toMatchObject({ status: 'toonew', indexed: false })
    expect(report.notIndexed.rows.map((row) => row.path)).toEqual(['/textbolt-for-schools'])
    expect(report.sections.find((s) => s.id === 'notindexed')?.alert).toBe(true)
    expect(report.pages.lost.map((lost) => lost.page.path)).toEqual(['/features'])
    expect(
      report.verdict.findings.some(
        (f) => f.tone === 'warn' && f.lead.toLowerCase().includes('setback')
      )
    ).toBe(true)
    expect(report.verdict.next.map((step) => step.lead)).toContain('Recover /features.')
  })

  it('lists what moved with a square per check, and the question chips add up', () => {
    const chips = Object.fromEntries(report.questions.chips.map((chip) => [chip.id, chip.count]))
    expect(chips.all).toBe(12)
    expect(chips.gained! + chips.kept! + chips.lost! + chips.notcited! + chips.noanswer!).toBe(12)
    expect(report.changed.movers.length).toBe(chips.gained! + chips.lost!)
    for (const mover of report.changed.movers) expect(mover.cells.length).toBe(3)
    expect(report.changed.dates).toEqual(['Sep 16', 'Sep 30', 'Oct 28'])
  })

  it('switches lenses and engines', () => {
    expect(report.topics.lenses.topic.map((row) => row.value)).toEqual([
      'Email to SMS basics',
      'Compliance',
      'Pricing'
    ])
    expect(report.topics.lenses.intent.length).toBeGreaterThan(1)
    const google = buildReport(sampleMetrics({ engine: 'google_aio' }), sampleContext())
    expect(
      google.verdict.kpis.find((kpi) => kpi.label === 'Questions citing your site')
    ).toMatchObject({ now: '6' })
    expect(report.method.agreement?.percent).toBeGreaterThan(0)
  })

  it('reads as a single check without a From end', () => {
    const latest = buildReport(sampleMetrics({ from: null }), sampleContext('visibility'))
    expect(latest.comparing).toBe(false)
    expect(latest.verdict.split).toBeNull()
    expect(latest.verdict.badge.label).toBe('Too early to tell')
    expect(latest.sections.map((s) => s.id)).toEqual([
      'standing',
      'questions',
      'competitors',
      'pages',
      'topics',
      'deep',
      'sources',
      'shape',
      'reputation',
      'notindexed',
      'backlinks',
      'method'
    ])
    expect(latest.standing.kpis[2]).toMatchObject({ label: 'Cite your pages', now: '7' })
  })
})
