import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommandResult, CommandRunner } from './types'

export interface RecordedCall {
  file: string
  args: string[]
  input?: string
}

/** Returns a scripted result for a call, or undefined for the default (exit 0, no output). */
export type Responder = (call: RecordedCall) => CommandResult | undefined

export interface FakeRunner extends CommandRunner {
  calls: RecordedCall[]
  /** Calls as `file arg arg ...` strings, for compact assertions. */
  commands(): string[]
}

export function ok(stdout = ''): CommandResult {
  return { status: 0, stdout, stderr: '', error: null }
}

export function fail(status: number, stderr = ''): CommandResult {
  return { status, stdout: '', stderr, error: null }
}

export function notFound(file: string): CommandResult {
  return { status: null, stdout: '', stderr: '', error: `spawnSync ${file} ENOENT` }
}

export function fakeRunner(responder: Responder = () => undefined): FakeRunner {
  const calls: RecordedCall[] = []
  return {
    calls,
    commands: () => calls.map((call) => [call.file, ...call.args].join(' ')),
    run(file: string, args: readonly string[], options: { input?: string } = {}): CommandResult {
      const call: RecordedCall = { file, args: [...args] }
      if (options.input !== undefined) call.input = options.input
      calls.push(call)
      return responder(call) ?? ok()
    }
  }
}

export interface TempHome {
  home: string
  cleanup(): void
}

export function tempHome(): TempHome {
  const home = mkdtempSync(join(tmpdir(), 'citefox-os-job-'))
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}
