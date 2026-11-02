/** Commas: the default chip separator. */
export const COMMA_SEPARATOR = /,/

/** Commas, semicolons, new lines and tabs: a pasted list of email addresses. */
export const LIST_SEPARATORS = /[,;\n\r\t]+/

/**
 * Adds the names in `text` to `items`, skipping ones already there (any case).
 * `separator` splits the text (default: commas).
 */
export function addChips(
  items: readonly string[],
  text: string,
  separator: RegExp = COMMA_SEPARATOR
): string[] {
  const out = [...items]
  const parts = text
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  for (const part of parts) {
    if (!out.some((item) => item.toLowerCase() === part.toLowerCase())) out.push(part)
  }
  return out
}
