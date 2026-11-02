import { esc } from './escape'

/**
 * The owner's copy/open rule in the downloaded reports (Docs/REPORT-SPEC.md "Copy and
 * open"), the same as UrlText / CopyText in the app: hovering or focusing a value shows
 * Copy at its end, and Open in a new tab for a web address, domain or site path. Copy
 * turns into a green tick, then the icons hide until the pointer comes back (the report
 * script, `client/app.ts`, does the copying). On touch screens they always show; in
 * print they are hidden. Every helper returns HTML; text arguments are plain text.
 */

export const COPY_ICON =
  '<svg class="cp-i cp-i-copy" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12.5" height="12.5" rx="2"/><path d="M16 8V5.5A2 2 0 0 0 14 3.5H5.5a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2H8"/></svg>'
export const TICK_ICON =
  '<svg class="cp-i cp-i-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
export const OPEN_ICON =
  '<svg class="cp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'

const WEB = /^https?:\/\//i

/** `https://www.example.com/a/` → `example.com/a/`. */
export function shortAddress(url: string): string {
  if (!WEB.test(url)) return url
  const shown = url.replace(WEB, '').replace(/^www\./i, '')
  return /^[^/]+\/$/.test(shown) ? shown.slice(0, -1) : shown
}

/**
 * Any value with Copy (and Open when `open` is a web address). `innerHtml` is what is
 * shown, already escaped; it may be the value's own drawer button.
 */
export function copyable(
  innerHtml: string,
  value: string,
  open: string | null = null,
  options: { own?: boolean; kind?: 'url' | 'text' } = {}
): string {
  const href = open !== null && WEB.test(open) ? open : null
  const kind = options.kind ?? (href === null ? 'text' : 'url')
  const cls = `cp cp-${kind}${options.own === true ? ' cp-own' : ''}`
  const openLink =
    href === null
      ? ''
      : `<a class="cp-btn cp-open" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`Open ${value} in a new tab`)}" title="Open in a new tab">${OPEN_ICON}</a>`
  return (
    `<span class="${cls}"><span class="cp-v">${innerHtml}</span><span class="cp-acts">` +
    `<button type="button" class="cp-btn cp-copy needs-js" data-copy="${esc(value)}" aria-label="${esc(`Copy ${value}`)}" title="Copy">${COPY_ICON}${TICK_ICON}</button>` +
    `${openLink}</span></span>`
  )
}

/** A web address: Copy + Open. `label` (plain text) defaults to the short address. */
export function urlCopy(url: string, label?: string | null, own = false): string {
  const text = label ?? shortAddress(url)
  const inner = label ? esc(text) : `<span class="path">${esc(text)}</span>`
  return copyable(inner, url, url, { own })
}

/**
 * A page of the site, shown as its path; Copy and Open use the full address. `innerHtml`
 * replaces the shown path, such as the button that opens the page's drawer.
 */
export function pageCopy(url: string, path: string, innerHtml?: string): string {
  return copyable(innerHtml ?? `<span class="path">${esc(path)}</span>`, url, url, { kind: 'url' })
}

/** A site: Copy the domain, Open its home page. Your own site keeps the highlight. */
export function domainCopy(domain: string, own = false, innerHtml?: string): string {
  const href = WEB.test(domain) ? domain : `https://${domain.replace(/^\/+/, '')}`
  return copyable(innerHtml ?? esc(domain), domain, href, { own, kind: 'url' })
}

/** A question, quote or anchor text: Copy only. `innerHtml` replaces the shown text. */
export function textCopy(text: string, innerHtml?: string): string {
  return copyable(innerHtml ?? esc(text), text, null, { kind: 'text' })
}

/** The styles, shared by every downloaded report (added by `reportCss`). */
export const COPY_CSS = `
.cp { display: inline-flex; align-items: flex-start; gap: 4px; max-width: 100%; vertical-align: top; }
.cp-v { min-width: 0; overflow-wrap: anywhere; }
.cp-own > .cp-v { padding: 0 3px; border-radius: 3px; background: var(--accent-soft); color: var(--ink); }
.cp-acts { display: inline-flex; flex: none; gap: 2px; margin-inline-end: -52px; opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
.cp-text > .cp-acts { margin-inline-end: -26px; }
.cp:hover > .cp-acts, .cp:focus-within > .cp-acts, .cp.cp-done > .cp-acts, tr:focus-within .cp > .cp-acts { margin-inline-end: 0; opacity: 1; pointer-events: auto; }
.cp.cp-hide > .cp-acts { margin-inline-end: -52px; opacity: 0; pointer-events: none; }
.cp-text.cp-hide > .cp-acts { margin-inline-end: -26px; }
.cp-btn { display: inline-grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); color: var(--ink-2); cursor: pointer; text-decoration: none; }
.cp-btn:hover, .cp-btn:focus-visible { border-color: var(--line-strong); color: var(--ink); }
.cp-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.cp-i { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.cp-i-tick { display: none; }
.cp-done .cp-copy { border-color: var(--good); background: var(--good-soft); color: var(--good); }
.cp-done .cp-i-copy { display: none; }
.cp-done .cp-i-tick { display: block; }
@media (hover: none) { .cp > .cp-acts, .cp.cp-hide > .cp-acts { margin-inline-end: 0; opacity: 1; pointer-events: auto; } }
@media print { .cp-acts { display: none !important; } .cp-own > .cp-v { background: none; padding: 0; } }
`
