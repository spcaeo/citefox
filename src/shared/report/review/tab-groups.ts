import type { ReportKind, ReviewReport, ReviewSectionId } from './types'

/**
 * Grouped tabs (Docs/REPORT-SPEC.md "Grouped tabs"): a report with many sections shows
 * at most 7 or 8 top tabs on one line. A tab holding several sections shows small pill
 * sub-tabs under the tab row. `section=<id>` on the URL stays the truth: the group is
 * worked out from the section, so every old link still opens the right place.
 *
 * The app's tab row and the downloaded file's section nav both read this.
 */

/** One top tab of a report kind's map. */
export interface TabGroupDef {
  /** A section id for a one-section tab; `g-…` for a tab with pills. */
  id: string
  title: string
  sections: readonly ReviewSectionId[]
  /** A quiet, link-style tab on the right (How we measured). */
  quiet?: boolean
  /** One short line next to the pills: what this tab is for. */
  hint?: string
}

const METHOD: TabGroupDef = {
  id: 'method',
  title: 'How we measured',
  sections: ['method'],
  quiet: true
}

/** The top tabs of each report kind. A kind with no map shows plain tabs. */
export const TAB_GROUPS: Readonly<Partial<Record<ReportKind, readonly TabGroupDef[]>>> = {
  visibility: [
    { id: 'standing', title: 'Overview', sections: ['standing'] },
    { id: 'questions', title: 'Questions', sections: ['questions'] },
    { id: 'competitors', title: 'Competitors', sections: ['competitors'] },
    { id: 'pages', title: 'Pages', sections: ['pages'] },
    {
      id: 'g-content',
      title: 'Content',
      sections: ['topics', 'shape', 'deep'],
      hint: 'What to write: topics that skip you and how answers are built.'
    },
    {
      id: 'g-reputation',
      title: 'Reputation & sources',
      sections: ['reputation', 'sources', 'backlinks', 'notindexed'],
      hint: 'What AI says about you and the sites it trusts.'
    },
    METHOD
  ],
  changed: [
    { id: 'verdict', title: 'Verdict', sections: ['verdict'] },
    { id: 'changed', title: 'What changed', sections: ['changed'] },
    { id: 'questions', title: 'Questions', sections: ['questions'] },
    { id: 'competitors', title: 'Competitors', sections: ['competitors'] },
    {
      id: 'g-pages',
      title: 'Pages',
      sections: ['pages', 'published', 'lost'],
      hint: 'Your cited pages, the ones you published, and any that lost ground.'
    },
    {
      id: 'g-more',
      title: 'More',
      sections: ['topics', 'deep', 'next'],
      hint: 'Topics, how answers are built, and what to do next.'
    },
    METHOD
  ],
  impact: [
    { id: 'verdict', title: 'Verdict', sections: ['verdict'] },
    { id: 'published', title: 'Published pages', sections: ['published'] },
    { id: 'questions', title: 'Questions', sections: ['questions'] },
    { id: 'competitors', title: 'Competitors', sections: ['competitors'] },
    {
      id: 'g-pages',
      title: 'Pages',
      sections: ['pages', 'lost'],
      hint: 'Your cited pages and any that lost ground.'
    },
    {
      id: 'g-asks',
      title: 'Client asks',
      sections: ['notindexed', 'backlinks', 'next'],
      hint: 'What to ask the client for: indexing, links and the next round.'
    },
    {
      id: 'g-more',
      title: 'More',
      sections: ['changed', 'topics', 'deep'],
      hint: 'Every move, topics, and how answers are built.'
    },
    METHOD
  ]
}

/** Up to this many sections show as plain tabs, map or not. */
export const MAX_PLAIN_TABS = 7

export type ReportSectionEntry = ReviewReport['sections'][number]

/** One top tab as shown: only its sections the report shows (hidden ones left out). */
export interface TabGroup {
  id: string
  title: string
  quiet: boolean
  hint?: string
  /** One or more; two or more show as pills. */
  sections: readonly ReportSectionEntry[]
  /** Some section needs a look. */
  alert: boolean
  /** Every section is greyed with what it needs. */
  empty: boolean
}

function groupOf(def: TabGroupDef, entries: readonly ReportSectionEntry[]): TabGroup {
  return {
    id: def.id,
    title: def.title,
    quiet: def.quiet === true,
    ...(def.hint !== undefined && entries.length > 1 ? { hint: def.hint } : {}),
    sections: entries,
    alert: entries.some((entry) => entry.alert === true),
    empty: entries.every((entry) => entry.empty !== undefined)
  }
}

function plain(entry: ReportSectionEntry): TabGroupDef {
  return { id: entry.id, title: entry.title, sections: [entry.id] }
}

/**
 * The top tabs of one report from its shown sections (`report.sections`, hidden ones
 * already left out). A group whose sections are all hidden disappears. No map, or 7 or
 * fewer sections: one plain tab per section. A section the map does not know gets its
 * own tab before How we measured, so a new section never goes missing.
 */
export function groupTabs(kind: ReportKind, sections: readonly ReportSectionEntry[]): TabGroup[] {
  const map = TAB_GROUPS[kind]
  if (map === undefined || sections.length <= MAX_PLAIN_TABS) {
    return sections.map((entry) => groupOf(plain(entry), [entry]))
  }
  const byId = new Map(sections.map((entry) => [entry.id, entry]))
  const known = new Set(map.flatMap((def) => def.sections))
  const extra = sections.filter((entry) => !known.has(entry.id)).map(plain)
  const quietAt = map.findIndex((def) => def.quiet === true)
  const defs =
    quietAt < 0 ? [...map, ...extra] : [...map.slice(0, quietAt), ...extra, ...map.slice(quietAt)]
  const out: TabGroup[] = []
  for (const def of defs) {
    const entries = def.sections.flatMap((id) => {
      const entry = byId.get(id)
      return entry === undefined ? [] : [entry]
    })
    if (entries.length > 0) out.push(groupOf(def, entries))
  }
  return out
}

/** The top tab holding a section (the first tab when the section is not shown). */
export function groupOfSection(
  groups: readonly TabGroup[],
  section: ReviewSectionId
): TabGroup | undefined {
  return groups.find((group) => group.sections.some((entry) => entry.id === section)) ?? groups[0]
}
