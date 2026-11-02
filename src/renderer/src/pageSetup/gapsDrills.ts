import type { CoverageAction, CoverageLevel } from '@shared/domain'
import type { DrillScope, DrillTarget, ItemDrill } from '../drill'
import { plainLabel } from './drills'
import { actionsLabel, coverageLabel, priorityLabel } from './labels'
import type { GapListRow } from './model'

/**
 * Drawers behind the Content gaps numbers. Each lists exactly the matrix rows
 * the clicked number counts, one row per prompt, so its total equals that
 * number (NFR-14). Rows open Prompt detail in the page's market.
 */

/** Prompt detail for one matrix row, in the drawer's market. */
export function gapTarget(scope: DrillScope, promptId: string): DrillTarget | null {
  if (!scope.pageId) return null
  return { kind: 'prompt', pageId: scope.pageId, promptId, marketId: scope.marketId }
}

/** A drawer of matrix rows. */
export function gapRowsDrill(
  copy: { id: string; title: string; description: string },
  rows: readonly GapListRow[],
  scope: DrillScope
): ItemDrill {
  return {
    kind: 'items',
    id: copy.id,
    title: copy.title,
    description: copy.description,
    noun: ['question', 'questions'],
    primaryLabel: 'Question',
    columns: [
      { id: 'coverage', label: 'Coverage', width: '88px' },
      { id: 'priority', label: 'Priority', width: '80px' },
      { id: 'action', label: 'Action', width: 'minmax(120px, 0.8fr)' }
    ],
    items: rows.map((row) => ({
      id: row.id,
      primary: `${row.position}. ${plainLabel(row.label)}`,
      secondary: row.mainGap || null,
      target: gapTarget(scope, row.promptId),
      cells: {
        coverage: coverageLabel(row.coverage),
        priority: priorityLabel(row.priority),
        action: actionsLabel(row.actions)
      },
      detail: row.whatToUpdate || null,
      group: row.coverage
    })),
    note: 'Select a question to see its AI Overview. Expand a row for what to update.',
    scope
  }
}

/** The prompts behind one coverage level (tile, chart segment, counts table). */
export function coverageDrill(
  level: CoverageLevel,
  population: readonly GapListRow[],
  scope: DrillScope
): ItemDrill {
  return gapRowsDrill(
    {
      id: `gaps:coverage:${level}`,
      title: `${coverageLabel(level)} coverage`,
      description: `Questions the page covers at the **${coverageLabel(level).toLowerCase()}** level, with the search and filters applied.`
    },
    population.filter((row) => row.coverage === level),
    scope
  )
}

/** Every prompt in the chart (the counts table's total). */
export function coverageTotalDrill(
  population: readonly GapListRow[],
  scope: DrillScope
): ItemDrill {
  return {
    ...gapRowsDrill(
      {
        id: 'gaps:coverage:all',
        title: 'Questions compared with the page',
        description: 'Every question in the coverage chart, with the search and filters applied.'
      },
      population,
      scope
    ),
    summary: [
      { label: 'Strong', group: 'strong' },
      { label: 'Partial', group: 'partial' },
      { label: 'Weak', group: 'weak' },
      { label: 'None', group: 'none' }
    ]
  }
}

export type WorkPart = 'new_faq' | 'faqs' | 'sections'

const WORK_ACTIONS: Readonly<Record<WorkPart, readonly CoverageAction[]>> = {
  new_faq: ['new_faq'],
  faqs: ['new_faq', 'optional_faq'],
  sections: ['update_existing', 'small_update']
}

const WORK_COPY: Readonly<Record<WorkPart, { title: string; description: string }>> = {
  new_faq: {
    title: 'New FAQs to add',
    description: 'Questions whose fix is a new FAQ on the page.'
  },
  faqs: {
    title: 'New and optional FAQs',
    description: 'Questions whose fix is a new FAQ, plus those where an FAQ is optional.'
  },
  sections: {
    title: 'Sections to edit',
    description: 'Questions whose fix is an update to an existing section, large or small.'
  }
}

/** The rows behind one part of "The work" card. Same rule as `workOf`. */
export function workRows(rows: readonly GapListRow[], part: WorkPart): GapListRow[] {
  const actions = WORK_ACTIONS[part]
  return rows.filter((row) => row.actions.some((action) => actions.includes(action)))
}

export function workDrill(
  part: WorkPart,
  population: readonly GapListRow[],
  scope: DrillScope
): ItemDrill {
  return gapRowsDrill(
    { id: `gaps:work:${part}`, ...WORK_COPY[part] },
    workRows(population, part),
    scope
  )
}
