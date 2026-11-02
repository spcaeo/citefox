import { describe, expect, it } from 'vitest'
import {
  bucketColumns,
  funnelChart,
  funnelRows,
  gainersLosers,
  historyCellSize,
  historyStrip,
  pairedBars,
  positionBuckets,
  positionChart,
  rankedBars,
  splitBar,
  splitMovers,
  splitParts,
  splitWidths,
  type ChartMarkup
} from './index'

/** Attributes of every element whose class list has `cls`. */
function marks(svg: string, tag: string, cls: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const match of svg.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))) {
    const attrs: Record<string, string> = {}
    for (const a of (match[1] ?? '').matchAll(/([\w-:]+)="([^"]*)"/g))
      attrs[a[1] ?? ''] = a[2] ?? ''
    if ((attrs.class ?? '').split(' ').includes(cls)) out.push(attrs)
  }
  return out
}

function widths(svg: string, cls: string): number[] {
  return marks(svg, 'rect', cls).map((rect) => Number(rect.width))
}

function drills(svg: string): string[] {
  return [...svg.matchAll(/data-drill="([^"]*)"/g)].map((m) => m[1] ?? '')
}

function labels(svg: string): string[] {
  return [...svg.matchAll(/<g [^>]*aria-label="([^"]*)"/g)].map((m) => m[1] ?? '')
}

