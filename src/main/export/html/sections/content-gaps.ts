import type { CoverageFindingKind, CoverageLevel } from '@shared/domain'
import type { ContentGapsSection, GapMatrixRow } from '../../model/types'
import type { RenderContext, RenderedSection, SubLink } from '../context'
import { esc, link } from '../escape'
import { shortDate } from '../format'
import { sectionShell, subHeading } from '../parts'
import { table } from '../tables'

const COVERAGE_LABELS: Record<CoverageLevel, string> = {
  strong: 'Strong',
  partial: 'Partial',
  weak: 'Weak',
  none: 'Not covered'
}

const FINDING_LABELS: Record<CoverageFindingKind, string> = {
  factual_claim: 'Factual claim',
  missing_promised_section: 'Missing promised section',
  typo: 'Typo',
  title_length: 'Title length',
  title_meta_mismatch: 'Title and meta mismatch',
  other: 'Other'
}

/** Section 10, page scope only: page read, coverage matrix, one-by-one fixes and page-wide fixes. */
export function renderContentGaps(ctx: RenderContext): RenderedSection {
  const section = ctx.model.contentGaps
  const subs: SubLink[] = [
    { id: 'cg-page-read', title: 'Page read' },
    { id: 'cg-matrix', title: 'Coverage matrix' },
    { id: 'cg-one-by-one', title: 'One by one' },
    { id: 'cg-page-wide', title: 'Page-wide fixes' }
  ]
  const body = pageRead(ctx, section) + matrix(ctx, section) + oneByOne(section) + pageWide(section)
  return sectionShell(
    'content_gaps',
    body,
    subs,
    section.empty,
    'How well the page answers each buyer prompt today, what to change, and the FAQ drafts to add.'
  )
}

function pageRead(ctx: RenderContext, section: ContentGapsSection): string {
  const read = section.pageRead
  if (read === null)
    return (
      subHeading('cg-page-read', 'Page read') +
      '<p class="tbl-empty">The page has not been read yet.</p>'
    )
  const row = (term: string, value: string): string =>
    `<div class="fact"><dt>${esc(term)}</dt><dd>${value}</dd></div>`
  const title = `${esc(read.title ?? '—')} <span class="tag${read.titleTruncated ? ' tag-warn' : ''}">${read.titleLength} characters${
    read.titleTruncated ? ' · likely cut in search results' : ''
  }</span>`
  const mismatches =
    read.mismatches.length === 0
      ? ''
      : `<ul class="mismatches">${read.mismatches.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
  return (
    subHeading(
      'cg-page-read',
      'Page read',
      'What the page says about itself, read from the live page.'
    ) +
    `<dl class="facts facts-wide">${row('URL', link(read.url))}${row('Title', title)}${row('Meta description', esc(read.metaDescription ?? '—'))}${row(
      'H1',
      esc(read.h1 ?? '—')
    )}${row('Read', esc(shortDate(read.readAt, ctx.timeZone)))}${row('Last modified', esc(shortDate(read.lastModified, ctx.timeZone)))}</dl>${mismatches}`
  )
}

function matrix(ctx: RenderContext, section: ContentGapsSection): string {
  const summary =
    section.summary.length > 0 ? `<p class="summary-line">${esc(section.summary)}</p>` : ''
  return (
    subHeading(
      'cg-matrix',
      'Coverage matrix',
      'Each buyer prompt against the page: how strongly it is answered now, where, and the main gap.'
    ) +
    summary +
    table<GapMatrixRow>(ctx, {
      id: 'coverage-matrix',
      quiet: true,
      title: 'Coverage matrix',
      rows: section.matrix,
      limit: 12,
      empty: 'No coverage analysis yet.',
      columns: [
        { header: '#', kind: 'num', html: (row) => esc(row.number), csv: (row) => row.number },
        {
          header: 'Prompt',
          kind: 'wide',
          html: (row) => esc(row.prompt),
          csv: (row) => row.prompt
        },
        {
          header: 'Coverage',
          html: (row) =>
            `<span class="cov cov-${row.coverage}">${COVERAGE_LABELS[row.coverage]}</span>`,
          csv: (row) => COVERAGE_LABELS[row.coverage]
        },
        {
          header: 'Where covered now',
          kind: 'wide',
          html: (row) => esc(row.whereCovered.join(', ') || '—'),
          csv: (row) => row.whereCovered.join('; ')
        },
        {
          header: 'Main gap',
          kind: 'wide',
          html: (row) => esc(row.mainGap),
          csv: (row) => row.mainGap
        },
        {
          header: 'Action',
          kind: 'wide',
          html: (row) => esc(row.actionLabel),
          csv: (row) => row.actionLabel
        }
      ]
    })
  )
}

function oneByOne(section: ContentGapsSection): string {
  if (section.oneByOne.length === 0) return ''
  const items = section.oneByOne
    .map((item) => {
      const faq =
        item.faq === null
          ? `<p class="obo-faq-none"><strong>New FAQ:</strong> No</p>`
          : `<div class="faq"><p class="faq-label">New FAQ · ${item.faq.words} words</p><p class="faq-q">${esc(item.faq.question)}</p><p class="faq-a">${esc(item.faq.answer)}</p></div>`
      return (
        `<li class="obo"><p class="obo-title"><span class="obo-n">${item.number}</span>${esc(item.prompt)}</p>` +
        `<dl class="obo-grid"><div><dt>What is there now</dt><dd>${esc(item.now)}</dd></div><div><dt>What to update</dt><dd>${esc(item.update)}</dd></div></dl>${faq}</li>`
      )
    })
    .join('')
  return (
    subHeading(
      'cg-one-by-one',
      'One by one',
      'For each prompt: what the page says now, what to update, and a 40–70 word FAQ draft where one would help.'
    ) + `<ol class="obo-list">${items}</ol>`
  )
}

function pageWide(section: ContentGapsSection): string {
  return (
    subHeading(
      'cg-page-wide',
      'Page-wide fixes',
      'Problems that affect the whole page, not one prompt.'
    ) +
    (section.pageWide.length === 0
      ? '<p class="tbl-empty">No page-wide problems found.</p>'
      : `<ul class="findings">${section.pageWide
          .map(
            (finding) =>
              `<li><span class="tag">${esc(FINDING_LABELS[finding.kind])}</span><p class="finding-summary">${esc(finding.summary)}</p><p class="finding-detail">${esc(finding.detail)}</p></li>`
          )
          .join('')}</ul>`)
  )
}
