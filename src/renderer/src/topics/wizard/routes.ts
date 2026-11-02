/**
 * Wizard routes. `#/add` is the chooser; `#/add/<draftId>` a saved draft.
 * The shell maps `#/add` to the `add` section with the draft id as focus id.
 */
export function addHash(draftId?: string | null): string {
  return draftId ? `#/add/${encodeURIComponent(draftId)}` : '#/add'
}

/**
 * Topic results (owned by the topic results screen, `#/topics/<topicId>`).
 * Kept here so Start can open it before both screens share one route helper.
 */
export function topicHash(topicId: string): string {
  return `#/topics/${encodeURIComponent(topicId)}`
}
