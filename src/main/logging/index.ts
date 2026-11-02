export {
  containsSecret,
  isSensitiveKey,
  REDACTED,
  redactError,
  redactString,
  redactValue
} from './redact'
export type { RedactOptions } from './redact'
export { createLogger, writeLogToConsole } from './logger'
export type { LogLevel, Logger, LoggerOptions } from './logger'
export {
  appLogFilePath,
  createRotatingFileSink,
  LOG_FILE_COUNT,
  LOG_FILE_MAX_BYTES,
  LOG_FILE_NAME,
  teeSinks
} from './file-sink'
export type { LogSink, RotatingFileSinkOptions } from './file-sink'
