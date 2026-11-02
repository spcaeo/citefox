/** A page fix drawer's tabs: the brief, and the page itself with its edits (`pft=edits`). */
export type PageFixTab = 'brief' | 'edits'

export function pageFixTab(value: string | null): PageFixTab {
  return value === 'edits' ? 'edits' : 'brief'
}
