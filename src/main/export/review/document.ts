import { isEngineId } from '@shared/domain'
import type { MetricsResult } from '@shared/metrics'
import {
  NO_BRANDING,
  SECTION_TITLES,
  type ReportBranding,
  type ReportByline,
  type ReviewReport
} from '@shared/report/review'
import { sponsorHref, sponsorOf } from '@shared/sponsors'
import { ENGINE_LOGOS } from './engine-logos'
import { CLIENT_SCRIPT } from '../html/client/app'
import type { RenderContext } from '../html/context'
import { CONTENT_SECURITY_POLICY, DEFAULT_ACCENT, DRAWER_SHELL } from '../html/document'
import { drillCss } from '../html/style-drill'
import { esc, jsonForScript } from '../html/escape'
import { reportCss } from '../html/style'
import { perspectivesCss } from '../html/style-perspectives'
import { drillsOf, rowsOf } from './data'
import { groupedSections, navHtml } from './nav'
import { SECTION_HTML, type ViewCtx } from './sections'
import { emptyHtml, needsHtml } from './sections-impact'
import { reviewCss } from './style'
import { changedCss } from './style-changed'
import { coverHtml } from './sections-changed'
import { impactCss } from './style-impact'
import { sourcesCss } from './sections-sources'
import { brandedFooterHtml, brandedHeaderHtml, brandingCss } from './branding-cover'

/** One engine's version of the report: All engines first, then each engine on offer. */
export interface ReviewVariant {
  /** `all` or an engine id. */
  view: string
  label: string
  report: ReviewReport
  metrics: MetricsResult
}

export interface ReviewDocumentInput {
  title: string
  domain: string
  scopeLabel: string
  marketLabel: string
  builtLabel: string
  fileBase: string
  variants: readonly ReviewVariant[]
  /** "Prepared for" line; empty name and no logo: none. */
  branding?: ReportBranding
  /** Who the report is from (Settings › Reports). Absent or null: today's look exactly. */
  byline?: ReportByline | null
}

function engineButton(variant: ReviewVariant, pressed: boolean): string {
  const logo = isEngineId(variant.view)
    ? `<img class="rv-logo" src="${ENGINE_LOGOS[variant.view]}" alt="" width="18" height="18">`
    : ''
  return `<button type="button" class="seg needs-js rv-eng" data-switch="engine" data-value="${esc(variant.view)}" aria-pressed="${pressed}">${logo}<span>${esc(variant.view === 'all' ? 'All engines' : variant.label)}</span></button>`
}

function preparedFor(branding: ReportBranding): string {
  if (branding.preparedFor === '' && branding.logo === null) return ''
  const logo =
    branding.logo === null
      ? ''
      : `<img class="rv-client-logo" src="${esc(branding.logo)}" alt="${esc(branding.preparedFor || 'Logo')}">`
  const name =
    branding.preparedFor === ''
      ? ''
      : `<span>Prepared for <strong>${esc(branding.preparedFor)}</strong></span>`
  return `<p class="rv-prepared" data-testid="prepared-for">${logo}${name}</p>`
}

/** The sponsors, once, at the end: FoxCue (gold), then FreshlyCited (silver). */
export function sponsorBand(): string {
  const card = (tier: 'gold' | 'silver'): string => {
    const sponsor = sponsorOf(tier)
    const { ground, ink, accent, onAccent } = sponsor.colors
    return (
      `<a class="rv-sponsor rv-sponsor-${tier}" href="${esc(sponsorHref(sponsor))}" target="_blank" rel="noopener noreferrer" style="background:${ground};color:${ink}">` +
      `<span class="rv-sponsor-tier" style="color:${accent}">${tier === 'gold' ? 'Gold sponsor' : 'Silver sponsor'}</span>` +
      `<strong>${esc(sponsor.name)}</strong><span class="rv-sponsor-line">${esc(sponsor.tagline)}</span>` +
      `<span class="rv-sponsor-cta" style="background:${accent};color:${onAccent}">${esc(sponsor.cta)}</span></a>`
    )
  }
  return `<aside class="rv-sponsors" aria-label="CiteFox sponsors"><p class="rv-sponsors-title">CiteFox is free and open source, made possible by</p><div class="rv-sponsors-row">${card('gold')}${card('silver')}</div></aside>`
}

/** What changed: the cover strip per engine view, switched with the engine. */
function coverPanels(variants: readonly ReviewVariant[], tables: RenderContext['tables']): string {
  return variants
    .map((variant, index) => {
      const ctx: ViewCtx = { view: variant.view, report: variant.report, tables }
      return `<div data-switch-panel="engine" data-value="${esc(variant.view)}"${index === 0 ? '' : ' hidden'}>${coverHtml(ctx)}</div>`
    })
    .join('')
}

const ICON_PATH = 'M5 19c2-6 5-9 7-14 2 5 5 8 7 14M8.5 13.5h7'

/**
 * The downloaded ready report: one self-contained HTML file with the same sections and
 * numbers as the app. The engine switch shows each engine's own numbers (every view is
 * pre-rendered; only All engines shows without the script and in print).
 */
