import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '../../logging/logger'
import type { CommandRequest, CommandResult, CommandTransport } from '../command'
import type { BinaryProbe } from './binary'
import { createClaudeCodeProvider, type ClaudeCodeProvider } from './claude-code'

/** Shared fakes for the Claude Code provider tests. Not production code. */
export const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures')
export const STAPLE = 'correct-horse-battery-staple'
export const ANTHROPIC_KEY = 'sk-ant-api03-FAKE000000000000000000'
export const EMAIL = 'person@example.com'
export const BINARY = '/usr/local/bin/claude'

export function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = []
  const write = (message: string, extra?: unknown): void => {
    lines.push(extra === undefined ? message : `${message} ${JSON.stringify(extra)}`)
  }
  return {
    lines,
    logger: { debug: write, info: write, warn: write, error: write }
  }
}

export function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

export function commandResult(partial: Partial<CommandResult>): CommandResult {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    spawnError: null,
    ...partial
  }
}

export function commandScript(script: {
  version?: CommandResult
  auth?: CommandResult
  print?: (request: CommandRequest, attempt: number) => CommandResult
}): CommandTransport & { calls: CommandRequest[] } {
  const calls: CommandRequest[] = []
  let prints = 0
  return {
    calls,
    async run(request) {
      calls.push(request)
      if (request.args[0] === '--version') {
        return script.version ?? commandResult({ stdout: readFixture('claude-cli/version.txt') })
      }
      if (request.args[0] === 'auth') {
        return script.auth ?? commandResult({ stdout: readFixture('claude-cli/auth-ok.json') })
      }
      prints += 1
      return (
        script.print?.(request, prints) ??
        commandResult({ stdout: readFixture('claude-cli/ok.json') })
      )
    }
  }
}

export function probeFor(existing: readonly string[]): BinaryProbe & { searched: number } {
  return {
    searched: 0,
    exists: (filePath) => existing.includes(filePath),
    searchPath() {
      this.searched += 1
      return null
    }
  }
}

export function claudeProvider(
  command: CommandTransport,
  logger: Logger,
  secrets?: readonly string[]
): ClaudeCodeProvider {
  return createClaudeCodeProvider({
    command,
    probe: probeFor([BINARY]),
    logger,
    savedBinaryPath: BINARY,
    model: null,
    pathEnv: '',
    baseEnv: { PATH: '/usr/bin' },
    sleep: async () => undefined,
    secrets
  })
}

export function captureLeveledLogger(): { logger: Logger; lines: string[]; warnings: string[] } {
  const lines: string[] = []
  const warnings: string[] = []
  const write =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (message: string, extra?: unknown): void => {
      const line = extra === undefined ? message : `${message} ${JSON.stringify(extra)}`
      lines.push(line)
      if (level === 'warn') warnings.push(line)
    }
  return {
    lines,
    warnings,
    logger: {
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error')
    }
  }
}