/** Shared checks for any markup: no colour literals, sane size, every drill mark focusable. */
function expectSound(chart: ChartMarkup): void {
  expect(chart.svg.startsWith('<svg class="cfc ')).toBe(true)
  expect(chart.svg).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  expect(chart.svg).not.toMatch(/NaN|undefined|\[object/)
  expect(chart.height).toBeGreaterThan(0)
  for (const g of marks(chart.svg, 'g', 'cfc-drill')) {
    expect(g.tabindex).toBe('0')
    expect(g.role).toBe('button')
    expect(g['aria-label']?.length).toBeGreaterThan(0)
  }
  expect(chart.marks).toBe(drills(chart.svg).length)
}

const LONG = 'a-really-long-competitor-domain-name-that-goes-on.example.co.uk'

describe('paired before/after bars', () => {
  const chart = pairedBars({
    label: 'Where citations come from',
    width: 600,
    beforeLabel: 'Sep 16',
    nowLabel: 'Oct 28',
    items: [
      { id: 'grp:new', label: 'New pages', before: 2, now: 12 },
      { id: 'grp:home', label: LONG, before: 6, now: 3 }
    ]
  })

  it('draws both bars on one scale and labels every mark', () => {
    expectSound(chart)
    const before = widths(chart.svg, 'cfc-before').filter((w) => w > 10)
    const now = marks(chart.svg, 'rect', 'cfc-t-target').filter((r) => r.class?.includes('cfc-bar'))
    // The largest value (12) fills the span; 6 is half of it.
    const spans = widths(chart.svg, 'cfc-track')
    expect(Number(now[0]?.width)).toBeCloseTo(spans[0] ?? 0, 0)
    expect(before[1]).toBeCloseTo((spans[0] ?? 0) / 2, 0)
    expect(drills(chart.svg)).toEqual(['grp:new', 'grp:home'])
    expect(labels(chart.svg)[0]).toBe('New pages: Sep 16 2, Oct 28 12, change +10')
  })

  it('cuts a long label and keeps the full text in aria-label and title', () => {
    const narrow = pairedBars({
      label: 'X',
      width: 280,
      beforeLabel: 'Sep 16',
      nowLabel: 'Oct 28',
      items: [{ id: 'x', label: LONG, before: 1, now: 2 }]
    })
    expect(narrow.svg).toContain('…')
    expect(labels(narrow.svg)[0]).toContain(LONG)
    expect(narrow.svg).toContain(`<title>${LONG}</title>`)
  })

  it('makes two marks when the before bar has its own drill', () => {
    const two = pairedBars({
      label: 'Pages',
      width: 400,
      beforeLabel: 'Before',
      nowLabel: 'Now',
      items: [{ id: 'page:1:a', beforeId: 'page:1:b', label: '/pricing', before: 1, now: 4 }]
    })
    expect(drills(two.svg)).toEqual(['page:1:b', 'page:1:a'])
  })

  it('handles no items, zeros and two columns', () => {
    expect(
      pairedBars({ label: 'X', width: 300, beforeLabel: 'a', nowLabel: 'b', items: [] }).svg
    ).toContain('Nothing to compare yet')
    const zero = pairedBars({
      label: 'X',
      width: 300,
      beforeLabel: 'a',
      nowLabel: 'b',
      items: [{ label: 'Zero', before: 0, now: 0 }]
    })
    expectSound(zero)
    expect(widths(zero.svg, 'cfc-bar')).toEqual([])
    const wide = pairedBars({
      label: 'X',
      width: 800,
      columns: 2,
      beforeLabel: 'a',
      nowLabel: 'b',
      items: [1, 2, 3, 4].map((i) => ({ label: `P${i}`, before: i, now: i + 1 }))
    })
    const tall = pairedBars({
      label: 'X',
      width: 800,
      beforeLabel: 'a',
      nowLabel: 'b',
      items: [1, 2, 3, 4].map((i) => ({ label: `P${i}`, before: i, now: i + 1 }))
    })
    expect(wide.height).toBeLessThan(tall.height)
  })

  it('escapes text from the data', () => {
    const bad = pairedBars({
      label: 'X',
      width: 300,
      beforeLabel: 'a',
      nowLabel: 'b',
      items: [{ id: '"x" onclick=1', label: '<script>alert(1)</script>', before: 1, now: 2 }]
    })
    expect(bad.svg).not.toContain('<script>')
    expect(bad.svg).toContain('&lt;script&gt;')
    expect(bad.svg).toContain('data-drill="&quot;x&quot; onclick=1"')
  })
})

describe('gainers and losers', () => {
  const items = [
    { id: 'a', label: 'reddit.com', before: 4, now: 9 },
    { id: 'b', label: 'g2.com', before: 8, now: 3 },
    { id: 'c', label: 'same.com', before: 5, now: 5 },
    { id: 'd', label: 'textbolt.com', before: 2, now: 12, highlight: true }
  ]

  it('splits by direction, biggest move first, dropping the unchanged', () => {
    const lists = splitMovers(items)
    expect(lists.gained.map((i) => i.id)).toEqual(['d', 'a'])
    expect(lists.lost.map((i) => i.id)).toEqual(['b'])
  })

  it('draws a row per mover with a chip, side by side when wide', () => {
    const chart = gainersLosers({ label: 'Movers', width: 720, items })
    expectSound(chart)
    expect(drills(chart.svg)).toEqual(['d', 'a', 'b'])
    expect(chart.svg).toContain('▲ +10')
    expect(chart.svg).toContain('▼ −5')
    expect(chart.svg).toContain('cfc-label-me')
    const narrow = gainersLosers({ label: 'Movers', width: 360, items })
    expect(narrow.height).toBeGreaterThan(chart.height)
  })

  it('says so when one side is empty, and counts rows past the limit', () => {
    const up = gainersLosers({ label: 'M', width: 600, items: items.slice(0, 1) })
    expect(up.svg).toContain('Nobody lost ground')
    const many = gainersLosers({
      label: 'M',
      width: 600,
      limit: 2,
      items: [1, 2, 3, 4, 5].map((i) => ({ label: `s${i}.com`, before: 0, now: i }))
    })
    expect(many.svg).toContain('and 3 more')
    expect(gainersLosers({ label: 'M', width: 600, items: [] }).svg).toContain('Nothing moved yet')
  })
})

describe('bucket columns', () => {
  const chart = bucketColumns({
    label: 'How fast pages get cited',
    width: 500,
    height: 220,
    valueWords: 'questions citing',
    items: [
      { id: 'b0', label: '0–3 days', value: 0, sub: '0 of 2 pages cited' },
      { id: 'b1', label: '4–7 days', value: 4, sub: '1 of 3 pages cited' },
      { id: 'b2', label: '8–13 days', value: 8, sub: '3 of 3 pages cited' }
    ]
  })

  it('scales columns from a shared baseline; zero gets a flat stub', () => {
    expectSound(chart)
    const cols = marks(chart.svg, 'rect', 'cfc-col')
    expect(cols).toHaveLength(2)
    const [four, eight] = cols.map((c) => Number(c.height))
    expect(four).toBeCloseTo((eight ?? 0) / 2, 0)
    // Every column ends on the same baseline.
    const bottoms = cols.map((c) => Number(c.y) + Number(c.height))
    expect(new Set(bottoms.map((b) => Math.round(b))).size).toBe(1)
    expect(marks(chart.svg, 'rect', 'cfc-zero')).toHaveLength(1)
    expect(labels(chart.svg)[1]).toBe('4–7 days, 4 questions citing, 1 of 3 pages cited')
  })

  it('handles one bucket and none', () => {
    const one = bucketColumns({ label: 'X', width: 200, items: [{ label: 'All', value: 3 }] })
    expectSound(one)
    expect(one.marks).toBe(0)
    expect(bucketColumns({ label: 'X', width: 200, items: [] }).svg).toContain('No data yet')
  })
})

describe('history strip', () => {
  it('draws one square per check in the state colour', () => {
    const chart = historyStrip({
      label: 'History',
      cells: [
        { date: 'Sep 16', state: 'not-cited' },
        { date: 'Sep 30', state: 'other' },
        { date: 'Oct 14', state: 'target', id: 'run:3' },
        { date: 'Oct 28', state: 'missing' }
      ]
    })
    expectSound(chart)
    expect(marks(chart.svg, 'rect', 'cfc-sq')).toHaveLength(4)
    expect(chart.svg).toContain('cfc-sq-target')
    expect(chart.svg).toContain('aria-label="History: 4 checks, cited in 2"')
    expect(labels(chart.svg)).toContain('Oct 14: Right page cited')
    expect(drills(chart.svg)).toEqual(['run:3'])
    expect(chart.width).toBe(4 * 12 + 3 * 3)
  })

  it('shrinks squares to fit, never below 4 px', () => {
    expect(historyCellSize(4, undefined)).toBe(12)
    expect(historyCellSize(10, 60)).toBe(4)
    expect(historyCellSize(5, 50)).toBe(7)
    const one = historyStrip({ label: 'H', cells: [{ date: 'Oct 1', state: 'none' }] })
    expect(one.svg).toContain('1 check, cited in 0')
    expect(historyStrip({ label: 'H', cells: [] }).svg).toContain('No checks yet')
  })
})

describe('ranked bars', () => {
  it('draws a faint previous bar behind a thinner current bar', () => {
    const chart = rankedBars({
      label: 'Most cited sites',
      width: 600,
      previousLabel: 'Sep 16',
      nowLabel: 'Oct 28',
      items: [
        { id: 'd:1', label: 'reddit.com', value: 20, previous: 10 },
        { id: 'd:2', label: 'textbolt.com', value: 10, previous: 2, highlight: true },
        { id: 'd:3', label: LONG, value: 5 }
      ]
    })
    expectSound(chart)
    const before = widths(chart.svg, 'cfc-before').filter((w) => w > 10)
    const now = marks(chart.svg, 'rect', 'cfc-bar').filter((r) => !r.class?.includes('cfc-before'))
    expect(Number(now[0]?.width)).toBeCloseTo((before[0] ?? 0) * 2, 0)
    expect(Number(now[0]?.height)).toBeLessThan(12)
    expect(chart.svg).toContain('cfc-label-me')
    expect(labels(chart.svg)[2]).toBe(`${LONG}: 5`)
    expect(chart.svg).toContain('…')
  })

  it('handles none and all-zero', () => {
    expect(rankedBars({ label: 'X', width: 300, items: [] }).svg).toContain('Nothing cited yet')
    const zero = rankedBars({ label: 'X', width: 300, items: [{ label: 'a', value: 0 }] })
    expectSound(zero)
    expect(widths(zero.svg, 'cfc-bar')).toEqual([])
  })
})

describe('split bar', () => {
  it('segments add up to the full width', () => {
    const parts = [
      { id: 'market', label: 'Market', value: 2.1, tone: 'none' as const },
      { id: 'work', label: 'Your work', value: 3.1, tone: 'target' as const }
    ]
    const chart = splitBar({
      label: 'Change',
      width: 613,
      parts,
      signedValues: true,
      format: (v) => v.toFixed(1)
    })
    expectSound(chart)
    expect(splitWidths(parts, 613).reduce((a, b) => a + b, 0)).toBe(613)
    expect(chart.svg).toContain('+3.1 Your work')
    expect(drills(chart.svg)).toEqual(['market', 'work'])
  })

  it('adds a Rest part when the parts fall short of the total', () => {
    const parts = splitParts([{ label: 'You', value: 3, tone: 'target' }], 10, 'Everyone else')
    expect(parts.map((p) => [p.label, p.value])).toEqual([
      ['You', 3],
      ['Everyone else', 7]
    ])
    expect(splitParts([{ label: 'You', value: 3, tone: 'target' }], 3)).toHaveLength(1)
  })

  it('draws a negative part hatched, with a minus', () => {
    const chart = splitBar({
      label: 'Change',
      width: 400,
      parts: [
        { label: 'Market', value: 4, tone: 'none' },
        { label: 'Your work', value: -1, tone: 'target' }
      ]
    })
    expect(chart.svg).toContain('cfc-neg')
    expect(chart.svg).toContain('Your work: −1')
  })

  it('keeps a tiny part visible and handles all zero', () => {
    const w = splitWidths(
      [
        { label: 'a', value: 999, tone: 'target' },
        { label: 'b', value: 1, tone: 'other' }
      ],
      300
    )
    expect(w[1]).toBeGreaterThanOrEqual(4)
    expect(
      splitBar({ label: 'X', width: 300, parts: [{ label: 'a', value: 0, tone: 'target' }] }).svg
    ).toContain('No change to split')
  })
})

describe('position chart', () => {
  it('counts positions into #1, #2, #3, #4–5, #6+ and not cited', () => {
    const buckets = positionBuckets([1, 1, 2, 3, 4, 5, 6, 9, 0, 1.5], 3)
    expect(buckets.map((b) => [b.label, b.count])).toEqual([
      ['#1', 2],
      ['#2', 1],
      ['#3', 1],
      ['#4–5', 2],
      ['#6+', 2],
      ['Not cited', 3]
    ])
  })

  it('draws one column per bucket, shares add to 100%', () => {
    const chart = positionChart({
      label: 'Position',
      width: 480,
      positions: [1, 1, 2, 7],
      notCited: 2,
      idPrefix: 'pos'
    })
    expectSound(chart)
    expect(drills(chart.svg)).toEqual(['pos:1', 'pos:2', 'pos:3', 'pos:4-5', 'pos:6+', 'pos:none'])
    const shares = [...chart.svg.matchAll(/>(\d+)%</g)].map((m) => Number(m[1]))
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100)
    expect(chart.svg).toContain('cfc-t-not-cited')
    expect(positionChart({ label: 'P', width: 300, positions: [] }).svg).toContain(
      'Not cited in any answer yet'
    )
  })
})

