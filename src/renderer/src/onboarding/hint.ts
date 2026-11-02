/**
 * The engine stores a masked tail, never the secret (NFR-5).
 * A secret of 8 characters or fewer has an empty hint. The UI adds the bullets
 * only when a tail came back.
 */
export function formatStoredKeyHint(hint: string | null | undefined): string | null {
  if (hint == null || hint.length === 0) return null
  return `••••${hint}`
}
