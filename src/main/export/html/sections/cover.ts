import type { RenderContext, RenderedSection } from '../context'
import { esc, link } from '../escape'
import { promptsTrackedText } from '@shared/report-copy'
import { longDate, marketText } from '../format'

/** Section 1: what the report covers, when it was built and from which data. */
export function renderCover(ctx: RenderContext): RenderedSection {
  const { cover, markets, pages } = ctx.model
  const tz = ctx.timeZone
  const prefix = 'AI visibility report — '
  const heading = cover.title.startsWith(prefix) ? cover.title.slice(prefix.length) : cover.title
  const trackedPage =
    cover.scope === 'page' ? pages.find((page) => page.role === 'tracked') : undefined
  const window =
    cover.windowFrom === null || cover.windowTo === null
      ? 'No finished checks in this window'
      : `${longDate(cover.windowFrom, tz)} → ${longDate(cover.windowTo, tz)}`
  const facts: [string, string][] = [
    ['Built', esc(longDate(cover.builtAt, tz))],
    ['Data window', esc(window)],
    [
      markets.length === 1 ? 'Market' : 'Markets',
      markets.map((market) => `<span class="market">${esc(marketText(market))}</span>`).join(' ') ||
        '—'
    ],
    ['Prompts tracked', esc(promptsTrackedText(cover.promptsTracked, markets.length))],
    ['Brands looked for', esc(cover.brands.join(', ') || '—')],
    ['Competitors', esc(cover.competitors.join(', ') || 'None configured')],
    ['Tracked pages', esc(String(cover.trackedPages))],
    [
      'Templates used',
      cover.templates.length === 0
        ? '—'
        : cover.templates
            .map(
              (template) =>
                `<span class="tpl">${esc(template.name)} · ${esc(template.kind.replace(/_/g, ' '))} <code>${esc(template.hash.slice(0, 8))}</code></span>`
            )
            .join('')
    ]
  ]
  if (cover.clientName !== null) facts.unshift(['Prepared for', esc(cover.clientName)])
  const dl = facts
    .map(
      ([term, value]) =>
        `<div class="fact${term === 'Templates used' ? ' fact-span' : ''}"><dt>${esc(term)}</dt><dd>${value}</dd></div>`
    )
    .join('')
  const pageLink =
    trackedPage === undefined
      ? ''
      : `<p class="cover-url">${link(trackedPage.url, trackedPage.url)}</p>`
  const html =
    `<section id="sec-cover" class="report-section cover" data-section="cover" aria-labelledby="sec-cover-title">` +
    `<p class="eyebrow">AI visibility report · ${esc(cover.domain)}</p>` +
    `<h1 id="sec-cover-title">${esc(heading)}</h1>` +
    `<p class="cover-scope"><span class="scope-chip">${esc(cover.scopeLabel)}</span>${
      cover.projectName.length > 0
        ? `<span class="cover-project">${esc(cover.projectName)}</span>`
        : ''
    }</p>${pageLink}` +
    `<p class="cover-headline" data-testid="report-headline">${esc(ctx.model.headline)}</p>` +
    `<dl class="facts">${dl}</dl>` +
    `<p class="note cover-note">Google AI Overviews only. Click any prompt count to see the prompts behind it.</p>` +
    `</section>`
  return { id: 'cover', anchor: 'sec-cover', title: 'Cover', html, subs: [] }
}
