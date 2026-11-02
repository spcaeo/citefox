import type { CompetitionSection, FunnelStepModel, OpportunityBar } from '../../model/types'
import { esc } from '../escape'
import { drill } from '../parts'
import { barSvg, legend, stackSvg, type StackPart } from './bars'
import { pluralWord } from '@shared/pluralize'

/** "Where visibility falls away": each step a bar of the first step, the drop between steps written out. */
export function funnelChart(steps: readonly FunnelStepModel[]): string {
  const first = steps[0]?.count.n ?? 0
  const items = steps
    .map((step, index) => {
      const previous = index > 0 ? steps[index - 1] : undefined
      const share = first > 0 ? Math.round((step.count.n / first) * 100) : 0
      const lost = previous === undefined ? 0 : previous.count.n - step.count.n
      const drop =
        previous === undefined
          ? ''
          : `<p class="funnel-drop"><span class="drop-n">${lost > 0 ? `−${lost}` : '0'}</span>${
              step.dropReason === null ? '' : ` ${esc(step.dropReason)}`
            }</p>`
      return (
        `<li class="funnel-step">${drop}<div class="funnel-row">` +
        `<span class="funnel-label">${esc(step.label)}</span>` +
        `<span class="bar-track">${barSvg(first > 0 ? step.count.n / first : 0, 'aqua', `${step.label}: ${step.count.n}`, 22)}</span>` +
        `<span class="funnel-value">${drill(step.count, step.label)}<span class="bar-meta">${share}%</span></span>` +
        `</div></li>`
      )
    })
    .join('')
  return `<ol class="funnel" aria-label="Where visibility falls away">${items}</ol>`
}

/** Opportunity parts, the gap first. Tones validated as an adjacent set (dataviz validator). */
function opportunityParts(bar: OpportunityBar): StackPart[] {
  return [
    { value: bar.notVisible, tone: 'orange', label: 'Not visible' },
    { value: bar.namedOnly, tone: 'violet', label: 'Named only' },
    { value: bar.citedOnly, tone: 'aqua', label: 'Cited only' },
    { value: bar.winning, tone: 'blue', label: 'Already winning' }
  ]
}

/**
 * "The opportunity": one stacked bar per group, the largest "not visible" first, with
 * every part's number in its own column so each one drills.
 */
export function opportunityChart(bars: readonly OpportunityBar[], groupNoun: string): string {
  if (bars.length === 0) return '<p class="tbl-empty">No AI Overviews to break down yet.</p>'
  const rows = bars
    .map((bar) => {
      const parts = opportunityParts(bar)
      const cells = parts
        .map(
          (part) =>
            `<td class="num">${drill(part.value, `${bar.label} · ${part.label.toLowerCase()}`)}</td>`
        )
        .join('')
      return (
        `<tr class="opp-row"><th scope="row" class="opp-label">${esc(bar.label)}</th>` +
        `<td class="opp-bar">${stackSvg(parts, bar.total.n)}</td>${cells}` +
        `<td class="num opp-total">${drill(bar.total, `${bar.label} · AI Overview shown`)}</td></tr>`
      )
    })
    .join('')
  return (
    legend([
      { tone: 'orange', label: 'Not visible' },
      { tone: 'violet', label: 'Named only' },
      { tone: 'aqua', label: 'Cited only' },
      { tone: 'blue', label: 'Already winning' }
    ]) +
    `<div class="scroll plain"><table class="opp" aria-label="${esc(`The opportunity by ${groupNoun}`)}">` +
    `<thead><tr><th scope="col">${esc(capitalise(groupNoun))}</th><th scope="col" class="opp-bar-head"><span class="sr-only">Bar</span></th>` +
    `<th scope="col" class="num">Not visible</th><th scope="col" class="num">Named only</th><th scope="col" class="num">Cited only</th>` +
    `<th scope="col" class="num">Winning</th><th scope="col" class="num">AI Overviews</th></tr></thead><tbody>${rows}</tbody></table></div>`
  )
}

/** Share of voice: one stacked bar of prompts with an AI Overview, and a legend whose numbers drill. */
export function shareOfVoice(sov: CompetitionSection['sov']): string {
  const parts: StackPart[] = [
    { value: sov.you, tone: 'blue', label: 'You' },
    { value: sov.competitor, tone: 'orange', label: 'A competitor, not you' },
    { value: sov.others, tone: 'gray', label: 'Someone else only' },
    { value: sov.none, tone: 'none', label: 'No sources cited' }
  ]
  const total = sov.total.n
  const items = parts
    .filter((part) => part.tone !== 'none' || part.value.n > 0)
    .map((part) => {
      const share = total > 0 ? Math.round((part.value.n / total) * 100) : 0
      return (
        `<li><span class="swatch t-${part.tone}" aria-hidden="true"></span><span class="sov-label">${esc(part.label)}</span>` +
        `${drill(part.value, `Share of voice · ${part.label}`)}<span class="bar-meta">${share}%</span></li>`
      )
    })
    .join('')
  return (
    `<div class="sov">${stackSvg(parts, total, 28)}<ul class="sov-legend">${items}</ul>` +
    `<p class="note">Of ${drill(sov.total, 'AI Overview appears')} ${pluralWord(sov.total.n, 'prompt')} with an AI Overview.</p></div>`
  )
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]?.toUpperCase() + value.slice(1)
}
