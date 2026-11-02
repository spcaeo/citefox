import {
  REPORT_KINDS,
  REPORT_SECTIONS,
  REPORT_TITLES,
  SECTION_TITLES,
  TAB_GROUPS,
  type ReportKind,
  type ReviewSectionId
} from '@shared/report/review'
import { HELP_DRAWER, HELP_ID_PARAM } from '../help/openHelp'
import { helpTopics } from '../help/topics'
import { sectionHash } from './routes'
import type { CatalogEntry } from './searchCatalog'

/**
 * Ctrl+K entries made from other lists, so they never fall behind: the Reports goals,
 * each ready report and its (grouped) tabs from the shared report model, and every
 * help topic from Docs/help. Report tabs come after the screens in the catalog, so a
 * screen wins a tie ("Questions" is the Questions screen first).
 */

const REPORTS = sectionHash('reports')

/** `#/reports?report=…&section=…`: a ready report on one tab. */
export function reportHash(kind: ReportKind, section?: ReviewSectionId): string {
  const query = new URLSearchParams({ report: kind })
  if (section !== undefined) query.set('section', section)
  return `${REPORTS}?${query.toString()}`
}

/** Other words for each report, the way people ask for it. */
const REPORT_WORDS: Readonly<Record<ReportKind, readonly string[]>> = {
  visibility: ['where do we stand', 'standing', 'share of voice', 'client report', 'overview'],
  changed: ['compare checks', 'gains', 'losses', 'gained', 'lost', 'since last check'],
  impact: ['did our fixes work', 'fixes', 'before and after', 'results', 'every 14 days'],
  pitch: ['audit', 'prospect', 'new client', 'sales', 'brief your leadership', 'one page'],
  content: ['what to write', 'write next', 'editorial', 'writer', 'new pages'],
  rival: ['versus', 'vs', 'one competitor', 'rival', 'compare competitor']
}

/** Reports › By goal: what each card answers, opening the report that answers it. */
const GOALS: readonly { id: string; text: string; words: readonly string[]; hash: string }[] = [
  {
    id: 'standing',
    text: 'Where do we stand?',
    words: ['standing', 'visibility', 'how are we doing'],
    hash: reportHash('visibility', 'standing')
  },
  {
    id: 'pitch',
    text: 'Pitch a new client',
    words: ['brief your leadership', 'one-page audit', 'audit', 'prospect'],
    hash: reportHash('pitch')
  },
  {
    id: 'content',
    text: 'What should we write next?',
    words: ['content plan', 'write', 'new pages'],
    hash: reportHash('content')
  },
  {
    id: 'rival',
    text: 'Us vs one competitor',
    words: ['head-to-head', 'rival', 'versus'],
    hash: reportHash('rival')
  },
  {
    id: 'changed',
    text: 'What changed?',
    words: ['gains', 'losses', 'since last check'],
    hash: reportHash('changed')
  },
  {
    id: 'impact',
    text: 'Did our fixes work?',
    words: ['impact review', 'fixes worked', 'results of fixes'],
    hash: reportHash('impact')
  }
]

function screen(
  id: string,
  text: string,
  detail: string,
  words: readonly string[],
  hash: string
): CatalogEntry {
  return { id, group: 'screens', text, detail, words, target: { hash } }
}

/** The goals and the six reports: found before any report tab. */
export const REPORT_ENTRIES: readonly CatalogEntry[] = [
  screen('reports-goals', 'Reports · By goal', 'Reports', ['goals', 'ready reports'], REPORTS),
  screen(
    'reports-by-report',
    'Reports · By report',
    'Reports',
    ['all reports', 'ready reports'],
    `${REPORTS}?layout=reports`
  ),
  screen(
    'reports-emails',
    'Reports · Scheduled emails',
    'Reports',
    ['email report', 'schedules', 'send to client', 'weekly email'],
    `${REPORTS}?tab=emails`
  ),
  ...GOALS.map((goal) =>
    screen(
      `report-goal-${goal.id}`,
      goal.text,
      'Reports · By goal',
      ['report', 'goal', ...goal.words],
      goal.hash
    )
  ),
  ...REPORT_KINDS.map((kind) =>
    screen(
      `report-${kind}`,
      REPORT_TITLES[kind],
      'Reports',
      ['report', ...REPORT_WORDS[kind]],
      reportHash(kind)
    )
  )
]

/**
 * Each report's tabs: a top tab opens its first section; a tab with pill sub-tabs
 * also lists each pill ("Visibility report · Reputation & sources › Backlinks").
 * A report with no tab map lists its sections as plain tabs.
 */
export const REPORT_TAB_ENTRIES: readonly CatalogEntry[] = REPORT_KINDS.flatMap((kind) => {
  const title = REPORT_TITLES[kind]
  // No extra words: a tab is found by its own name ("Backlinks"), never ahead of a screen.
  const tab = (id: string, text: string, section: ReviewSectionId): CatalogEntry =>
    screen(`report-${kind}-${id}`, `${title} · ${text}`, 'Reports', [], reportHash(kind, section))
  const groups = TAB_GROUPS[kind]
  if (groups === undefined) {
    return REPORT_SECTIONS[kind]
      .filter((section) => SECTION_TITLES[section] !== title)
      .map((section) => tab(section, SECTION_TITLES[section], section))
  }
  return groups.flatMap((group) => {
    const first = group.sections[0]
    if (first === undefined) return []
    const top = tab(group.id, group.title, first)
    if (group.sections.length < 2) return [top]
    return [
      top,
      ...group.sections.map((section) =>
        tab(`${group.id}-${section}`, `${group.title} › ${SECTION_TITLES[section]}`, section)
      )
    ]
  })
})

/** Every help topic: opens it in the help drawer over the screen open now. */
export function helpEntries(): CatalogEntry[] {
  return helpTopics().map((topic) => ({
    id: `help-${topic.id}`,
    group: 'help',
    text: topic.title,
    detail: 'Help',
    words: ['help', 'how to', ...topic.keywords, ...topic.questions],
    target: { drawer: HELP_DRAWER, values: { [HELP_ID_PARAM]: topic.id } }
  }))
}