describe('funnel', () => {
  const steps = [
    { id: 'f:tracked', label: 'Tracked', value: 120 },
    { id: 'f:shown', label: 'AI answer shown', value: 90, lostId: 'f:lost:shown' },
    { id: 'f:cited', label: 'Cited', value: 30, lostId: 'f:lost:cited' },
    { id: 'f:named', label: 'Named', value: 30 }
  ]

  it('works out shares of the first step and the drop between steps', () => {
    expect(funnelRows(steps)).toEqual([
      { value: 120, percent: 100, lost: 0 },
      { value: 90, percent: 75, lost: 30 },
      { value: 30, percent: 25, lost: 60 },
      { value: 30, percent: 25, lost: 0 }
    ])
    expect(funnelRows([{ label: 'a', value: 0 }])).toEqual([{ value: 0, percent: 0, lost: 0 }])
  })

  it('draws a bar per step and a drillable "lost here" between steps', () => {
    const chart = funnelChart({ label: 'Where visibility falls away', width: 640, steps })
    expectSound(chart)
    // Each drop is drawn just before its step.
    expect(drills(chart.svg)).toEqual([
      'f:tracked',
      'f:lost:shown',
      'f:shown',
      'f:lost:cited',
      'f:cited',
      'f:named'
    ])
    expect(chart.svg).toContain('−60 lost here')
    expect(chart.svg).toContain('none lost here')
    expect(chart.svg).toContain('90 · 75%')
    expect(funnelChart({ label: 'F', width: 300, steps: [] }).svg).toContain('No checks yet')
  })
})
