import { redactString, redactValue, type RedactOptions } from './redact'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string, extra?: unknown): void
  info(message: string, extra?: unknown): void
  warn(message: string, extra?: unknown): void
  error(message: string, extra?: unknown): void
}

export interface LoggerOptions {
  /** Receives a line that has already been redacted. */
  write?: (level: LogLevel, line: string) => void
  /** Exact secrets to mask, or a function that reads the current set. */
  secrets?: readonly string[] | (() => readonly string[])
  hexKeys?: boolean
}

/**
 * Main-process logger. Every message and extra value passes through the
 * redactor before it reaches the sink, so a secret handed to `error` does not
 * land in the console or a log file.
 */
export function createLogger(options?: LoggerOptions): Logger {
  const write = options?.write ?? writeLogToConsole
  const emit = (level: LogLevel, message: string, extra?: unknown): void => {
    const redactOptions: RedactOptions = {
      secrets: resolveSecrets(options?.secrets),
      hexKeys: options?.hexKeys
    }
    const safeMessage = redactString(message, redactOptions)
    let line = `${new Date().toISOString()} ${level.toUpperCase()} ${safeMessage}`
    if (extra !== undefined) {
      const encoded = JSON.stringify(redactValue(extra, redactOptions))
      line += encoded === undefined ? ' [Unserializable]' : ` ${encoded}`
    }
    write(level, line)
  }
  return {
    debug: (message, extra) => emit('debug', message, extra),
    info: (message, extra) => emit('info', message, extra),
    warn: (message, extra) => emit('warn', message, extra),
    error: (message, extra) => emit('error', message, extra)
  }
}

function resolveSecrets(secrets: LoggerOptions['secrets']): readonly string[] {
  if (secrets === undefined) return []
  return typeof secrets === 'function' ? secrets() : secrets
}

/** The default sink. Pair it with a file sink through `teeSinks`. */
export function writeLogToConsole(level: LogLevel, line: string): void {
  if (level === 'error') {
    console.error(line)
    return
  }
  if (level === 'warn') {
    console.warn(line)
    return
  }
  if (level === 'debug') {
    console.debug(line)
    return
  }
  console.info(line)
}
