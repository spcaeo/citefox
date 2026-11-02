/** Replacement written in place of a secret. Safe to log. */
export const REDACTED = '[REDACTED]'

const MAX_REDACT_DEPTH = 20

export interface RedactOptions {
  /**
   * Exact secret values to remove, in addition to the key patterns.
   * Every non-empty value is replaced, including secrets of 8 characters or fewer.
   */
  secrets?: readonly string[]
  /**
   * SerpApi keys are 64 hex characters, the same shape as a SHA-256 fingerprint.
   * Logs redact them. Set false only when the string is a hash field.
   */
  hexKeys?: boolean
}

interface Pattern {
  source: string
  flags: string
  replace: string
}

const HIGH_CONFIDENCE_PATTERNS: readonly Pattern[] = [
  { source: 'sk-ant-[A-Za-z0-9_-]{10,}', flags: 'g', replace: REDACTED },
  { source: 'Bearer\\s+[A-Za-z0-9\\-._~+/=]+', flags: 'gi', replace: 'Bearer [REDACTED]' },
  { source: '([?&]api_key=)[^&#\\s]+', flags: 'gi', replace: '$1[REDACTED]' },
  {
    source: '("(?:api_key|password|smtp_password|token)"\\s*:\\s*")[^"]+(")',
    flags: 'gi',
    replace: '$1[REDACTED]$2'
  },
  {
    source: '\\b((?:smtp|mail)[_-]?password)\\b(\\s*[=:]\\s*)(\\S+)',
    flags: 'gi',
    replace: '$1$2[REDACTED]'
  },
  {
    source: '\\b([a-z][a-z0-9+.-]*://[^/\\s:@]+:)([^@\\s/]+)@',
    flags: 'gi',
    replace: '$1[REDACTED]@'
  },
  {
    source: 'https://hooks\\.slack\\.com/services/[A-Za-z0-9/_-]+',
    flags: 'gi',
    replace: REDACTED
  }
]

const HEX_KEY_PATTERN: Pattern = {
  source: '\\b[a-fA-F0-9]{64}\\b',
  flags: 'g',
  replace: REDACTED
}

/** Prompt text is not a keychain secret, and it is still not written to a log. */
export const REDACTED_PROMPT = '[prompt]'

const PROMPT_KEYS = new Set(['prompt', 'renderedprompt', 'suppliedtext'])

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

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key))
}

export function isPromptKey(key: string): boolean {
  return PROMPT_KEYS.has(normalizeKey(key))
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '')
}

export function redactString(input: string, options?: RedactOptions): string {
  let output = input
  const secrets = [...(options?.secrets ?? [])]
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length)
  for (const secret of secrets) {
    output = output.split(secret).join(REDACTED)
  }
  for (const pattern of HIGH_CONFIDENCE_PATTERNS) {
    output = output.replace(new RegExp(pattern.source, pattern.flags), pattern.replace)
  }
  if (options?.hexKeys !== false) {
    output = output.replace(
      new RegExp(HEX_KEY_PATTERN.source, HEX_KEY_PATTERN.flags),
      HEX_KEY_PATTERN.replace
    )
  }
  return output
}

export function containsSecret(input: string, options?: RedactOptions): boolean {
  return redactString(input, options) !== input
}

export function redactValue(value: unknown, options?: RedactOptions): unknown {
  return redactNested(value, options, new WeakSet<object>(), 0)
}

/** A new Error whose message, stack, and cause have been redacted. */
export function redactError(error: unknown, options?: RedactOptions): Error {
  const redacted = redactValue(error, options)
  const message =
    isRecord(redacted) && typeof redacted.message === 'string' ? redacted.message : REDACTED
  const result = new Error(message)
  result.name = isRecord(redacted) && typeof redacted.name === 'string' ? redacted.name : 'Error'
  if (isRecord(redacted) && typeof redacted.stack === 'string') {
    result.stack = redacted.stack
  }
  if (isRecord(redacted) && 'cause' in redacted) {
    result.cause = redacted.cause
  }
  return result
}

function redactNested(
  value: unknown,
  options: RedactOptions | undefined,
  seen: WeakSet<object>,
  depth: number
): unknown {
  if (depth > MAX_REDACT_DEPTH) return '[MaxDepth]'
  if (typeof value === 'string') return redactString(value, options)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return redactString(value.toString(), options)
  if (typeof value === 'function' || typeof value === 'symbol') return REDACTED
  if (typeof value === 'undefined') return undefined
  if (typeof value !== 'object') return REDACTED
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (value instanceof Error) return redactErrorObject(value, options, seen, depth)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return REDACTED
  if (Array.isArray(value)) {
    return value.map((item) => redactNested(item, options, seen, depth + 1))
  }

  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const entry = (value as Record<string, unknown>)[key]
    output[key] = isPromptKey(key)
      ? REDACTED_PROMPT
      : isSensitiveKey(key)
        ? REDACTED
        : redactNested(entry, options, seen, depth + 1)
  }
  return output
}

function redactErrorObject(
  error: Error,
  options: RedactOptions | undefined,
  seen: WeakSet<object>,
  depth: number
): Record<string, unknown> {
  const output: Record<string, unknown> = {
    name: error.name,
    message: redactString(error.message, options)
  }
  if (typeof error.stack === 'string') {
    output.stack = redactString(error.stack, options)
  }
  if ('cause' in error) {
    output.cause = redactNested(error.cause, options, seen, depth + 1)
  }
  const record = error as Error & Record<string, unknown>
  for (const key of Object.keys(record)) {
    output[key] = isPromptKey(key)
      ? REDACTED_PROMPT
      : isSensitiveKey(key)
        ? REDACTED
        : redactNested(record[key], options, seen, depth + 1)
  }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
