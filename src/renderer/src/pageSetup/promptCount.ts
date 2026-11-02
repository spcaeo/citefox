/**
 * Buyer prompts stored on a page (FR-1.5).
 * The SRS sets the default at 10 and does not declare a maximum.
 * This screen rejects a count above 1,000 before it calls `pages:update`.
 */
export const MIN_PAGE_PROMPT_COUNT = 1
export const MAX_PAGE_PROMPT_COUNT = 1000

export const PROMPT_COUNT_ERROR = 'Enter a whole number from 1 to 1,000.'

export function validatePromptCount(
  value: string
): { ok: true; count: number } | { ok: false; error: string } {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: PROMPT_COUNT_ERROR }
  const count = Number(trimmed)
  if (
    !Number.isSafeInteger(count) ||
    count < MIN_PAGE_PROMPT_COUNT ||
    count > MAX_PAGE_PROMPT_COUNT
  ) {
    return { ok: false, error: PROMPT_COUNT_ERROR }
  }
  return { ok: true, count }
}
