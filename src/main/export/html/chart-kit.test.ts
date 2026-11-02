import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bucketColumns,
  funnelChart,
  gainersLosers,
  historyStrip,
  pairedBars,
  positionChart,
  rankedBars,
  splitBar
} from '../../../shared/charts'
import { REPORT_CHART_VARS, reportCss } from './style'

/**
 * The report charts look the same in the app and the downloaded report: one
 * stylesheet (src/shared/charts/charts.css), and two maps of its --cfc-* names
 * (the app's ui/chart/report-charts.css and the report's REPORT_CHART_VARS).
 */
const ROOT = process.cwd()
const KIT = readFileSync(join(ROOT, 'src/shared/charts/charts.css'), 'utf8')
const APP_MAP = readFileSync(join(ROOT, 'src/renderer/src/ui/chart/report-charts.css'), 'utf8')

function plain(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function used(css: string): Set<string> {
  return new Set([...plain(css).matchAll(/var\(\s*(--cfc-[\w-]+)/g)].map((m) => m[1] ?? ''))
}

function defined(css: string): Set<string> {
  return new Set([...plain(css).matchAll(/(--cfc-[\w-]+)\s*:/g)].map((m) => m[1] ?? ''))
}

/** Every chart with sample data, so the class check sees every class a builder writes. */
function samples(): string[] {
  const w = 600
  return [
    pairedBars({
      label: 'P',
      width: w,
      beforeLabel: 'a',
      nowLabel: 'b',
      items: [
        { id: 'x', label: 'A', sub: 'New', before: 1, now: 3, tone: 'other' },
        { id: 'y', beforeId: 'z', label: 'B', before: 0, now: 2 }
      ]
    }).svg,
    gainersLosers({
      label: 'G',
      width: w,
      limit: 1,
      items: [
        { id: 'a', label: 'a', before: 1, now: 5, highlight: true },
        { id: 'c', label: 'c', before: 1, now: 3 },
        { id: 'b', label: 'b', before: 5, now: 1 }
      ]
    }).svg,
    bucketColumns({
      label: 'B',
      width: w,
      items: [
        { id: 'q', label: '0–3', value: 0, sub: 's' },
        { label: '4–7', value: 2 }
      ]
    }).svg,
    historyStrip({
      label: 'H',
      cells: (['target', 'other', 'not-cited', 'none', 'missing'] as const).map((state, i) => ({
        id: `c${i}`,
        date: `d${i}`,
        state
      }))
    }).svg,
    rankedBars({
      label: 'R',
      width: w,
      previousLabel: 'a',
      nowLabel: 'b',
      items: [
        { id: 'r', label: 'r', value: 3, previous: 1, highlight: true },
        { label: 's', value: 2 }
      ]
    }).svg,
    splitBar({
      label: 'S',
      width: w,
      total: 10,
      parts: [
        { id: 'm', label: 'Market', value: 3, tone: 'none' },
        { id: 'w', label: 'Work', value: -1, tone: 'target' },
        { label: 'Up', value: 1, tone: 'up' },
        { label: 'Down', value: 1, tone: 'down' },
        { label: 'Muted', value: 1, tone: 'muted' },
        { label: 'Ink', value: 1, tone: 'ink' },
        { label: 'Not cited', value: 1, tone: 'not-cited' }
      ]
    }).svg,
    positionChart({ label: 'Pos', width: w, positions: [1, 4, 8], notCited: 1, idPrefix: 'p' }).svg,
    funnelChart({
      label: 'F',
      width: w,
      steps: [
        { id: 't', label: 'T', value: 10 },
        { id: 's', label: 'S', value: 6, lostId: 'l' },
        { label: 'C', value: 6 }
      ]
    }).svg,
    pairedBars({ label: 'E', width: w, beforeLabel: 'a', nowLabel: 'b', items: [] }).svg
  ]
}

/** Classes that only group or name a mark; nothing styles them on purpose. */
const STRUCTURAL = new Set([
  'cfc-mark',
  'cfc-cell',
  'cfc-drop-mark',
  'cfc-legend-row',
  'cfc-sq',
  'cfc-paired',
  'cfc-movers',
  'cfc-buckets',
  'cfc-history',
  'cfc-ranked',
  'cfc-split',
  'cfc-positions',
  'cfc-funnel'
])

describe('report chart kit stylesheet', () => {
  it('writes no colour itself: only --cfc-* names', () => {
    expect(plain(KIT)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
    for (const match of plain(KIT).matchAll(/var\(\s*(--[\w-]+)/g))
      expect(match[1]).toMatch(/^--cfc-/)
  })

  it('every --cfc-* name it uses is mapped in the app and in the report', () => {
    const names = [...used(KIT)].sort()
    expect(names.length).toBeGreaterThan(15)
    expect(names.filter((name) => !defined(APP_MAP).has(name))).toEqual([])
    expect(names.filter((name) => !defined(REPORT_CHART_VARS).has(name))).toEqual([])
  })

  it('the report inlines the kit and its colour map', () => {
    const css = reportCss('#1b7046')
    expect(css).toContain('.cfc-t-target')
    expect(css).toContain('--cfc-target: var(--r-target)')
  })

  it('styles every class the builders write', () => {
    const classes = new Set<string>()
    for (const svg of samples()) {
      for (const match of svg.matchAll(/class="([^"]*)"/g)) {
        for (const name of (match[1] ?? '').split(' '))
          if (name.startsWith('cfc-')) classes.add(name)
      }
    }
    const missing = [...classes].filter(
      (name) => !STRUCTURAL.has(name) && !KIT.includes(`.${name}`)
    )
    expect(missing).toEqual([])
  })
})
