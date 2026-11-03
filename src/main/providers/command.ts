import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProviderTimeoutError } from './errors'
import { runAttempts } from './retry'
import { withTimeout } from './timeout'
import { isWindowsBatch, npmShimTarget, windowsBatchSpawn } from './windows-cmd'

const MAX_OUTPUT_BYTES = 1_000_000

export interface CommandRequest {
  /** Executable path. Never a shell string. */
  command: string
  args: readonly string[]
  /**
   * Text written to a stdin pipe, which is then closed. `null` gives the child
   * no stdin at all (`stdio[0] = 'ignore'`). Omitted means an empty, closed pipe.
   */
  stdin?: string | null
  env?: NodeJS.ProcessEnv
  /** Working folder. Omitted means a fresh empty temp folder, removed afterwards. */
  cwd?: string
  timeoutMs: number
  signal?: AbortSignal
}

export interface CommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** Node's spawn error code, such as `ENOENT`, or null when the process started. */
  spawnError: string | null
}

/** Retries left for one logical call. Shared so nested retries cannot multiply. */
export interface RetryBudget {
  retriesLeft: number
}

/** The only way CiteFox starts a child process for a provider. */
export interface CommandTransport {
  run(request: CommandRequest): Promise<CommandResult>
}

/**
 * Options passed to `spawn`. `shell` stays false: no shell redirection.
 * `stdio[0]` is `'ignore'` when stdin is null, otherwise a pipe that the
 * transport writes once and then closes (LLM-3: the prompt goes on stdin).
 * `cwd` is a fresh empty folder so Claude Code finds no project CLAUDE.md,
 * `.mcp.json`, or `.claude/settings.json` to load. On POSIX the child leads
 * its own process group so a timeout can kill it and anything it started.
 */
export function providerCommandSpawnOptions(
  request: Pick<CommandRequest, 'env' | 'stdin'>,
  cwd?: string
): {
  shell: false
  env: NodeJS.ProcessEnv | undefined
  windowsHide: true
  cwd: string | undefined
  detached: boolean
  stdio: ['ignore' | 'pipe', 'pipe', 'pipe']
} {
  return {
    shell: false,
    env: request.env,
    windowsHide: true,
    cwd,
    detached: process.platform !== 'win32',
    stdio: [request.stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe']
  }
}

/**
 * What to start. On Windows an npm launcher (`claude.cmd`, `codex.cmd`) runs node on its
 * script directly; any other batch file goes through cmd.exe with every argument escaped
 * (Node refuses batch files without a shell since CVE-2024-27980). Elsewhere: as given.
 */
export function spawnTarget(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  readText: (path: string) => string = (path) => readFileSync(path, 'utf8'),
  exists: (path: string) => boolean = existsSync
): { file: string; args: string[]; verbatim: boolean } {
  if (!isWindowsBatch(command, platform)) return { file: command, args: [...args], verbatim: false }
  let text = ''
  try {
    text = readText(command)
  } catch {
    // Unreadable: fall through to cmd.exe, which reports the problem itself.
  }
  const shim = text ? npmShimTarget(command, text, exists) : null
  if (shim) return { file: shim.file, args: [...shim.prefix, ...args], verbatim: false }
  const viaCmd = windowsBatchSpawn(command, args)
  return { file: viaCmd.file, args: viaCmd.args, verbatim: true }
}

/** Children still running. Killed when the main process exits so none is left behind. */
const liveChildren = new Set<ChildProcess>()
let exitHookInstalled = false

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.once('exit', () => {
    for (const child of liveChildren) killProcessTree(child)
  })
}

/**
 * SIGKILL the child and its process group (POSIX), or the whole tree with
 * `taskkill /T` (Windows). A child that already exited is left alone.
 */
export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      child.kill('SIGKILL')
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

function makeIsolatedCwd(): string {
  return mkdtempSync(join(tmpdir(), 'citefox-claude-'))
}

function removeIsolatedCwd(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // A leftover empty temp folder is harmless; the OS cleans tmp.
  }
}

/**
 * LLM-3. `spawn` is called with an args array and `shell: false`, so a prompt
 * or a path cannot be interpreted by a shell. Each run gets its own empty
 * working folder, removed when the child exits.
 */
