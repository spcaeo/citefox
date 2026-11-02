/**
 * The guard on Claude's text answers (owner feedback 2026-10-25): a reply
 * where Claude talks about itself, refuses, or asks the user something is
 * not a description of the business, so it is never saved as one.
 */

const PATTERNS: readonly RegExp[] = [
  // Claude speaking for itself: "I don't have…", "I can't open…", "I'd rather…".
  /(?:^|[\s"“(])I(?:['’](?:m|d|ll|ve))?\s/u,
  /\b(?:as an AI|language model|my knowledge|my training)\b/iu,
  // Asking the user: "Can you give me…?", "Could you share…".
  /\b(?:can|could|would) you\b[^.]*\?/iu,
  /\b(?:please (?:share|provide|tell)|let me know)\b/iu
]

export const NOT_AN_ANSWER =
  'Claude did not answer from your site, so nothing was changed. Try again, or edit the prompt.'

/** True when `text` reads like Claude talking, not like the answer. */
export function isNotAnAnswer(text: string): boolean {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > 0 && PATTERNS.some((pattern) => pattern.test(flat))
}
