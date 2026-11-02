/** Prompt text with the bold marks dropped and trimmed. */
export function plain(text: string): string {
  return text.split('**').join('').trim()
}

/** The buyer's full question as plain text (bold marks dropped), else the label. */
export function questionText(prompt: { text: string; label: string }): string {
  return plain(prompt.text) || plain(prompt.label)
}

/**
 * The short label PromptQuestion shows after the question, or null when it repeats the
 * question (or is empty).
 */
export function extraLabel(prompt: { text: string; label: string }): string | null {
  const short = plain(prompt.label)
  return short.length > 0 && short.toLowerCase() !== questionText(prompt).toLowerCase()
    ? short
    : null
}

/**
 * What PromptQuestion shows, as plain text: "question · label". Links that wrap it use
 * this in their accessible name, so the name contains the visible words.
 */
export function promptQuestionName(prompt: { text: string; label: string }): string {
  const extra = extraLabel(prompt)
  return extra ? `${questionText(prompt)} · ${extra}` : questionText(prompt)
}
