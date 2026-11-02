import { groupTabs, SECTION_TITLES, type ReviewReport } from '@shared/report/review'
import { esc } from '../html/escape'

/**
 * The downloaded report's sections, grouped as the app's tabs (Docs/REPORT-SPEC.md
 * "Grouped tabs"): the body follows the tab order, and the side nav shows each tab that
 * holds several sections as a heading with those sections under it. Numbers untouched.
 */
export function groupedSections(report: ReviewReport): ReviewReport['sections'] {
  return groupTabs(report.kind, report.sections).flatMap((group) => group.sections)
}

function link(id: string, title: string, level: 1 | 2): string {
  return `<a href="#sec-${id}" data-target="sec-${id}" data-level="${level}">${esc(title)}</a>`
}

/** The side nav's list items: one per tab, a group's sections indented under it. */
export function navHtml(report: ReviewReport): string {
  return groupTabs(report.kind, report.sections)
    .map((group) => {
      const first = group.sections[0]
      if (first === undefined) return ''
      if (group.sections.length === 1)
        return `<li>${link(first.id, SECTION_TITLES[first.id], 1)}</li>`
      const subs = group.sections
        .map((entry) => `<li>${link(entry.id, SECTION_TITLES[entry.id], 2)}</li>`)
        .join('')
      return `<li>${link(first.id, group.title, 1)}<ol>${subs}</ol></li>`
    })
    .join('')
}
