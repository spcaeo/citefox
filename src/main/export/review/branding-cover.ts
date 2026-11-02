import type { ReportByline } from '@shared/report/review'
import { esc } from '../html/escape'

/**
 * Who the downloaded report is from (Settings › Reports, src/shared/report/review/sender.ts):
 * the cover header (agency or company left; "Prepared for <client or team>" right) and the
 * footer. With no byline the caller keeps today's look exactly.
 */

function initial(name: string): string {
  return esc((name.trim()[0] ?? '·').toUpperCase())
}

function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`
}

/** The cover's top row. */
export function brandedHeaderHtml(byline: ReportByline): string {
  const mark =
    byline.fromLogo === null
      ? `<span class="rv-from-mark" aria-hidden="true">${initial(byline.fromName)}</span>`
      : `<img class="rv-from-logo" src="${esc(byline.fromLogo)}" alt="${esc(byline.fromName)}">`
  const contact = [
    byline.fromWebsite
      ? `<a href="${esc(websiteHref(byline.fromWebsite))}" target="_blank" rel="noopener noreferrer">${esc(byline.fromWebsite)}</a>`
      : '',
    byline.fromEmail ? `<a href="mailto:${esc(byline.fromEmail)}">${esc(byline.fromEmail)}</a>` : ''
  ].filter((part) => part !== '')
  const from =
    `<div class="rv-from">${mark}<span class="rv-from-text"><strong class="rv-from-name">${esc(byline.fromName)}</strong>` +
    `${contact.length > 0 ? `<span class="rv-from-contact">${contact.join(' · ')}</span>` : ''}</span></div>`
  const forLogo =
    byline.forLogo === null
      ? ''
      : `<img class="rv-client-logo" src="${esc(byline.forLogo)}" alt="${esc(byline.forName || 'Logo')}">`
  const forSide =
    byline.forName === '' && forLogo === ''
      ? ''
      : `<div class="rv-for">${byline.forName ? `<span>Prepared for<br><strong>${esc(byline.forName)}</strong></span>` : ''}${forLogo}</div>`
  return `<div class="rv-byline" data-testid="report-byline" data-mode="${byline.mode}">${from}${forSide}</div>`
}

/** The last line of the file. */
export function brandedFooterHtml(byline: ReportByline, builtLabel: string): string {
  const left = byline.preparedBy
    ? `<span data-testid="prepared-by">Prepared by <strong>${esc(byline.preparedBy)}</strong> · Every number opens the list behind it</span>`
    : '<span><strong>Built with CiteFox</strong></span>'
  const right = `${byline.preparedBy ? 'Built with CiteFox · ' : ''}Built ${esc(builtLabel)} · Works offline, no network requests`
  return `<footer class="foot">${left}<span>${right}</span></footer>`
}

export function brandingCss(): string {
  return `/* Report byline (Settings › Reports) */
.rv-byline { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px solid var(--line); }
.rv-from { display: flex; align-items: center; gap: 12px; min-width: 0; }
.rv-from-mark { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; background: var(--ink); color: var(--surface); font-weight: 700; flex: none; }
.rv-from-logo { max-height: 44px; max-width: 160px; object-fit: contain; flex: none; }
.rv-from-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rv-from-name { font-size: 16px; color: var(--ink); }
.rv-from-contact { color: var(--ink-2); font-size: 12px; overflow-wrap: anywhere; }
.rv-from-contact a { color: inherit; }
.rv-for { display: flex; align-items: center; gap: 12px; text-align: right; color: var(--ink-2); font-size: 12px; }
.rv-for strong { color: var(--ink); font-size: 15px; }
@media (max-width: 600px) { .rv-byline { flex-direction: column; align-items: flex-start; } .rv-for { text-align: left; } }
`
}
