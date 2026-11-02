import type { TrendPointModel, TrendsSection } from '../../model/types'
import { esc } from '../escape'
import { formatShortDate } from '../format'
import { legend, type Tone } from './bars'
import { pluralize } from '@shared/pluralize'

/**
 * AI Overview results over time on a time-true axis: points are spaced by the time
 * between checks. Partial checks are drawn hollow and kept out of the lines. Logged
 * fixes are vertical markers labelled "Fix N".
 */

const WIDTH = 720
const HEIGHT = 250
const LEFT = 40
const RIGHT = 18
const TOP = 30
const BOTTOM = 30
const DAY = 86_400_000

type SeriesKey = 'checked' | 'aio' | 'ownCited' | 'pageCited' | 'named'

/** `blue` is the accent (you cited); see the tone legend in style.ts. */
const SERIES: readonly { key: SeriesKey; label: string; tone: Tone }[] = [
  { key: 'checked', label: 'Prompts checked', tone: 'gray' },
  { key: 'aio', label: 'AI Overview shown', tone: 'orange' },
  { key: 'ownCited', label: 'Your domain cited', tone: 'blue' },
  { key: 'pageCited', label: 'Page cited', tone: 'aqua' },
  { key: 'named', label: 'Brand named', tone: 'violet' }
]

export function trendLineChart(trends: TrendsSection, timeZone: string): string {
  const points = trends.series.filter((point) => Number.isFinite(Date.parse(point.at)))
  if (points.length === 0) return '<p class="tbl-empty">No checks in this window yet.</p>'
  const times = [
    ...points.map((point) => Date.parse(point.at)),
    ...trends.fixes.map((fix) => Date.parse(fix.at)).filter(Number.isFinite)
  ]
  let min = Math.min(...times)
  let max = Math.max(...times)
  if (max - min < DAY) {
    min -= DAY
    max += DAY
  }
  const yMax = niceMax(Math.max(1, ...points.map((point) => point.checked)))
  const x = (iso: string): number =>
    LEFT + ((Date.parse(iso) - min) / (max - min)) * (WIDTH - LEFT - RIGHT)
  const y = (value: number): number => TOP + (1 - value / yMax) * (HEIGHT - TOP - BOTTOM)

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((step) => {
      const value = Math.round(yMax * step)
      const top = round(y(value))
      return `<line class="grid" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${top}" y2="${top}"/><text class="axis-label" x="${LEFT - 8}" y="${top + 4}" text-anchor="end">${value}</text>`
    })
    .join('')

  const fixes = trends.fixes
    .filter((fix) => Number.isFinite(Date.parse(fix.at)))
    .map((fix) => {
      const left = round(x(fix.at))
      return (
        `<g class="fix"><title>${esc(`Fix ${fix.number} · ${formatShortDate(fix.at, timeZone)} · ${fix.description}`)}</title>` +
        `<line x1="${left}" x2="${left}" y1="${TOP - 6}" y2="${HEIGHT - BOTTOM}"/>` +
        `<text class="fix-label" x="${left + 4}" y="${TOP - 10}">Fix ${fix.number}</text></g>`
      )
    })
    .join('')

  const full = points.filter((point) => !point.partial)
  const lines = SERIES.map((series) => {
    const path = full
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'}${round(x(point.at))} ${round(y(point[series.key]))}`
      )
      .join(' ')
    const line = full.length > 1 ? `<path class="line s-${series.tone}" d="${path}"/>` : ''
    const dots = points
      .map((point) => {
        const cls = point.partial ? `dot hollow s-${series.tone}` : `dot t-${series.tone}`
        const tip = `${series.label}: ${point[series.key]} · ${formatShortDate(point.at, timeZone)}${point.partial ? ' · partial check' : ''}`
        return `<circle class="${cls}" cx="${round(x(point.at))}" cy="${round(y(point[series.key]))}" r="4"><title>${esc(tip)}</title></circle>`
      })
      .join('')
    return `<g class="series">${line}${dots}</g>`
  }).join('')

  let lastLabel = -Infinity
  const labels = points
    .filter((point) => !point.partial)
    .map((point) => {
      const left = x(point.at)
      if (left - lastLabel < 64) return ''
      lastLabel = left
      return `<text class="axis-label" x="${round(left)}" y="${HEIGHT - 8}" text-anchor="middle">${esc(dayMonth(point.at, timeZone))}</text>`
    })
    .join('')

  const summary = `AI Overview results over ${pluralize(points.length, 'check')}: ${describe(points, timeZone)}`
  return (
    `<figure class="chart-figure"><svg class="line-chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${esc(summary)}">` +
    `${grid}<line class="axis" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${HEIGHT - BOTTOM}" y2="${HEIGHT - BOTTOM}"/>` +
    `${fixes}${lines}${labels}</svg>` +
    `<figcaption>${legend(SERIES.map((series) => ({ tone: series.tone, label: series.label })))}` +
    `<p class="note">Prompts per check, spaced by date. Hollow points are partial checks: they are shown but kept out of the lines and the totals.${
      trends.fixes.length > 0 ? ' Dashed lines mark logged fixes.' : ''
    }</p></figcaption></figure>`
  )
}

function describe(points: readonly TrendPointModel[], timeZone: string): string {
  return points
    .map(
      (point) =>
        `${formatShortDate(point.at, timeZone)}${point.partial ? ' (partial)' : ''} ${point.aio} of ${point.checked} with an AI Overview, ${point.ownCited} cited, ${point.named} named`
    )
    .join('; ')
}

function dayMonth(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(
    Date.parse(iso)
  )
}

function niceMax(value: number): number {
  const unit = value <= 40 ? 1 : 10 ** (Math.floor(Math.log10(value)) - 1)
  return Math.max(4, Math.ceil(value / (4 * unit)) * 4 * unit)
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
