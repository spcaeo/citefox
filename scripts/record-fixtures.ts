import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Maintainer script. Reads provider keys from a local `.env` only, calls the
 * providers, and writes `{ status, body }` fixtures with every key removed.
 * Do not run this in CI or against live services from the test suite.
 *
 *   node --experimental-strip-types scripts/record-fixtures.ts --url URL --query QUERY --out DIR
 */

const REDACTED = '[REDACTED]'

const SECRET_PATTERNS: readonly { source: string; flags: string; replace: string }[] = [
  { source: 'sk-ant-[A-Za-z0-9_-]{10,}', flags: 'g', replace: REDACTED },
  { source: 'Bearer\\s+[A-Za-z0-9\\-._~+/=]+', flags: 'gi', replace: 'Bearer [REDACTED]' },
  { source: '([?&]api_key=)[^&#\\s]+', flags: 'gi', replace: '$1[REDACTED]' },
  {
    source: '("(?:api_key|password|smtp_password|token)"\\s*:\\s*")[^"]+(")',
    flags: 'gi',
    replace: '$1[REDACTED]$2'
  },
  { source: '\\b[a-fA-F0-9]{64}\\b', flags: 'g', replace: REDACTED }
]

/**
 * Fields whose whole value is a SHA-256 hex digest (decision 26), not a SerpApi key.
 * Names are compared with underscores and hyphens removed, so `content_hash` matches
 * `contentHash`. A value is kept only when it is exactly 64 hex characters and it
 * does not contain a known secret. The same digest in any other field is still removed.
 */
export const FIXTURE_HASH_FIELDS: readonly string[] = [
  'hash',
  'templateHash',
  'contentHash',
  'inputHash'
]

const HASH_FIELDS = new Set(FIXTURE_HASH_FIELDS.map((name) => normalizeKey(name)))
const SHA256_HEX = /^[a-fA-F0-9]{64}$/

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'apitoken',
  'authorization',
  'credential',
  'credentials',
  'smtppassword',
  'webhook',
  'webhookurl',
  'accesstoken',
  'refreshtoken',
  'clientsecret'
])

/** Removes exact secrets, key shapes, and sensitive fields from a JSON value. */
export function scrubFixture(value: unknown, secrets: readonly string[]): unknown {
  return walk(value, orderedSecrets(secrets), new WeakSet<object>(), 0)
}

function orderedSecrets(secrets: readonly string[]): string[] {
  return [...secrets]
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length)
}

function scrubString(input: string, secrets: readonly string[]): string {
  let output = input
  for (const secret of secrets) output = output.split(secret).join(REDACTED)
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(new RegExp(pattern.source, pattern.flags), pattern.replace)
  }
  return output
}

function walk(
  value: unknown,
  secrets: readonly string[],
  seen: WeakSet<object>,
  depth: number
): unknown {
  if (depth > 20) return '[MaxDepth]'
  if (typeof value === 'string') return scrubString(value, secrets)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value !== 'object') return REDACTED
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => walk(item, secrets, seen, depth + 1))
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const entry = (value as Record<string, unknown>)[key]
    output[key] = SENSITIVE_KEYS.has(normalizeKey(key))
      ? REDACTED
      : preservedHash(key, entry, secrets)
        ? entry
        : walk(entry, secrets, seen, depth + 1)
  }
  return output
}

function preservedHash(key: string, value: unknown, secrets: readonly string[]): value is string {
  if (!HASH_FIELDS.has(normalizeKey(key)) || typeof value !== 'string') return false
  if (!SHA256_HEX.test(value)) return false
  return !secrets.some((secret) => secret.length > 0 && value.includes(secret))
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '')
}

function isDirectRun(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  return import.meta.url === pathToFileURL(resolve(entry)).href
}

function loadDotEnv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}
  const env: Record<string, string> = {}
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function readFlag(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

async function recordOne(
  name: string,
  outDir: string,
  secrets: readonly string[],
  run: () => Promise<{ status: number; body: string }>
): Promise<void> {
  let response: { status: number; body: string }
  try {
    response = await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request failed'
    console.error(`${name} request failed: ${scrubString(message, secrets)}`)
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(response.body) as unknown
  } catch {
    parsed = response.body
  }
  const envelope = scrubFixture({ status: response.status, body: parsed }, secrets)
  writeFileSync(resolve(outDir, name), `${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const url = readFlag('--url')
  const query = readFlag('--query')
  const outDir = resolve(readFlag('--out'))
  mkdirSync(outDir, { recursive: true })
  const env = loadDotEnv(resolve(process.cwd(), '.env'))
  const serp = env.SERPAPI_API_KEY ?? ''
  const anthropic = env.ANTHROPIC_API_KEY ?? ''
  const jina = env.JINA_API_KEY ?? ''
  const secrets = [serp, anthropic, jina].filter((secret) => secret.length > 0)

  if (serp.length === 0) console.error('Skipping SerpApi: SERPAPI_API_KEY is not set in .env')
  else {
    const target = new URL('https://serpapi.com/search.json')
    target.searchParams.set('engine', 'google')
    target.searchParams.set('q', query)
    target.searchParams.set('api_key', serp)
    await recordOne('serpapi-search.json', outDir, secrets, async () => {
      const response = await fetch(target)
      return { status: response.status, body: await response.text() }
    })
  }

  if (anthropic.length === 0) {
    console.error('Skipping Anthropic: ANTHROPIC_API_KEY is not set in .env')
  } else {
    await recordOne('anthropic-messages.json', outDir, secrets, async () => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': anthropic,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 256,
          messages: [{ role: 'user', content: `Summarize ${url} for ${query}` }]
        })
      })
      return { status: response.status, body: await response.text() }
    })
  }

  if (jina.length === 0) console.error('Skipping Jina: JINA_API_KEY is not set in .env')
  else {
    await recordOne('jina-reader.json', outDir, secrets, async () => {
      const response = await fetch(`https://r.jina.ai/${url}`, {
        headers: { authorization: `Bearer ${jina}`, accept: 'application/json' }
      })
      return { status: response.status, body: await response.text() }
    })
  }
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'record-fixtures failed'
    console.error(message)
    process.exitCode = 1
  })
}