export function createSpawnCommandTransport(): CommandTransport {
  installExitHook()
  return {
    run(request: CommandRequest): Promise<CommandResult> {
      return new Promise((resolve) => {
        let settled = false
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        let stdoutBytes = 0
        let stderrBytes = 0
        const cwd = request.cwd ?? makeIsolatedCwd()
        const ownsCwd = request.cwd === undefined
        let cleaned = false
        const cleanup = (): void => {
          if (cleaned) return
          cleaned = true
          if (ownsCwd) removeIsolatedCwd(cwd)
        }
        let child: ChildProcess
        try {
          const target = spawnTarget(request.command, request.args)
          child = spawn(target.file, target.args, {
            ...providerCommandSpawnOptions(request, cwd),
            ...(target.verbatim ? { windowsVerbatimArguments: true } : {})
          })
        } catch (error) {
          cleanup()
          const code = (error as NodeJS.ErrnoException).code
          resolve({
            exitCode: null,
            stdout: '',
            stderr: error instanceof Error ? error.message : 'spawn failed',
            timedOut: false,
            spawnError: code ?? 'SPAWN_ERROR'
          })
          return
        }
        liveChildren.add(child)

        const finish = (result: CommandResult): void => {
          if (settled) return
          settled = true
          resolve(result)
        }

        const stop = (): void => {
          killProcessTree(child)
          finish({
            exitCode: null,
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            timedOut: true,
            spawnError: null
          })
        }

        const timer = setTimeout(stop, request.timeoutMs)

        const onAbort = (): void => {
          clearTimeout(timer)
          stop()
        }
        if (request.signal?.aborted) onAbort()
        else request.signal?.addEventListener('abort', onAbort, { once: true })

        child.stdout?.on('data', (chunk: Buffer) => {
          stdoutBytes += chunk.length
          if (stdoutBytes <= MAX_OUTPUT_BYTES) stdout.push(chunk)
        })
        child.stderr?.on('data', (chunk: Buffer) => {
          stderrBytes += chunk.length
          if (stderrBytes <= MAX_OUTPUT_BYTES) stderr.push(chunk)
        })
        child.on('error', (error: NodeJS.ErrnoException) => {
          clearTimeout(timer)
          liveChildren.delete(child)
          request.signal?.removeEventListener('abort', onAbort)
          cleanup()
          finish({
            exitCode: null,
            stdout: '',
            stderr: error.message,
            timedOut: false,
            spawnError: error.code ?? 'SPAWN_ERROR'
          })
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          liveChildren.delete(child)
          request.signal?.removeEventListener('abort', onAbort)
          cleanup()
          finish({
            exitCode: code,
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            timedOut: false,
            spawnError: null
          })
        })
        if (request.stdin !== null) {
          child.stdin?.on('error', () => undefined)
          child.stdin?.end(request.stdin ?? '')
        }
      })
    }
  }
}

export function commandFailedTransient(result: CommandResult): boolean {
  if (result.spawnError === 'ENOENT') return false
  if (result.timedOut) return true
  if (result.spawnError !== null) return true
  return false
}

export async function runCommandWithRetry(
  transport: CommandTransport,
  request: Omit<CommandRequest, 'signal'>,
  options?: {
    sleep?: (ms: number) => Promise<void>
    secrets?: readonly string[]
    shouldRetry?: (result: CommandResult) => boolean
    /**
     * Retries shared by every call that holds this object. Each retry spends
     * one. Without a budget the NFR-2 default of three attempts applies.
     */
    budget?: RetryBudget
  }
): Promise<CommandResult> {
  const secrets = options?.secrets ?? []
  const shouldRetry = options?.shouldRetry ?? commandFailedTransient
  const budget = options?.budget
  const outcome = await runAttempts(
    async (attempt) => {
      if (attempt > 1 && budget !== undefined) budget.retriesLeft -= 1
      try {
        const result = await withTimeout(
          (signal) => transport.run({ ...request, signal }),
          request.timeoutMs,
          request.command,
          secrets
        )
        return { done: !shouldRetry(result), value: result }
      } catch (error) {
        if (error instanceof ProviderTimeoutError) {
          return {
            done: false,
            value: {
              exitCode: null,
              stdout: '',
              stderr: error.message,
              timedOut: true,
              spawnError: null
            }
          }
        }
        throw error
      }
    },
    {
      sleep: options?.sleep,
      ...(budget === undefined ? {} : { attempts: 1 + Math.max(0, budget.retriesLeft) })
    }
  )
  return outcome
}