export function reviewDocumentHtml(input: ReviewDocumentInput): string {
  const first = input.variants[0]
  if (first === undefined) throw new Error('A report needs at least one view.')
  const tables: RenderContext['tables'] = {}
  const sections = groupedSections(first.report)
  const body = sections
    .map((section) => {
      const panels = input.variants
        .map((variant, index) => {
          const ctx: ViewCtx = { view: variant.view, report: variant.report, tables }
          const empty = variant.report.sections.find((item) => item.id === section.id)?.empty
          const html = empty !== undefined ? emptyHtml(empty) : SECTION_HTML[section.id](ctx)
          return `<div data-switch-panel="engine" data-value="${esc(variant.view)}"${index === 0 ? '' : ' hidden'}>${html}</div>`
        })
        .join('')
      return (
        `<section id="sec-${section.id}" class="report-section" data-section="${section.id}" aria-labelledby="sec-${section.id}-title">` +
        `<header class="sec-head"><h2 id="sec-${section.id}-title">${esc(SECTION_TITLES[section.id])}${section.alert ? ' <span class="tag tag-warn">Needs a look</span>' : ''}</h2></header>${panels}</section>`
      )
    })
    .join('\n')
  const nav = navHtml(first.report)
  const engines =
    input.variants.length > 1
      ? `<div class="seg-bar rv-engines" role="group" aria-label="Engine">${input.variants
          .map((variant, index) => engineButton(variant, index === 0))
          .join('')}</div><p class="lede rv-engine-print">${esc(first.label)}</p>`
      : `<p class="lede rv-engine-one">${isEngineId(first.view) ? `<img class="rv-logo" src="${ENGINE_LOGOS[first.view]}" alt="" width="18" height="18"> ` : ''}${esc(first.label)}</p>`
  const rows = input.variants.flatMap((variant) =>
    rowsOf(variant.view, variant.report, variant.metrics, {
      marketLabel: input.marketLabel,
      engineLabel: variant.label
    })
  )
  const drills = Object.assign({}, ...input.variants.map((v) => drillsOf(v.view, v.report)))
  const engineMeta =
    first.view === 'all'
      ? input.variants
          .slice(1)
          .flatMap((variant) =>
            isEngineId(variant.view)
              ? [{ id: variant.view, label: variant.label, logo: ENGINE_LOGOS[variant.view] }]
              : []
          )
      : []
  const data = {
    file: input.fileBase,
    rows,
    drills,
    tables,
    ...(engineMeta.length > 1 ? { engines: engineMeta } : {})
  }
  const accent = DEFAULT_ACCENT
  const pageTitle = `${input.domain} — ${input.title} — ${first.report.windowLabel}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="CiteFox">
<meta name="color-scheme" content="light">
<title>${esc(pageTitle)}</title>
<style>
${reportCss(accent)}
${perspectivesCss()}
${drillCss()}
${reviewCss()}
${changedCss()}
${impactCss()}
${sourcesCss()}${input.byline ? `\n${brandingCss()}` : ''}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to the report</a>
<div id="app">
<header class="topbar">
<div class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${ICON_PATH}"/></svg></span><span class="brand-text"><span class="brand-domain">${esc(input.domain)}</span><span class="brand-scope">${esc(input.title)} · ${esc(input.scopeLabel)}</span></span></div>
<div class="search needs-js" role="search"><label for="search" class="sr-only">Search all questions</label><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="search" type="search" placeholder="Search questions" autocomplete="off" spellcheck="false" aria-describedby="search-status"><p id="search-status" class="search-status" aria-live="polite"></p></div>
<div class="actions-bar needs-js"><button type="button" id="focus-toggle" class="btn" aria-pressed="false"><span class="btn-text">Focus</span></button><button type="button" id="theme-toggle" class="btn" aria-pressed="false"><span class="btn-text">Dark</span></button><button type="button" id="copy-view" class="btn"><span class="btn-text">Copy link</span></button><button type="button" id="print-btn" class="btn"><span class="btn-text">Print</span></button></div>
</header>
<div class="layout">
<nav class="nav" aria-label="Report sections"><p class="nav-title">Sections</p><ol>${nav}</ol></nav>
<main id="main" tabindex="-1">
<section class="report-section rv-cover" aria-label="About this report">
${input.byline ? brandedHeaderHtml(input.byline) : ''}<p class="eyebrow">${esc(input.title)}</p>
<h1 class="rv-title">${esc(input.domain)}</h1>
<p class="lede">${esc(first.report.windowLabel)} · ${esc(input.scopeLabel)} · ${esc(input.marketLabel)}</p>
${first.report.kind === 'impact' ? `<p class="lede rv-meta" data-testid="report-meta">${esc(first.report.impact.intro.meta)}</p>` : ''}
${input.byline ? '' : preparedFor(input.branding ?? NO_BRANDING)}
${engines}
${first.report.kind === 'changed' ? coverPanels(input.variants, tables) : ''}
${first.report.needs !== null ? needsHtml(first.report.needs) : ''}
</section>
${body}
${sponsorBand()}
${input.byline ? brandedFooterHtml(input.byline, input.builtLabel) : `<footer class="foot"><span><strong>Built with CiteFox</strong></span><span>Built ${esc(input.builtLabel)} · Works offline, no network requests</span></footer>`}
</main>
</div>
</div>
${DRAWER_SHELL}
<script id="report-data" type="application/json">${jsonForScript(data)}</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>
`
}
