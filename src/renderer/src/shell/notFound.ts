/**
 * True when the main process said the page (or its project) does not exist,
 * as opposed to a read that failed. Main reports a missing page as
 * "That page was not found" and setup steps as "That page is not in this project."
 */
export function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /\bwas not found\b|\bnot in this project\b/i.test(error.message)
}
