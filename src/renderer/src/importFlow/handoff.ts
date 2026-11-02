/**
 * A file dropped on the drawer that opens Import a file (Add questions' drop
 * zone) waits here for the import drawer to read it. A File cannot ride on the
 * URL, and only its bytes go to main.
 */
let pending: File | null = null

export function handFile(file: File): void {
  pending = file
}

/** The waiting file, once: a reload or a second drawer does not read it again. */
export function takeHandedFile(): File | null {
  const file = pending
  pending = null
  return file
}
