/** Ask a key table to open one key's row and move focus to it. `seq` repeats a request. */
export interface KeyFocusRequest {
  keyId: string
  seq: number
}

/** The DOM id of a key's name button, the row's focus target. */
export function keyRowId(keyId: string): string {
  return `key-row-${keyId}`
}
