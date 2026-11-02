import { randomUUID } from 'node:crypto'
import {
  PROJECT_RULE_MAX,
  PROJECT_RULES_MAX,
  type ProjectRule,
  type SaveProjectRuleRequest
} from '@shared/ipc'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { runWrite } from './record-values'
import { assertId, requireStoredText, requireUtcTimestamp } from './values'

/**
 * The owner's rules for one project (project migration 057): short standing
 * instructions every later AI prompt for the project carries while they are on.
 */

interface RuleSql {
  id: string
  text: string
  enabled: number
  created_at: string
  updated_at: string
}

/** One line, spaces tidied, never empty. */
export function cleanRuleText(text: string): string {
  const clean = text.replace(/\s+/gu, ' ').trim()
  if (clean.length === 0 || clean.length > PROJECT_RULE_MAX) {
    throw new StorageError(`A rule is 1 to ${PROJECT_RULE_MAX} characters`)
  }
  return requireStoredText(clean, 'rule', PROJECT_RULE_MAX)
}

/** Every rule, oldest first. A project file from before 057 has none. */
export function listProjectRules(db: SqliteDatabase): ProjectRule[] {
  let rows: RuleSql[]
  try {
    rows = db
      .prepare<unknown[], RuleSql>(
        `SELECT id, text, enabled, created_at, updated_at FROM project_rules
         ORDER BY created_at, rowid`
      )
      .all()
  } catch {
    return []
  }
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

/** The texts of the rules that are on, for the prompts. */
export function activeProjectRules(db: SqliteDatabase): string[] {
  return listProjectRules(db)
    .filter((rule) => rule.enabled)
    .map((rule) => rule.text)
}

/**
 * Adds a rule (`id` null) or edits one. A new rule whose words are already listed
 * (any case) turns that one on instead of adding a second.
 */
export function saveProjectRule(
  db: SqliteDatabase,
  request: Omit<SaveProjectRuleRequest, 'projectId'>,
  now: string
): ProjectRule[] {
  const text = cleanRuleText(request.text)
  const at = requireUtcTimestamp(now)
  const rules = listProjectRules(db)
  runWrite(() => {
    if (request.id !== null) {
      const id = assertId(request.id)
      if (!rules.some((rule) => rule.id === id)) throw new StorageError('That rule was not found')
      db.prepare(`UPDATE project_rules SET text = ?, enabled = ?, updated_at = ? WHERE id = ?`).run(
        text,
        request.enabled ? 1 : 0,
        at,
        id
      )
      return
    }
    const same = rules.find((rule) => rule.text.toLowerCase() === text.toLowerCase())
    if (same) {
      db.prepare(`UPDATE project_rules SET enabled = 1, updated_at = ? WHERE id = ?`).run(
        at,
        same.id
      )
      return
    }
    if (rules.length >= PROJECT_RULES_MAX) {
      throw new StorageError(`A project keeps up to ${PROJECT_RULES_MAX} rules`)
    }
    db.prepare(
      `INSERT INTO project_rules (id, text, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run(`rule-${randomUUID()}`, text, request.enabled ? 1 : 0, at, at)
  }, 'Could not save the rule')
  return listProjectRules(db)
}

export function deleteProjectRule(db: SqliteDatabase, id: string): ProjectRule[] {
  const ruleId = assertId(id)
  runWrite(() => {
    db.prepare(`DELETE FROM project_rules WHERE id = ?`).run(ruleId)
  }, 'Could not delete the rule')
  return listProjectRules(db)
}
