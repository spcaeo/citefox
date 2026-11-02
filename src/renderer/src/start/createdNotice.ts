/**
 * "Harbor is ready." after New project → Create: the form moves on to the new
 * project's "How do you want to start?", which shows this once. Kept in memory
 * only: a reload or a copied link does not show it again.
 */
let pending: string | null = null

export function noteProjectCreated(name: string): void {
  pending = name
}

/** The name of the project just created, once; null after that. */
export function takeProjectCreated(): string | null {
  const name = pending
  pending = null
  return name
}
