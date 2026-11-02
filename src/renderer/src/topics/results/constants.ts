import { TOPIC_TABS, type TopicTabId } from '../../shell/routes'

/** External writing service. Opens in the browser; CiteFox sends it no data. */
export { WRITE_WITH_URL } from '@shared/ipc'
export {
  MATCH_STATE_HINT,
  MATCH_STATE_LABEL,
  TODO_STATE_ORDER,
  TOPIC_STAGE_LABEL,
  WIN_ODDS_LABEL
} from '@shared/domain'

/** Row states that are not a match state, in words. */
export const EXTRA_STATE_LABEL = {
  failed: 'Search failed',
  not_checked: 'Not checked yet'
} as const

/**
 * Assist ids the topic screens run through `assist:run` (FR-25), so every
 * AI line shows "Claude · about N s" and changes nothing. Registered in main
 * by the topics backend; kept in one place so a rename is one line.
 */
export const TOPIC_ASSISTS = {
  prioritise: 'topics.prioritise',
  whyNotCited: 'topics.whyNotCited',
  draftFix: 'topics.draftFix',
  draftFixes: 'topics.draftFixes',
  discoverMore: 'topics.discoverMore',
  keywordGaps: 'topics.keywordGaps'
} as const

/**
 * Grid body height: a full page of 25 rows (44 px) plus the to-do's five
 * group headers, so the grids grow with the page instead of scrolling inside
 * it. Only Show all on a long list scrolls within the grid.
 */
export const GRID_BODY_HEIGHT = 44 * (25 + 5)

export const RESULTS_TABS = TOPIC_TABS
export type ResultsTab = TopicTabId
