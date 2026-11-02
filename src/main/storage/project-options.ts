import {
  defaultProjectClaudeSettings,
  isClaudeFallback,
  isProjectClaudeConnection,
  isSampleCount
} from '@shared/domain'
import type { ProjectClaudeSettings, ProjectTemplateOverride, SampleCount } from '@shared/domain'
import { containsSecret } from '../logging/redact'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { assertId, readJson } from './values'

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/
const KIND = /^[a-z][a-z0-9_]{0,40}$/
const MAX_OVERRIDES = 20

/**
 * `project_options` (project migration 017). One row; a missing row is the defaults:
 * Claude follows Settings with fallback `wait`, the app model, the app's default
 * samples (`defaultSamples` null), and no template overrides (FR-10.3, FR-11.7, TPL-1).
 */
export interface ProjectOptions {
  claude: ProjectClaudeSettings
  /** Null uses the app's default samples for new pages. */
  defaultSamples: SampleCount | null
  /**
   * Legacy column, no longer read or written by the engine: a project's template versions
   * live in `template_overrides` (project migration 022, FR-26.8). Kept so older files parse.
   */
  templateOverrides: readonly ProjectTemplateOverride[]
}

export function defaultProjectOptions(): ProjectOptions {
  return { claude: defaultProjectClaudeSettings(), defaultSamples: null, templateOverrides: [] }
}

interface OptionsSql {
  claude_connection: string
  claude_key_id: string | null
  claude_fallback: string
  claude_fallback_key_id: string | null
  claude_model: string | null
  default_samples: number | null
  template_overrides: string
}

export function readProjectOptions(db: SqliteDatabase): ProjectOptions {
  const row = db
    .prepare<unknown[], OptionsSql>(
      `SELECT claude_connection, claude_key_id, claude_fallback, claude_fallback_key_id,
              claude_model, default_samples, template_overrides
       FROM project_options WHERE id = 1`
    )
    .get()
  if (row === undefined) return defaultProjectOptions()
  return normalizeProjectOptions({
    claude: {
      connection: row.claude_connection as ProjectClaudeSettings['connection'],
      keyId: row.claude_key_id,
      fallback: row.claude_fallback as ProjectClaudeSettings['fallback'],
      fallbackKeyId: row.claude_fallback_key_id,
      model: row.claude_model
    },
    defaultSamples: row.default_samples as SampleCount | null,
    templateOverrides: readOverrides(row.template_overrides)
  })
}

/** Replaces the row. Values are checked first, so a bad value never reaches the file. */
export function writeProjectOptions(db: SqliteDatabase, options: ProjectOptions): void {
  const next = normalizeProjectOptions(options)
  try {
    db.prepare(
      `INSERT INTO project_options (
         id, claude_connection, claude_key_id, claude_fallback, claude_fallback_key_id,
         claude_model, default_samples, template_overrides
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         claude_connection = excluded.claude_connection,
         claude_key_id = excluded.claude_key_id,
         claude_fallback = excluded.claude_fallback,
         claude_fallback_key_id = excluded.claude_fallback_key_id,
         claude_model = excluded.claude_model,
         default_samples = excluded.default_samples,
         template_overrides = excluded.template_overrides`
    ).run(
      next.claude.connection,
      next.claude.keyId,
      next.claude.fallback,
      next.claude.fallbackKeyId,
      next.claude.model,
      next.defaultSamples,
      JSON.stringify(next.templateOverrides)
    )
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) throw new StorageError('Could not save project options')
    throw error
  }
}

/** Throws a StorageError on any value the table would refuse. */
export function normalizeProjectOptions(options: ProjectOptions): ProjectOptions {
  const claude = options.claude
  if (!isProjectClaudeConnection(claude.connection)) {
    throw new StorageError('Invalid Claude connection')
  }
  if (!isClaudeFallback(claude.fallback)) throw new StorageError('Invalid Claude fallback')
  const keyId = claude.connection === 'api_key' ? requireKeyId(claude.keyId) : null
  const fallbackKeyId = claude.fallback === 'switch_key' ? requireKeyId(claude.fallbackKeyId) : null
  if (claude.model !== null && !MODEL.test(claude.model)) {
    throw new StorageError('Invalid Claude model')
  }
  if (options.defaultSamples !== null && !isSampleCount(options.defaultSamples)) {
    throw new StorageError('Invalid samples')
  }
  return {
    claude: {
      connection: claude.connection,
      keyId,
      fallback: claude.fallback,
      fallbackKeyId,
      model: claude.model
    },
    defaultSamples: options.defaultSamples,
    templateOverrides: normalizeOverrides(options.templateOverrides)
  }
}

function requireKeyId(value: string | null): string {
  if (value === null) throw new StorageError('Choose an Anthropic API key')
  const id = assertId(value)
  if (containsSecret(id)) throw new StorageError('A key id cannot contain a secret')
  return id
}

function readOverrides(encoded: string): ProjectTemplateOverride[] {
  const value = readJson(encoded, 'template overrides')
  if (!Array.isArray(value)) throw new StorageError('Invalid template overrides')
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) {
      throw new StorageError('Invalid template overrides')
    }
    const record = item as Record<string, unknown>
    if (typeof record.kind !== 'string' || typeof record.templateId !== 'string') {
      throw new StorageError('Invalid template overrides')
    }
    return { kind: record.kind, templateId: record.templateId }
  })
}

function normalizeOverrides(
  overrides: readonly ProjectTemplateOverride[]
): ProjectTemplateOverride[] {
  if (overrides.length > MAX_OVERRIDES) throw new StorageError('Too many template overrides')
  const seen = new Set<string>()
  return overrides.map((override) => {
    if (!KIND.test(override.kind)) throw new StorageError('Invalid template kind')
    if (seen.has(override.kind)) throw new StorageError('One override per template kind')
    seen.add(override.kind)
    return { kind: override.kind, templateId: assertId(override.templateId) }
  })
}
