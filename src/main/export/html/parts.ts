import type { PromptCheckStatus, ReportSectionId } from '@shared/domain'
import { REPORT_SECTION_COPY } from '@shared/report-copy'
import type { Count, DomainWho, EmptyState } from '../model/types'
import type { PerspectiveSectionId, RenderedSection, SubLink } from './context'
import { esc } from './escape'
import { STATUS_CLASSES, STATUS_LABELS, WHO_LABELS } from './format'

/** Small building blocks shared by every section. They return HTML strings. */

/**
 * A clickable number. A count with a drill is a button whose text is exactly `n`; the
 * drawer lists the `n` prompts behind it. A count without a drill is plain text.
 */
export function drill(count: Count, label: string, className = ''): string {
  const cls = className.length > 0 ? ` ${className}` : ''
  if (count.drill === null) return `<span class="num${cls}">${count.n}</span>`
  return (
    `<button type="button" class="drill${cls}" data-drill="${esc(count.drill)}" data-n="${count.n}"` +
    ` data-label="${esc(label)}" aria-label="${esc(`${count.n} — ${label}. Show the prompts`)}">${count.n}</button>`
  )
}

/** Opens the drawer on one prompt's answer. Used where a list item stands for a single prompt. */
export function rowButton(rowId: string, label: string): string {
  return `<button type="button" class="link-btn" data-open="q:${esc(rowId)}" aria-label="${esc(`See the answer for: ${label}`)}">See prompt</button>`
}

/**
 * Text that opens a drawer step: `q:<row id>` a prompt's answer, `p:<page url>` a page's
 * prompts, `dom:<domain>` the prompts citing a site. `html` must already be escaped.
 */
export function opener(entry: string, html: string, label: string): string {
  return `<button type="button" class="open-btn" data-open="${esc(entry)}" aria-label="${esc(label)}">${html}</button>`
}

export interface KpiSpec {
  label: string
  /** HTML: usually {@link drill} or an escaped number. */
  value: string
  sub?: string
  /** Tone of the tile's top rule. */
  tone?: 'accent' | 'good' | 'warn' | 'plain'
}

export function kpi(spec: KpiSpec): string {
  const tone = spec.tone ?? 'plain'
  const sub = spec.sub === undefined ? '' : `<p class="kpi-sub">${esc(spec.sub)}</p>`
  return `<div class="kpi kpi-${tone}"><p class="kpi-label">${esc(spec.label)}</p><p class="kpi-value">${spec.value}</p>${sub}</div>`
}

export function kpis(tiles: readonly string[]): string {
  return `<div class="kpis">${tiles.join('')}</div>`
}

/** Plain escaped value for a KPI tile that does not drill. */
export function plainValue(value: string | number): string {
  return `<span class="num">${esc(value)}</span>`
}

export function subHeading(id: string, title: string, lede?: string): string {
  const intro = lede === undefined ? '' : `<p class="lede">${esc(lede)}</p>`
  return `<h3 id="${esc(id)}" class="sub">${esc(title)}</h3>${intro}`
}

export function card(body: string, className = ''): string {
  return `<div class="card${className.length > 0 ? ` ${className}` : ''}">${body}</div>`
}

export function note(text: string, className = ''): string {
  return `<p class="note${className.length > 0 ? ` ${className}` : ''}">${esc(text)}</p>`
}

/** The designed state for a section with no data yet. */
export function emptyState(empty: EmptyState): string {
  const next =
    empty.nextStep === null
      ? ''
      : `<p class="empty-next"><strong>Next step:</strong> ${esc(empty.nextStep)}</p>`
  return (
    `<div class="empty-state" role="note"><svg class="empty-icon" viewBox="0 0 24 24" aria-hidden="true">` +
    `<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>` +
    `<div><p class="empty-title">${esc(empty.title)}</p><p class="empty-message">${esc(empty.message)}</p>${next}</div></div>`
  )
}

export function statusChip(status: PromptCheckStatus): string {
  return `<span class="chip ${STATUS_CLASSES[status]}">${esc(STATUS_LABELS[status])}</span>`
}

export function whoChip(who: DomainWho): string {
  return `<span class="who who-${who}">${esc(WHO_LABELS[who])}</span>`
}

/** Yes, No, or an em dash for "not measured". */
export function yesNo(value: boolean | null): string {
  if (value === null) return '<span class="dash">—</span>'
  return value ? '<span class="yes">Yes</span>' : '<span class="no">No</span>'
}

/** Section anchors used by the nav and tests. */
export function sectionAnchor(id: ReportSectionId | PerspectiveSectionId): string {
  return `sec-${id.replace(/_/g, '-')}`
}

/**
 * The section shell: heading, one-line description, then the body or the empty state.
 * `subs` become the nav sub-links; they are dropped when the section is empty.
 */
export function sectionShell(
  id: ReportSectionId,
  body: string,
  subs: readonly SubLink[],
  empty: EmptyState | null,
  lede?: string
): RenderedSection {
  const copy = REPORT_SECTION_COPY[id]
  return shell(id, copy.title, lede ?? copy.description, body, subs, empty)
}

/** The same shell for a section the HTML report adds (verdict, what changed, method). */
export function perspectiveShell(
  id: PerspectiveSectionId,
  title: string,
  lede: string,
  body: string,
  subs: readonly SubLink[] = [],
  empty: EmptyState | null = null
): RenderedSection {
  return shell(id, title, lede, body, subs, empty)
}

function shell(
  id: ReportSectionId | PerspectiveSectionId,
  title: string,
  lede: string,
  body: string,
  subs: readonly SubLink[],
  empty: EmptyState | null
): RenderedSection {
  const anchor = sectionAnchor(id)
  const content = empty === null ? body : emptyState(empty)
  const html =
    `<section id="${anchor}" class="report-section" data-section="${esc(id)}" aria-labelledby="${anchor}-title">` +
    `<header class="sec-head"><h2 id="${anchor}-title">${esc(title)}</h2>` +
    `<p class="lede">${esc(lede)}</p></header>${content}</section>`
  return { id, anchor, title, html, subs: empty === null ? subs : [] }
}
