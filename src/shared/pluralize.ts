/**
 * English count label.
 * Exactly 1 is singular. 0 and every other count are plural.
 * The number uses en-US grouping, matching "Search 2,014 pages".
 */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${pluralWord(count, singular, plural)}`
}

/** Noun only, when the count is already shown beside it. */
export function pluralWord(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural
}

/**
 * Buyer questions and keywords (short topic searches) counted apart, the way every
 * screen shows a tracked count: "30 questions · 118 keywords", or "28 questions"
 * when there are no keywords.
 */
export function questionsAndKeywords(questions: number, keywords: number): string {
  const asked = pluralize(questions, 'question')
  return keywords > 0 ? `${asked} · ${pluralize(keywords, 'keyword')}` : asked
}
