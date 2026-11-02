/** Harness shared by the handler tests: temp storage, scripted providers, and fixtures. Test-only. */

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  callIpcHandler,
  type AddApiKeyRequest,
  type ClaudeCheckupProgress,
  type SaveProfileRequest
} from '@shared/ipc'
import { createLogger } from '../logging/logger'
import { sectionFixtureReply } from '../onboarding/sections/fixture-replies'
import type { BinaryProbe } from '../providers/claude/binary'
import type { ClaudeCompletionRequest, ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import type { CommandRequest, CommandResult, CommandTransport } from '../providers/command'
import type { HttpRequest, HttpResponse, HttpTransport } from '../providers/http'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import { createIpcHandlers, type IpcHandlerDeps } from './index'

export const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures')

export const SECRET = 'serp-live-secret-value-9f3c'

export const BINARY = '/usr/local/bin/claude'

const directories: string[] = []
/** Close callbacks for open harness stores. A test that reopens storage swaps its entry. */
export const closers: Array<() => void> = []

/** Closes each harness store and removes its temp directory. Run it in `afterEach`. */
export function cleanupHarness(): void {
  for (const close of closers.splice(0)) close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
}

export function profile(): SaveProfileRequest {
  return {
    userName: 'Ada',
    projectName: 'TextBolt',
    domain: 'TextBolt.com',
    includeSubdomains: true,
    brandNames: ['TextBolt'],
    competitors: ['OtherCo'],
    country: 'UK',
    language: 'en',
    location: 'London',
    device: 'desktop'
  }
}

export function keyRequest(
  provider: AddApiKeyRequest['provider'],
  secret: string,
  cap: number | null = null
): AddApiKeyRequest {
  return { provider, name: 'Personal', secret, cap, projectIds: [] }
}

export function noSecret(value: unknown, logs: string[], secret: string): boolean {
  return !JSON.stringify(value).includes(secret) && !logs.join('\n').includes(secret)
}

export async function rejected(
  handlers: ReturnType<typeof createIpcHandlers>,
  channel:
    | 'connections:getOverview'
    | 'onboarding:finish'
    | 'claudeCode:getCheckup'
    | 'claudeCode:openTerminal'
    | 'settings:get'
    | 'status:getCapsule',
  args: readonly unknown[]
): Promise<string> {
  try {
    callIpcHandler(handlers, channel, args)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected a rejection')
}

export function treeHas(root: string, secret: string): boolean {
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(current)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) pending.push(join(current, entry))
      continue
    }
    if (!stats.isFile() || stats.size > 5_000_000) continue
    if (readFileSync(current).includes(Buffer.from(secret))) return true
  }
  return false
}

export interface ScriptedCommand extends CommandTransport {
  calls: CommandRequest[]
  auth: string
}

export function harness(overrides: Partial<IpcHandlerDeps> = {}): {
  handlers: ReturnType<typeof createIpcHandlers>
  storage: AppStorage
  secrets: MemorySecretStore
  logs: string[]
  progress: ClaudeCheckupProgress[]
  command: ScriptedCommand
} {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-ipc-'))
  directories.push(directory)
  const storage = openAppStorage(directory)
  closers.push(() => storage.close())
  const registry = new SecretRegistry()
  const secrets = new MemorySecretStore(registry)
  const logs: string[] = []
  const logger = createLogger({
    write: (_level, line) => {
      logs.push(line)
    },
    secrets: () => registry.list()
  })
  const progress: ClaudeCheckupProgress[] = []
  const command = scriptedCommand()
  let clock = Date.parse('2026-10-19T12:00:00.000Z')
  let sequence = 0
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '9.9.9' }),
    storage,
    secrets,
    logger,
    http: routingHttp(),
    claudeCommand: command,
    claudeProbe: probeFor([BINARY]),
    emitCheckupProgress: (event) => {
      progress.push(event)
    },
    emit: () => undefined,
    knownSecrets: () => registry.list(),
    now: () => new Date(clock),
    createId: () => {
      sequence += 1
      clock += 1000
      return `id-${sequence}`
    },
    ...overrides
  })
  return { handlers, storage, secrets, logs, progress, command }
}

export function routingHttp(): HttpTransport {
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      if (request.url.startsWith('https://serpapi.com/account')) {
        if (request.url.includes('rejected'))
          return fixtureResponse('serpapi/account-invalid-key.json')
        return fixtureResponse('serpapi/account-ok.json')
      }
      if (request.url.startsWith('https://api.anthropic.com/')) {
        return fixtureResponse('anthropic/messages-ok.json')
      }
      if (request.url.startsWith('https://r.jina.ai/')) {
        return fixtureResponse('jina/401.json')
      }
      throw new Error('unexpected provider request')
    }
  }
}

export function fixtureResponse(name: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

export function scriptedCommand(): ScriptedCommand {
  const calls: CommandRequest[] = []
  const transport: ScriptedCommand = {
    calls,
    auth: readFileSync(join(FIXTURES, 'claude-cli/auth-ok.json'), 'utf8'),
    async run(request) {
      calls.push(request)
      if (request.args[0] === '--version') {
        return commandResult({
          stdout: readFileSync(join(FIXTURES, 'claude-cli/version.txt'), 'utf8')
        })
      }
      if (request.args[0] === 'auth') return commandResult({ stdout: transport.auth })
      return commandResult({ stdout: readFileSync(join(FIXTURES, 'claude-cli/ok.json'), 'utf8') })
    }
  }
  return transport
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

export function probeFor(existing: readonly string[]): BinaryProbe {
  return {
    exists: (filePath) => existing.includes(filePath),
    searchPath: () => null
  }
}

/**
 * A Claude stand-in for the onboarding v2 sections: answers `Assist: setup.<section>`
 * prompts from the recorded fixtures (the same files the e2e shim reads) and keeps
 * every request, so a test can check the prompt and the web search flag. `reply`
 * overrides the answer for one test.
 */
export function sectionClaude(
  reply?: (prompt: string) => string | null
): ClaudeProvider & { requests: ClaudeCompletionRequest[] } {
  const requests: ClaudeCompletionRequest[] = []
  return {
    id: 'claude-code',
    requests,
    async complete(request) {
      requests.push(request)
      const text = reply?.(request.prompt) ?? sectionFixtureReply(request.prompt)
      if (text === null) throw new Error('no section fixture for this prompt')
      return {
        provider: 'claude-code',
        text,
        json: null,
        inputTokens: 10,
        outputTokens: 20,
        durationMs: 5,
        model: 'claude-sonnet',
        resolvedModel: 'claude-sonnet',
        usage: emptyClaudeCliUsage()
      }
    }
  }
}
