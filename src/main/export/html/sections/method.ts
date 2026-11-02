import { AGREEMENT_TAIL, METHOD_SOURCE, METHOD_TITLE } from '@shared/report/method'
import type { RenderContext, RenderedSection } from '../context'
import { esc } from '../escape'
import { marketById, shortDate } from '../format'
import { card, drill, perspectiveShell } from '../parts'

export { METHOD_TITLE }

/**
 * "How this report was made": scope, source, what was searched and when, a sample-size
 * warning for small sets, then how to read the numbers. Always last.
 */
export function renderMethod(ctx: RenderContext): RenderedSection {
  const method = ctx.model.method
  const tz = ctx.timeZone
  const window =
    method.windowFrom === null || method.windowTo === null
      ? 'No finished checks in this window'
      : `${shortDate(method.windowFrom, tz)} → ${shortDate(method.windowTo, tz)}`
  const compared =
    method.previousAt === null
      ? 'No earlier full check yet'
      : `${shortDate(method.previousAt, tz)} → ${shortDate(method.currentAt, tz)}`
  const markets = method.marketIds.map(
    (id) => `<span class="market">${esc(marketById(ctx.model, id))}</span>`
  )
  const facts: [string, string][] = [
    ['Scope', esc(method.scopeLabel)],
    ['Source', esc(METHOD_SOURCE)],
    [
      'Prompts searched',
      `${drill(method.questions, 'Every prompt in this report')} on Google, for ${esc(
        method.trackedPages === 1 ? '1 tracked page' : `${method.trackedPages} tracked pages`
      )}`
    ],
    [method.marketIds.length === 1 ? 'Market' : 'Markets', markets.join(' ') || '—'],
    ['Data window', esc(window)],
    ['Before vs after', esc(compared)]
  ]
  const dl = facts
    .map(([term, value]) => `<div class="fact"><dt>${esc(term)}</dt><dd>${value}</dd></div>`)
    .join('')
  const agreement =
    method.agreement === null
      ? ''
      : `<p class="method-agree" data-testid="method-agreement">Both checks agree on ${drill(
          method.agreement.agree,
          'Both checks say the same'
        )} of ${drill(method.agreement.total, 'Measured by both checks')} ${
          method.agreement.total.n === 1 ? 'prompt' : 'prompts'
        } (${method.agreement.percent}%)${esc(AGREEMENT_TAIL)}</p>`
  const notes: [string, string][] = [
    ['Cited and named', method.copy.cited],
    ['Answers vary', method.copy.vary],
    ['Full checks only', method.copy.partial],
    ['Before vs after', method.copy.change]
  ]
  const cards = notes
    .map(([title, text]) =>
      card(`<p class="chart-title">${esc(title)}</p><p class="method-text">${esc(text)}</p>`)
    )
    .join('')
  const warning =
    method.sampleWarning === null
      ? ''
      : `<p class="method-warn" role="note" data-testid="method-sample">${esc(method.sampleWarning)}</p>`
  const body =
    `<dl class="facts method-facts">${dl}</dl>` +
    warning +
    `<div class="method-grid">${cards}</div>` +
    (agreement === '' ? '' : card(agreement, 'method-card'))
  return perspectiveShell(
    'method',
    METHOD_TITLE,
    'What was searched and when, and how to read the numbers in this report.',
    body
  )
}
