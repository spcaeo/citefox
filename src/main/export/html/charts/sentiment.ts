import type { ReputationSection } from '../../model/types'
import { esc } from '../escape'
import { formatShortDate } from '../format'
import { drill } from '../parts'
import { legend, type Tone } from './bars'

/** Sentiment: a donut of the split with a legend whose numbers drill, and claims per check by tone. */

const TONES: readonly { key: 'positive' | 'neutral' | 'negative'; label: string; tone: Tone }[] = [
  { key: 'positive', label: 'Positive', tone: 'aqua' },
  { key: 'neutral', label: 'Neutral', tone: 'gray' },
  { key: 'negative', label: 'Negative', tone: 'red' }
]

export function sentimentDonut(section: ReputationSection): string {
  const total = section.positive.n + section.neutral.n + section.negative.n
  const radius = 42
  const circumference = 2 * Math.PI * radius
  let offset = 0
  const arcs = TONES.map((tone) => {
    const n = section[tone.key].n
    if (total === 0 || n === 0) return ''
    const length = (n / total) * circumference
    const arc = `<circle class="arc s-${tone.tone}" cx="60" cy="60" r="${radius}" stroke-dasharray="${round(length)} ${round(circumference - length)}" stroke-dashoffset="${round(-offset)}"><title>${esc(`${tone.label}: ${n}`)}</title></circle>`
    offset += length
    return arc
  }).join('')
  const items = TONES.map((tone) => {
    const count = section[tone.key]
    const share = total > 0 ? Math.round((count.n / total) * 100) : 0
    return `<li><span class="swatch t-${tone.tone}" aria-hidden="true"></span><span class="sov-label">${tone.label}</span>${drill(count, `${tone.label} answers`)}<span class="bar-meta">${share}%</span></li>`
  }).join('')
  const net =
    section.net === null ? 'Not enough data' : `${section.net > 0 ? '+' : ''}${section.net}`
  return (
    `<div class="donut-wrap"><svg class="donut" viewBox="0 0 120 120" role="img" aria-label="${esc(
      TONES.map((tone) => `${tone.label} ${section[tone.key].n}`).join(', ')
    )}"><circle class="donut-track" cx="60" cy="60" r="${radius}"/><g transform="rotate(-90 60 60)">${arcs}</g>` +
    `<text class="donut-n" x="60" y="58" text-anchor="middle">${esc(net)}</text><text class="donut-sub" x="60" y="76" text-anchor="middle">net</text></svg>` +
    `<ul class="sov-legend">${items}</ul></div>`
  )
}

/** Claims per check by tone, as stacked columns spaced evenly. */
export function sentimentColumns(section: ReputationSection, timeZone: string): string {
  if (section.trend.length === 0)
    return '<p class="tbl-empty">One check so far. The trend appears after the next one.</p>'
  const width = 440
  const height = 170
  const max = Math.max(
    1,
    ...section.trend.map((point) => point.positive + point.neutral + point.negative)
  )
  const slot = (width - 48) / section.trend.length
  const barWidth = Math.min(36, slot * 0.6)
  const columns = section.trend
    .map((point, index) => {
      let top = height - 26
      const left = 48 + index * slot + (slot - barWidth) / 2
      const rects = TONES.map((tone) => {
        const value = point[tone.key]
        const h = (value / max) * (height - 50)
        top -= h
        return value > 0
          ? `<rect class="t-${tone.tone} seg" x="${round(left)}" y="${round(top)}" width="${round(barWidth)}" height="${round(h)}"><title>${esc(`${tone.label}: ${value} · ${formatShortDate(point.at, timeZone)}`)}</title></rect>`
          : ''
      }).join('')
      return `${rects}<text class="axis-label" x="${round(left + barWidth / 2)}" y="${height - 8}" text-anchor="middle">${esc(formatShortDate(point.at, timeZone).replace(/ \d{4}$/, ''))}</text>`
    })
    .join('')
  return (
    `<figure class="chart-figure"><svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Claims per check by tone">` +
    `<line class="axis" x1="48" x2="${width}" y1="${height - 26}" y2="${height - 26}"/>${columns}</svg>` +
    `<figcaption>${legend(TONES.map((tone) => ({ tone: tone.tone, label: tone.label })))}</figcaption></figure>`
  )
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
