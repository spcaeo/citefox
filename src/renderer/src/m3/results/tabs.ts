/** The tabs of the Results screen, in order. */
export const RESULTS_TABS = ['prompts', 'breakdown', 'cited', 'actions', 'checks'] as const

export type ResultsTab = (typeof RESULTS_TABS)[number]

/** Id prefix that links each results tab to its panel. */
export const RESULTS_TABS_ID = 'm3-results-tabs'

/**
 * The route query key that holds the open tab (`#/pages/<id>/results?view=cited`),
 * so every tab has a URL and Back from a drill-down (Prompt detail, a domain)
 * lands on the same tab. Prompts, the first tab, has no key.
 */
export const RESULTS_QUERY = ['view', 'sel'] as const

/**
 * The route query key that holds the ticked rows of the Prompts grid
 * (`#/pages/<id>/results?sel=<promptId>,<promptId>`), opaque question ids.
 * The page header's Check now reads it to open Check now on exactly those rows.
 */
export const RESULTS_SELECTION_KEY = 'sel'

export function isResultsTab(value: unknown): value is ResultsTab {
  return typeof value === 'string' && (RESULTS_TABS as readonly string[]).includes(value)
}

/** The tab a `view` query value names. Prompts when it is missing or unknown. */
export function resultsTabFrom(view: string | null): ResultsTab {
  return isResultsTab(view) ? view : 'prompts'
}

/** The `view` query value for a tab: none for Prompts. */
export function resultsView(tab: ResultsTab): string | null {
  return tab === 'prompts' ? null : tab
}
