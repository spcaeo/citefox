import type { SqliteDatabase } from './database'
import { StorageError } from './errors'

/**
 * Buyer context notes (Docs/FEEDBACK.md row 3, migration 031): options buyers switch
 * from and integrations, kept for prompt writing and never treated as competitors.
 * Read and written with the project profile (`project-profile.ts`).
 */

export interface BuyerContext {
  switchingFrom: string[]
  integrations: string[]
}

/** Most notes kept per kind. */
export const MAX_BUYER_CONTEXT = 12

type Kind = 'switching_from' | 'integration'

export function readBuyerContext(db: SqliteDatabase): BuyerContext {
  const rows = db
    .prepare<unknown[], { kind: Kind; name: string }>(
      `SELECT kind, name FROM buyer_context ORDER BY kind ASC, position ASC`
    )
    .all()
  return {
    switchingFrom: rows.filter((row) => row.kind === 'switching_from').map((row) => row.name),
    integrations: rows.filter((row) => row.kind === 'integration').map((row) => row.name)
  }
}

/** Replaces each kind that is given; a kind left undefined keeps its stored notes. */
export function writeBuyerContext(
  db: SqliteDatabase,
  context: { switchingFrom?: readonly string[]; integrations?: readonly string[] }
): void {
  const kinds: [Kind, readonly string[] | undefined][] = [
    ['switching_from', context.switchingFrom],
    ['integration', context.integrations]
  ]
  for (const [kind, names] of kinds) {
    if (names === undefined) continue
    const clean = normalizeNames(names)
    db.prepare(`DELETE FROM buyer_context WHERE kind = ?`).run(kind)
    const insert = db.prepare(`INSERT INTO buyer_context (kind, name, position) VALUES (?, ?, ?)`)
    clean.forEach((name, position) => insert.run(kind, name, position))
  }
}

function normalizeNames(names: readonly string[]): string[] {
  if (!Array.isArray(names) || names.length > MAX_BUYER_CONTEXT) {
    throw new StorageError('Invalid buyer context')
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    if (typeof raw !== 'string') throw new StorageError('Invalid buyer context')
    const name = raw.trim().replace(/\s+/gu, ' ')
    if (name.length === 0 || name.length > 120 || hasControl(name)) {
      throw new StorageError('Invalid buyer context')
    }
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}
