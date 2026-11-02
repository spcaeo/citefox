import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, test } from 'vitest'
import { openAppDatabase } from '../../storage/app-database'
import { closeDatabase, type SqliteDatabase } from '../../storage/database'
import { getLatestClaudeCheckup } from '../../storage/records'
import type { CommandRequest, CommandResult, CommandTransport } from '../command'
import { ProviderError, ProviderTimeoutError } from '../errors'
import {
  captureLogger,
  commandResult,
  probeFor,
  readFixture
} from '../claude/claude-test-fakes.test-helper'
import { runCodexCheckup } from './checkup'
import { createCodexProvider, resetCodexFlagSupportForTests, type CodexProvider } from './codex'
import { CodexCallError } from './errors'
import { DEFAULT_CODEX_QUICK_MODEL } from './model'

const BINARY = '/usr/local/bin/codex'
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { color: { type: 'string' }, count: { type: 'integer' } },
  required: ['color', 'count']
}

const databases: SqliteDatabase[] = []

afterEach(() => {
  resetCodexFlagSupportForTests()
  for (const db of databases.splice(0)) closeDatabase(db)
})

interface ExecSeen {
  request: CommandRequest
  /** The `--output-schema` file as it was during the call, or null. */
  schemaFile: unknown
  schemaPath: string | null
}

function fixture(name: string): CommandResult {
  return commandResult({ stdout: readFixture(`codex-cli/${name}`) })
}

function codexScript(
  exec: (seen: ExecSeen, attempt: number) => CommandResult,
  login: CommandResult = commandResult({ stderr: readFixture('codex-cli/login-chatgpt.txt') })
): CommandTransport & { calls: CommandRequest[]; execs: ExecSeen[] } {
  const calls: CommandRequest[] = []
  const execs: ExecSeen[] = []
  return {
    calls,
    execs,
    async run(request) {
      calls.push(request)
      if (request.args[0] === '--version') {
        return commandResult({ stdout: readFixture('codex-cli/version.txt') })
      }
      if (request.args[0] === 'login') return login
      const at = request.args.indexOf('--output-schema')
      const schemaPath = at < 0 ? null : (request.args[at + 1] ?? null)
      const seen: ExecSeen = {
        request,
        schemaPath,
        schemaFile: schemaPath === null ? null : JSON.parse(readFileSync(schemaPath, 'utf8'))
      }
      execs.push(seen)
      return exec(seen, execs.length)
    }
  }
}

function codexProvider(command: CommandTransport, binaries: string[] = [BINARY]): CodexProvider {
  return createCodexProvider({
    command,
    probe: probeFor(binaries),
    logger: captureLogger().logger,
    savedBinaryPath: binaries.length > 0 ? BINARY : null,
    pathEnv: '',
    home: '/nowhere',
    baseEnv: { PATH: '/usr/bin', OPENAI_API_KEY: 'sk-proj-FAKE', CODEX_HOME: '/h/.codex' },
    sleep: async () => undefined,
    timeouts: { completeMs: 5_000 }
  })
}

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const caught = await promise.then(
    () => null,
    (error: unknown) => error
  )
  expect(caught).toBeInstanceOf(ProviderError)
  return caught as ProviderError
}

