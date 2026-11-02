import { redactString } from '../../logging/redact'
import { isRecord } from '../../providers/json-schema'

const DROPPED_KEYS = new Set(['api_key', 'apikey', 'key', 'token', 'page_token'])

/**
 * NFR-5 and FR-13.5. Drops `api_key`, `key`, `token`, and `page_token` before the
 * body is stored or sent. Exact secrets are masked after that.
 */
export function redactSerpBody(body: string, secrets: readonly string[]): string {
  try {
    const parsed = JSON.parse(body) as unknown
    return redactString(JSON.stringify(stripSecrets(parsed)), { secrets })
  } catch {
    return redactString(body, { secrets })
  }
}

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item))
  if (!isRecord(value)) return value
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (DROPPED_KEYS.has(key.toLowerCase())) continue
    next[key] = stripSecrets(item)
  }
  return next
}
