import type { ReportModel } from '../model/types'
import { CLIENT_SCRIPT, CLIENT_SCRIPT_HASH } from './client/app'
import type { RenderedSection } from './context'
import { esc, safeColor } from './escape'
import { longDate } from './format'
import { reportCss } from './style'
import { drillCss } from './style-drill'
import { perspectivesCss } from './style-perspectives'

/** The document shell: head, header, section nav, main, drawer, embedded data and the app script. */

export const DEFAULT_ACCENT = '#C2410C'

/**
 * The side panel, its scrim, the toast and the copy box: the same in every downloaded
 * report (the report script drives them).
 */
export const DRAWER_SHELL = `<div id="scrim" class="scrim" hidden></div>
<div id="drawer" class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" hidden>
<div class="drawer-head"><button type="button" id="drawer-back" class="btn back-btn" aria-label="Back one step" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg><span class="btn-text">Back</span></button><div class="drawer-titles"><nav id="drawer-trail" class="trail" aria-label="Where you are" hidden></nav><h2 id="drawer-title" tabindex="-1">Prompts</h2><p id="drawer-sub" class="drawer-sub"></p></div><div class="drawer-tools"><button type="button" id="drawer-csv" class="btn" title="Download these rows as CSV">CSV</button><button type="button" id="drawer-urls" class="btn" title="Copy every URL in this list" hidden>Copy all URLs</button><button type="button" id="drawer-link" class="btn" title="Copy a link to this view">Copy link</button><button type="button" id="drawer-close" class="btn">Close</button></div></div>
<div id="drawer-body" class="drawer-body"></div>
</div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<div id="copy-box" class="copy-box" role="dialog" aria-labelledby="copy-box-title" hidden><p id="copy-box-title" class="copy-box-title">Copying is blocked here. Select the text below and copy it (Ctrl+C or Cmd+C).</p><textarea id="copy-text" readonly rows="3" aria-labelledby="copy-box-title"></textarea><button type="button" id="copy-done" class="btn">Done</button></div>`

/** The page's policy. The only script allowed is {@link CLIENT_SCRIPT}, by hash. */
export const CONTENT_SECURITY_POLICY = `default-src 'none'; script-src 'sha256-${CLIENT_SCRIPT_HASH}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`

const ICON_PATH = 'M5 19c2-6 5-9 7-14 2 5 5 8 7 14M8.5 13.5h7'

function favicon(accent: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${accent}"/><path d="${ICON_PATH}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export interface DocumentInput {
  model: ReportModel
  sections: readonly RenderedSection[]
  /** Already serialised with {@link jsonForScript}. */
  dataJson: string
}

export function documentHtml(input: DocumentInput): string {
  const { model, sections, dataJson } = input
  const { cover } = model
  const accent = safeColor(cover.brandColor, DEFAULT_ACCENT)
  const title = `${cover.domain} — AI visibility report — ${cover.scopeLabel}`
  const nav = sections
    .map((section) => {
      const subs =
        section.subs.length === 0
          ? ''
          : `<ol>${section.subs
              .map(
                (sub) =>
                  `<li><a href="#${esc(sub.id)}" data-target="${esc(sub.id)}" data-level="2">${esc(sub.title)}</a></li>`
              )
              .join('')}</ol>`
      return `<li><a href="#${esc(section.anchor)}" data-target="${esc(section.anchor)}" data-level="1">${esc(section.title)}</a>${subs}</li>`
    })
    .join('')
  const built = longDate(cover.builtAt, cover.timeZone)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="CiteFox">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
<link rel="icon" href="${esc(favicon(accent))}">
<style>
${reportCss(accent)}
${perspectivesCss()}
${drillCss()}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to the report</a>
<div id="app">
<header class="topbar">
<div class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${ICON_PATH}"/></svg></span><span class="brand-text"><span class="brand-domain">${esc(cover.domain)}</span><span class="brand-scope">${esc(cover.scopeLabel)}</span></span></div>
<div class="search needs-js" role="search"><label for="search" class="sr-only">Search all prompts</label><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="search" type="search" placeholder="Search prompts, pages, markets" autocomplete="off" spellcheck="false" aria-describedby="search-status"><p id="search-status" class="search-status" aria-live="polite"></p></div>
<div class="actions-bar needs-js"><button type="button" id="focus-toggle" class="btn" aria-pressed="false" title="Hide the section list"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/></svg><span class="btn-text">Focus</span></button><button type="button" id="theme-toggle" class="btn" aria-pressed="false" title="Show the report dark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg><span class="btn-text">Dark</span></button><button type="button" id="copy-view" class="btn" title="Copy a link to this view of the report"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg><span class="btn-text">Copy link</span></button><button type="button" id="print-btn" class="btn" title="Print or save as PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z"/></svg><span class="btn-text">Print</span></button></div>
</header>
<div class="layout">
<nav class="nav" aria-label="Report sections"><p class="nav-title">Sections</p><ol>${nav}</ol></nav>
<main id="main" tabindex="-1">
${sections.map((section) => section.html).join('\n')}
<footer class="foot"><span><strong>Built with CiteFox</strong> · Google AI Overviews only</span><span>Built ${esc(built)} · Works offline, no network requests</span></footer>
</main>
</div>
</div>
${DRAWER_SHELL}
<script id="report-data" type="application/json">${dataJson}</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>
`
}
