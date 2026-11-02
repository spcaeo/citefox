import type {
  BuyerPrompt,
  CoverageAction,
  CoverageFindingKind,
  CoverageLevel,
  IntentStage
} from '@shared/domain'
import type { GapFilter } from './model'

/** Every filter the coverage matrix can apply. */
export interface GapFilterState extends GapFilter {
  stage: readonly IntentStage[]
  source: readonly BuyerPrompt['source'][]
  action: readonly CoverageAction[]
}

export const NO_GAP_FILTER: GapFilterState = {
  query: '',
  coverage: [],
  priority: [],
  stage: [],
  source: [],
  action: []
}

/** Adds a value to a filter list, or removes it when it is already there. */
export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

/** Coverage levels as a tile toggle: that level on its own, or off. */
export function soleLevel(
  current: readonly CoverageLevel[],
  level: CoverageLevel
): CoverageLevel[] {
  return current.length === 1 && current[0] === level ? [] : [level]
}

/** The DOM id of a row's one-by-one item. Prompts links here (`#gap-<rowId>`). */
export function gapItemId(rowId: string): string {
  return `gap-${rowId}`
}

/** The prompt id in a route focus `row:<promptId>`, or null. */
export function focusedPromptId(focus: string | null): string | null {
  return focus?.startsWith('row:') ? focus.slice('row:'.length) || null : null
}

/** Where a page-wide finding is seen and fixed. All of them live in Page read today. */
export function findingSourceLabel(kind: CoverageFindingKind): string {
  switch (kind) {
    case 'title_length':
      return 'See shorter title options'
    case 'title_meta_mismatch':
      return 'Compare the title and meta description'
    case 'typo':
      return 'See it in Page read'
    case 'missing_promised_section':
      return 'See the outline in Page read'
    case 'factual_claim':
      return 'Check facts in Page read'
    case 'other':
      return 'Open Page read'
  }
}
