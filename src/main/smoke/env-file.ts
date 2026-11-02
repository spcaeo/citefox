import { existsSync, readFileSync } from 'node:fs'
import { scrubClaudeEnv } from '../providers/claude/env'

/**
 * Names the smoke command reports. SMTP_* is a group: every SMTP_ name in the
 * file is listed, then one summary line. Values are never included.
 */
export const SMOKE_ENV_NAMES = [
  'SERPAPI_API_KEY',
  'SERPAPI_API_KEY_2',
  'SERPAPI_API_KEY_3',
  'JINA_API_KEY',
  'ANTHROPIC_API_KEY',
  'YOUTUBE_API_KEY',
  'SLACK_WEBHOOK_URL'
] as const

export interface EnvFile {
  /** Every name present in the file. An empty value is still present. */
  values: Readonly<Record<string, string>>
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Parse dotenv text. Does not read the process environment and does not write it. */
export function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  for (const line of normalized.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const body = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed
    const eq = body.indexOf('=')
    if (eq < 1) continue
    const key = body.slice(0, eq).trim()
    if (!ENV_NAME.test(key)) continue
    let value = body.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

/**
 * Read one env file into a private map.
 * The path may contain spaces. The file contents are not placed on `process.env`.
 */
export function loadEnvFile(filePath: string): EnvFile {
  if (!existsSync(filePath)) {
    throw new Error(`Env file not found: ${filePath}`)
  }
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    throw new Error(`Could not read the env file: ${filePath}`)
  }
  return { values: parseEnvText(text) }
}

export function secretValues(values: Readonly<Record<string, string>>): string[] {
  return Object.values(values).filter((value) => value.length > 0)
}

export function isEnvSet(values: Readonly<Record<string, string>>, name: string): boolean {
  const value = values[name]
  return value !== undefined && value.length > 0
}

/** `NAME: set` or `NAME: missing`, plus SMTP_ lines and one SMTP_ summary. */
export function formatKeyStatus(values: Readonly<Record<string, string>>): string[] {
  const lines = SMOKE_ENV_NAMES.map((name) => `${name}: ${stateOf(values[name])}`)
  const smtp = Object.keys(values)
    .filter((name) => name.startsWith('SMTP_'))
    .sort()
  if (smtp.length === 0) {
    lines.push('SMTP_*: none')
    return lines
  }
  let set = 0
  let missing = 0
  for (const name of smtp) {
    const state = stateOf(values[name])
    if (state === 'set') set += 1
    else missing += 1
    lines.push(`${name}: ${state}`)
  }
  lines.push(missing === 0 ? `SMTP_*: ${set} set` : `SMTP_*: ${set} set, ${missing} missing`)
  return lines
}

/**
 * Environment for the `claude` child (LLM-6, section 5.3).
 * Starts from the parent environment with Claude API credentials removed, then
 * drops every name from the env file so a shell export cannot bill an API key
 * or forward another secret. The returned object is a copy.
 */
export function claudeChildEnv(
  parent: NodeJS.ProcessEnv,
  fileKeys: readonly string[]
): NodeJS.ProcessEnv {
  const next = scrubClaudeEnv(parent)
  for (const key of fileKeys) delete next[key]
  return next
}

function stateOf(value: string | undefined): 'set' | 'missing' {
  return value !== undefined && value.length > 0 ? 'set' : 'missing'
}
