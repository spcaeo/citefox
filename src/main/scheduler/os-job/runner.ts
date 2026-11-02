import { spawnSync } from 'node:child_process'
import type { CommandResult, CommandRunner } from './types'

export const COMMAND_TIMEOUT_MS = 15_000

/** The real runner: `spawnSync` with an argument array, never a shell. */
export function spawnCommandRunner(): CommandRunner {
  return {
    run(file: string, args: readonly string[], options: { input?: string } = {}): CommandResult {
      const result = spawnSync(file, [...args], {
        shell: false,
        encoding: 'utf8',
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
        input: options.input
      })
      return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        error: result.error ? result.error.message : null
      }
    }
  }
}
