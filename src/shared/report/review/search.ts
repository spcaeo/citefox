import type { SiteRow } from './compete-types'
import type { Movement, PageItem, QuestionItem, ReviewReport } from './types'

/**
 * The report-wide search (Docs/REPORT-SPEC.md "Search"), and the facts every question
 * drawer shows on its strip and change tabs. Pure, so the app and its tests share them;
 * the downloaded file's script applies the same rules to its rows.
 */

export interface ReportSearch {
  questions: readonly QuestionItem[]
  sites: readonly SiteRow[]
  pages: readonly PageItem[]
  /** Matches in all, before the limit. */
  total: number
}

function matches(words: readonly string[], text: string): boolean {
  const hay = text.toLowerCase()
  return words.every((word) => hay.includes(word))
}

/** Questions (text, topic), sites (domain) and your pages (address, title) that match every word. */
export function searchReport(report: ReviewReport, query: string, limit = 6): ReportSearch {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { questions: [], sites: [], pages: [], total: 0 }
  const questions = Object.values(report.questionsById).filter((item) =>
    matches(words, `${item.text} ${item.topic}`)
  )
  const sites = report.competition.sites.filter((site) => matches(words, site.domain))
  const pages = Object.values(report.pagesByUrl).filter((page) =>
    matches(words, `${page.url} ${page.title ?? ''}`)
  )
  return {
    questions: questions.slice(0, limit),
    sites: sites.slice(0, limit),
    pages: pages.slice(0, limit),
    total: questions.length + sites.length + pages.length
  }
}

/** Results that mean an AI answer showed. */
function answered(result: QuestionItem['now']): boolean {
  return result === 'target' || result === 'other' || result === 'not_cited'
}

function cited(result: QuestionItem['now']): boolean {
  return result === 'target' || result === 'other'
}

/** The strip on top of every question drawer, read at the To end. */
export interface DrawerStrip {
  questions: number
  answered: number
  cited: number
  named: number
  /** An answer showed and does not cite you. */
  gap: number
}

export function drawerStrip(rows: readonly QuestionItem[]): DrawerStrip {
  const strip = { questions: rows.length, answered: 0, cited: 0, named: 0, gap: 0 }
  for (const row of rows) {
    if (answered(row.now)) strip.answered += 1
    if (cited(row.now)) strip.cited += 1
    if (row.namedNow === true) strip.named += 1
    if (answered(row.now) && !cited(row.now)) strip.gap += 1
  }
  return strip
}

/** The change tabs inside a question drawer. "Not cited" holds both not cited and no answer. */
export const CHANGE_TABS = ['all', 'gained', 'kept', 'lost', 'notcited'] as const
export type ChangeTab = (typeof CHANGE_TABS)[number]

export const CHANGE_TAB_LABELS: Readonly<Record<ChangeTab, string>> = {
  all: 'All',
  gained: 'Gained',
  kept: 'Kept',
  lost: 'Lost',
  notcited: 'Not cited'
}

export function inChangeTab(change: Movement | null, tab: ChangeTab): boolean {
  if (tab === 'all') return true
  if (tab === 'notcited') return change === 'notcited' || change === 'noanswer'
  return change === tab
}

/** Each tab with its count; empty when nothing was compared (no tabs to show). */
export function changeTabs(
  rows: readonly QuestionItem[]
): { id: ChangeTab; label: string; count: number }[] {
  if (!rows.some((row) => row.change !== null)) return []
  return CHANGE_TABS.map((id) => ({
    id,
    label: CHANGE_TAB_LABELS[id],
    count: rows.filter((row) => inChangeTab(row.change, id)).length
  }))
}

/** "▲ 2" when the position got better (a lower number), "▼ 1" when worse. */
export function positionMove(
  before: number | null,
  now: number | null
): { tone: 'up' | 'down' | 'flat'; text: string } | null {
  if (before === null || now === null) return null
  if (now < before) return { tone: 'up', text: `▲ ${before - now}` }
  if (now > before) return { tone: 'down', text: `▼ ${now - before}` }
  return { tone: 'flat', text: '=' }
}
