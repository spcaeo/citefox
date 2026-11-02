import { SECTION_TITLES, type ReviewReport } from '@shared/report/review'
import type { ReviewVariant } from './document'

/**
 * The check a ready report passes before it is saved (Docs/REPORT-SPEC.md "Ready
 * reports"): numbers that add up, every number's drawer listing exactly that many rows,
 * no empty section, and no "[object", "undefined" or "NaN" in what the reader sees. A
 * report that fails is not saved; the person gets a plain message instead.
 */

const BAD_TEXT: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\[object [A-Za-z]+\]/, label: '“[object …]”' },
  { pattern: /\bundefined\b/, label: '“undefined”' },
  { pattern: /\bNaN\b/, label: '“NaN”' }
]

/** The words a reader sees: no scripts, styles, tags or attribute values. */
export function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, (svg) => svg.replace(/<[^>]*>/g, ' '))
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
}

/** Problems in one engine view's numbers. */
export function reportProblems(report: ReviewReport, view: string): string[] {
  const out: string[] = []
  const where = view === 'all' ? '' : ` (${view})`
  for (const [id, drill] of Object.entries(report.drills)) {
    if (new Set(drill.ids).size !== drill.ids.length) {
      out.push(`The list behind “${drill.title}”${where} counts a row twice (${id}).`)
    }
  }
  const counted = (n: number, drill: string, label: string): void => {
    const listed = report.drills[drill]?.ids.length
    if (listed !== undefined && listed !== n) {
      out.push(`“${label}”${where} shows ${n} but its list has ${listed}.`)
    }
  }
  for (const kpi of [...report.verdict.kpis, ...report.standing.kpis]) {
    const listed = report.drills[kpi.drill]?.ids.length
    const shown = Number(kpi.now.replace(/[^0-9]/g, ''))
    if (listed !== undefined && /^[\d,]+$/.test(kpi.now) && shown !== listed) {
      out.push(`“${kpi.label}”${where} shows ${kpi.now} but its list has ${listed}.`)
    }
  }
  for (const step of report.round.steps) {
    if (step.count !== null) counted(step.count.n, step.count.drill, step.name)
  }
  const split = report.verdict.split
  if (split !== null && split.marketTenths + split.workTenths !== split.totalTenths) {
    out.push(`Market and your work${where} do not add up to the total change.`)
  }
  const chips = report.questions.chips
  const all = chips.find((chip) => chip.id === 'all')
  if (all !== undefined && all.count !== report.questions.rows.length) {
    out.push(`The Questions count${where} does not match its table.`)
  }
  for (const value of [report.changed.net, report.changed.moved, report.method.noise]) {
    if (!Number.isFinite(value)) out.push(`A number in What changed${where} is not a number.`)
  }
  return out
}

/** Problems in the finished file: bad words, empty sections, drills with no list. */
export function htmlProblems(html: string, variants: readonly ReviewVariant[]): string[] {
  const out: string[] = []
  const text = visibleText(html)
  for (const bad of BAD_TEXT) {
    if (bad.pattern.test(text)) out.push(`The report shows ${bad.label}.`)
  }
  if (/\[object [A-Za-z]+\]/.test(html)) {
    if (!out.some((line) => line.includes('[object')))
      out.push('The report data holds “[object …]”.')
  }
  const sections = html.split(/<section id="sec-/).slice(1)
  for (const chunk of sections) {
    const id = chunk.slice(0, chunk.indexOf('"'))
    const end = chunk.indexOf('</section>')
    const body = chunk.slice(chunk.indexOf('>') + 1, end === -1 ? undefined : end)
    const words = visibleText(body.replace(/<header class="sec-head">[\s\S]*?<\/header>/, ''))
      .replace(/[\s·—]+/g, '')
      .trim()
    if (words.length === 0) {
      const title = SECTION_TITLES[id as keyof typeof SECTION_TITLES] ?? id
      out.push(`The “${title}” section is empty.`)
    }
  }
  const data = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)
  let drills: Record<string, unknown> = {}
  try {
    drills = (JSON.parse(data?.[1] ?? '{}') as { drills?: Record<string, unknown> }).drills ?? {}
  } catch {
    out.push('The report data could not be read back.')
  }
  const tokens = new Set<string>()
  for (const match of html.matchAll(/data-drill="([^"]+)"/g))
    tokens.add(unescapeAttr(match[1] ?? ''))
  for (const token of tokens) {
    if (drills[token] === undefined) {
      out.push(`A number opens a list that is missing (${token}).`)
      break
    }
  }
  for (const variant of variants) out.push(...reportProblems(variant.report, variant.view))
  return out
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** The message shown when a report fails its check. */
export function qualityMessage(problems: readonly string[]): { reason: string; nextStep: string } {
  const shown = problems.slice(0, 3).join(' ')
  const more = problems.length > 3 ? ` And ${problems.length - 3} more.` : ''
  return {
    reason: `This report did not pass its check, so it was not saved. ${shown}${more}`,
    nextStep:
      'Run a new check, then download again. If it happens again, tell us which report and when.'
  }
}
