import type { Logger } from '../logging/logger'
import { redactString, redactValue } from '../logging/redact'

export function resolveSecretList(
  source: readonly string[] | (() => readonly string[]) | undefined,
  extra: readonly string[] = []
): string[] {
  const base =
    source === undefined ? [] : typeof source === 'function' ? [...source()] : [...source]
  return [...base, ...extra].filter((secret) => secret.length > 0)
}

/** Every provider log line is redacted before it reaches the logger (NFR-5). */
export function logProvider(
  logger: Logger,
  level: 'info' | 'warn' | 'error',
  message: string,
  extra: unknown,
  secrets: readonly string[]
): void {
  const safeMessage = redactString(message, { secrets })
  if (extra === undefined) {
    logger[level](safeMessage)
    return
  }
  logger[level](safeMessage, redactValue(extra, { secrets }))
}
