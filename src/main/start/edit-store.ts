import type {
  SiteStartPage,
  SiteStartSection,
  StartEdit,
  StartEditRecord,
  StartRivalKind
} from '@shared/ipc'
import { START_RIVAL_KINDS } from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import type { SqliteDatabase } from '../storage/database'
import { isOwnDomainUrl, normalizePageUrl } from '../structure/url-rules'
import { rulePage, type StartPageRow } from './candidates'
import { listStartPages } from './store'

/** Edits along the first-run journey (project migration 032). */

interface EditSql {
  id: string
  edit_json: string
  summary: string
  created_at: string
  undone_at: string | null
  parent_id: string | null
  system: number
}

export function listEditRecords(db: SqliteDatabase): StartEditRecord[] {
  return db
    .prepare<unknown[], EditSql>(
      `SELECT id, edit_json, summary, created_at, undone_at, parent_id, system
       FROM site_start_edits ORDER BY seq ASC`
    )
    .all()
    .flatMap((row) => {
      try {
        return [
          {
            id: row.id,
            edit: JSON.parse(row.edit_json) as StartEdit,
            summary: row.summary,
            at: row.created_at,
            undoneAt: row.undone_at,
            parentId: row.parent_id,
            system: row.system === 1
          }
        ]
      } catch {
        return []
      }
    })
}

export function insertEditRecord(db: SqliteDatabase, record: StartEditRecord): void {
  const seq =
    (db.prepare<unknown[], { n: number | null }>(`SELECT MAX(seq) AS n FROM site_start_edits`).get()
      ?.n ?? 0) + 1
  db.prepare(
    `INSERT INTO site_start_edits (id, seq, edit_json, summary, created_at, undone_at, parent_id, system)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(
    record.id,
    seq,
    JSON.stringify(record.edit),
    record.summary.slice(0, 300),
    record.at,
    record.parentId,
    record.system ? 1 : 0
  )
}

/** Marks an edit and the follow-ups CiteFox made for it as undone. Returns false when unknown. */
export function undoEditRecord(db: SqliteDatabase, id: string, at: string): boolean {
  const changed = db
    .prepare(`UPDATE site_start_edits SET undone_at = ? WHERE id = ? AND undone_at IS NULL`)
    .run(at, id).changes
  db.prepare(
    `UPDATE site_start_edits SET undone_at = ? WHERE parent_id = ? AND undone_at IS NULL`
  ).run(at, id)
  return changed > 0
}

/** Pages the user added, as plan rows (sitemap rows when listed, else built from the URL). */
export function addedPages(
  db: SqliteDatabase,
  records: readonly StartEditRecord[],
  sections: readonly SiteStartSection[]
): SiteStartPage[] {
  const urls = records.flatMap((record) =>
    record.edit.kind === 'page' && record.edit.op === 'add' ? [record.edit.url] : []
  )
  if (urls.length === 0) return []
  const rows = listStartPages(db)
  return urls.map((url) => {
    const row: StartPageRow = rows.find((entry) => entry.url === url) ?? {
      id: '',
      url,
      title: null,
      tracked: false
    }
    const page = rulePage(row, sections, 'Added by you.', 'You added this page.')
    return { ...page, pageId: row.id === '' ? null : row.id }
  })
}

const MAX_TEXT = 300

function text(value: unknown, channel: string, max = MAX_TEXT): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel, 'Invalid request')
  const trimmed = value.replace(/\s+/gu, ' ').trim()
  if (trimmed.length === 0) throw new IpcRequestError(channel, 'Type something first.')
  if (trimmed.length > max) throw new IpcRequestError(channel, `Keep it under ${max} characters.`)
  return trimmed
}

function rivalKind(value: unknown, channel: string): StartRivalKind {
  if (typeof value === 'string' && (START_RIVAL_KINDS as readonly string[]).includes(value)) {
    return value as StartRivalKind
  }
  throw new IpcRequestError(channel, 'Invalid request')
}

/** Checks one edit from the window. Page URLs must be on the project's own site. */
export function parseStartEdit(value: unknown, domain: string, channel: string): StartEdit {
  if (typeof value !== 'object' || value === null)
    throw new IpcRequestError(channel, 'Invalid request')
  const raw = value as Record<string, unknown>
  const op = raw.op
  switch (raw.kind) {
    case 'rival':
      if (op === 'add') {
        return {
          kind: 'rival',
          op,
          name: text(raw.name, channel, 80),
          rivalKind: rivalKind(raw.rivalKind, channel)
        }
      }
      if (op === 'remove') return { kind: 'rival', op, name: text(raw.name, channel, 80) }
      if (op === 'rename') {
        return {
          kind: 'rival',
          op,
          name: text(raw.name, channel, 80),
          to: text(raw.to, channel, 80)
        }
      }
      if (op === 'move') {
        return {
          kind: 'rival',
          op,
          name: text(raw.name, channel, 80),
          rivalKind: rivalKind(raw.rivalKind, channel)
        }
      }
      break
    case 'segment':
    case 'trigger': {
      const kind = raw.kind
      if (op === 'add') return { kind, op, text: text(raw.text, channel, 120) }
      if (op === 'remove') return { kind, op, text: text(raw.text, channel, 120) }
      if (op === 'rename')
        return { kind, op, text: text(raw.text, channel, 120), to: text(raw.to, channel, 120) }
      break
    }
    case 'who':
      if (op === 'set') return { kind: 'who', op, text: text(raw.text, channel, 400) }
      break
    case 'page': {
      if (op !== 'add' && op !== 'remove') break
      const typed = text(raw.url, channel, 2000)
      const absolute = typed.startsWith('/') ? `https://${domain}${typed}` : typed
      const url = normalizePageUrl(
        /^https?:\/\//iu.test(absolute) ? absolute : `https://${absolute}`
      )
      if (url === null || !isOwnDomainUrl(url, domain, true)) {
        throw new IpcRequestError(channel, `Only ${domain} pages can be added.`)
      }
      return { kind: 'page', op, url }
    }
    case 'question':
      if (op === 'add') return { kind: 'question', op, text: text(raw.text, channel, 500) }
      if (op === 'remove') return { kind: 'question', op, id: text(raw.id, channel, 120) }
      if (op === 'edit') {
        return {
          kind: 'question',
          op,
          id: text(raw.id, channel, 120),
          text: text(raw.text, channel, 500)
        }
      }
      break
    default:
      break
  }
  throw new IpcRequestError(channel, 'Invalid request')
}