describe('Codex completion', () => {
  test('a plain reply: locked-down args, prompt on stdin, scrubbed env, usage', async () => {
    const script = codexScript(() => fixture('exec-text.jsonl'))
    const completion = await codexProvider(script).complete({ prompt: 'ping' })
    expect(completion).toMatchObject({
      provider: 'codex',
      text: 'pong',
      json: null,
      model: DEFAULT_CODEX_QUICK_MODEL,
      resolvedModel: DEFAULT_CODEX_QUICK_MODEL,
      inputTokens: 13802,
      attempts: 1
    })
    expect(Object.keys(completion.usage?.modelUsage ?? {})).toEqual([DEFAULT_CODEX_QUICK_MODEL])
    const [exec] = script.execs
    expect(exec?.request.command).toBe(BINARY)
    expect(exec?.request.stdin).toBe('ping')
    expect(exec?.request.args).toContain('--ephemeral')
    expect(exec?.request.args).not.toContain('ping')
    expect(exec?.request.env?.OPENAI_API_KEY).toBeUndefined()
    expect(exec?.request.env?.CODEX_HOME).toBe('/h/.codex')
  })

  test('a schema reply goes through a strict schema file that is removed afterwards', async () => {
    const script = codexScript(() => fixture('exec-schema.jsonl'))
    const completion = await codexProvider(script).complete({ prompt: 'colour?', schema: SCHEMA })
    expect(completion.json).toEqual({ color: 'red', count: 3 })
    const [exec] = script.execs
    expect(exec?.schemaFile).toMatchObject({ additionalProperties: false })
    expect(existsSync(exec?.schemaPath ?? '')).toBe(false)
  })

  test('a reply of the wrong shape is asked for once more, and usage adds up', async () => {
    const script = codexScript((_seen, attempt) =>
      attempt === 1 ? fixture('exec-text.jsonl') : fixture('exec-schema.jsonl')
    )
    const completion = await codexProvider(script).complete({ prompt: 'colour?', schema: SCHEMA })
    expect(completion.attempts).toBe(2)
    expect(completion.inputTokens).toBe(13802 + 12357)
    expect(script.execs[1]?.request.stdin).toContain('failed validation')
  })

  test('a schema OpenAI refuses in strict mode is sent in the prompt instead', async () => {
    const script = codexScript((_seen, attempt) =>
      attempt === 1 ? fixture('exec-schema-rejected.jsonl') : fixture('exec-schema.jsonl')
    )
    const completion = await codexProvider(script).complete({ prompt: 'colour?', schema: SCHEMA })
    expect(completion.json).toEqual({ color: 'red', count: 3 })
    expect(script.execs[1]?.schemaPath).toBeNull()
    expect(script.execs[1]?.request.stdin).toContain('matching this JSON Schema')
  })

  test('an optional feature this Codex does not know is dropped, once per process', async () => {
    const script = codexScript((seen) =>
      seen.request.args.includes('goals')
        ? commandResult({ exitCode: 2, stderr: 'Error: Unknown feature flag: goals' })
        : fixture('exec-text.jsonl')
    )
    const provider = codexProvider(script)
    await provider.complete({ prompt: 'one' })
    await provider.complete({ prompt: 'two' })
    expect(script.execs).toHaveLength(3)
    expect(script.execs[2]?.request.args).not.toContain('goals')
  })

  test('a Codex that cannot turn the shell off is not used', async () => {
    const script = codexScript(() =>
      commandResult({ exitCode: 2, stderr: 'Error: Unknown feature flag: shell_tool' })
    )
    const error = await failure(codexProvider(script).complete({ prompt: 'ping' }))
    expect(error.message).toMatch(/Update Codex/)
    expect(error.message).not.toMatch(/claude/i)
  })

  test('failures carry their code, usage and reset time', async () => {
    const limit = await failure(
      codexProvider(codexScript(() => fixture('constructed-usage-limit.jsonl'))).complete({
        prompt: 'ping'
      })
    )
    expect(limit).toBeInstanceOf(CodexCallError)
    expect(limit.code).toBe('plan_limit')
    expect((limit as CodexCallError).resetsAt).toEqual(new Date(2026, 9, 30, 15, 45))

    const out = await failure(
      codexProvider(codexScript(() => fixture('exec-logged-out.jsonl'))).complete({ prompt: 'x' })
    )
    expect(out.code).toBe('logged_out')
    expect(out.nextStep).toContain('codex login')

    const model = await failure(
      codexProvider(codexScript(() => fixture('exec-model-not-found.jsonl'))).complete({
        prompt: 'x'
      })
    )
    expect(model.message).toContain('model')
  })

  test('a timeout is retried once, a web search is not', async () => {
    const timedOut = (): CommandResult => commandResult({ exitCode: null, timedOut: true })
    const plain = codexScript(timedOut)
    const error = await failure(codexProvider(plain).complete({ prompt: 'x' }))
    expect(error).toBeInstanceOf(ProviderTimeoutError)
    expect(error.message).toContain('Codex')
    expect(plain.execs).toHaveLength(2)

    const web = codexScript(timedOut)
    await failure(codexProvider(web).complete({ prompt: 'x', webSearch: true }))
    expect(web.execs).toHaveLength(1)
  })

  test('web search turns search on for that call only', async () => {
    const script = codexScript(() => fixture('exec-web-search.jsonl'))
    const provider = codexProvider(script)
    await provider.complete({ prompt: 'latest?', webSearch: true })
    await provider.complete({ prompt: 'plain' })
    expect(script.execs[0]?.request.args).toContain('web_search="live"')
    expect(script.execs[1]?.request.args).toContain('web_search="disabled"')
  })

  test('no Codex on this computer is not_installed', async () => {
    const missing = await failure(
      codexProvider(
        codexScript(() => fixture('exec-text.jsonl')),
        []
      ).complete({ prompt: 'x' })
    )
    expect(missing.code).toBe('not_installed')
    const gone = await failure(
      codexProvider(
        codexScript(() => commandResult({ exitCode: null, spawnError: 'ENOENT' }))
      ).complete({
        prompt: 'x'
      })
    )
    expect(gone.code).toBe('not_installed')
  })
})

describe('Codex checkup', () => {
  function memoryDb(): SqliteDatabase {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    return db
  }

  function checkup(
    command: CommandTransport,
    db: SqliteDatabase
  ): ReturnType<typeof runCodexCheckup> {
    return runCodexCheckup({
      db,
      command,
      probe: probeFor([BINARY]),
      logger: captureLogger().logger,
      binaryPath: null,
      savedBinaryPath: BINARY,
      pathEnv: '',
      home: '/nowhere',
      baseEnv: { PATH: '/usr/bin' },
      sleep: async () => undefined
    })
  }

  test('finds Codex, reads the sign-in, sends a test call and stores the result', async () => {
    const db = memoryDb()
    const reply = [
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}',
      '{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":2}}'
    ].join('\n')
    const result = await checkup(
      codexScript(() => commandResult({ stdout: reply })),
      db
    )
    expect(result).toMatchObject({
      provider: 'codex',
      ready: true,
      version: '0.149.0',
      plan: 'ChatGPT'
    })
    expect(result.message).toContain('Codex is ready')
    expect(getLatestClaudeCheckup(db)?.result.provider).toBe('codex')
  })

  test('signed out stops at the sign-in row with the codex login step', async () => {
    const result = await checkup(
      codexScript(
        () => fixture('exec-text.jsonl'),
        commandResult({ exitCode: 1, stderr: readFixture('codex-cli/login-none.txt') })
      ),
      memoryDb()
    )
    expect(result.ready).toBe(false)
    expect(result.rows.login.state).toBe('warning')
    expect(result.rows.login.nextStep).toContain('codex login')
    expect(JSON.stringify(result)).not.toMatch(/claude/i)
  })
})
