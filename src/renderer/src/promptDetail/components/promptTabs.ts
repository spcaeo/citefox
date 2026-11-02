/** Prompt detail sections, one tab each, in order. */
export const PROMPT_TABS = ['overview', 'sources', 'markets', 'time', 'raw'] as const

export type PromptTab = (typeof PROMPT_TABS)[number]

/** Tab panel id prefix for the Prompt detail tabs. */
export const PROMPT_TABS_ID = 'pd-tabs'

/** The route query key that holds the open tab (`?view=sources`). */
export const PROMPT_VIEW_KEY = 'view'

export function isPromptTab(value: string | null | undefined): value is PromptTab {
  return typeof value === 'string' && (PROMPT_TABS as readonly string[]).includes(value)
}
