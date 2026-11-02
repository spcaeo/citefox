import { afterEach, describe, expect, test } from 'vitest'
import { getLatestClaudeCheckup } from '../../storage/records'
import { closeDatabase, type SqliteDatabase } from '../../storage/database'
import { openAppDatabase } from '../../storage/app-database'
import { ProviderError, ProviderTimeoutError } from '../errors'
import { createConcurrencyGate } from '../concurrency'
import { providerCommandSpawnOptions, type CommandTransport } from '../command'
import { ClaudeCallError } from './call-error'
import { runClaudeCheckup } from './checkup'
import { createClaudeCodeProvider, resetClaudeCodeFlagSupportForTests } from './claude-code'
import {
  BINARY,
  STAPLE,
  captureLogger,
  claudeProvider,
  commandResult,
  commandScript,
  probeFor,
  readFixture
} from './claude-test-fakes.test-helper'
import { DEFAULT_CLAUDE_MODEL } from './model'

const databases: SqliteDatabase[] = []

afterEach(() => {
  resetClaudeCodeFlagSupportForTests()
  for (const db of databases.splice(0)) closeDatabase(db)
})

function memoryDb(): SqliteDatabase {
  const db = openAppDatabase(':memory:')
  databases.push(db)
  return db
}

describe('Claude Code completion', () => {
  test('runs at most two calls at once; onStart says when a waiting call gets its turn', async () => {
    const { logger } = captureLogger()
    const release: Array<() => void> = []
    let active = 0
    let max = 0
    const command: CommandTransport = {
      async run(request) {
        if (!request.args.includes('-p')) return commandResult({ stdout: 'ok' })
        active += 1
        max = Math.max(max, active)
        await new Promise<void>((resolve) => {
          release.push(() => {
            active -= 1
            resolve()
          })
        })
        return commandResult({ stdout: JSON.stringify({ type: 'result', result: 'ok' }) })
      }
    }
    const provider = createClaudeCodeProvider({
      command,
      probe: probeFor([BINARY]),
      logger,
      savedBinaryPath: BINARY,
      pathEnv: '',
      baseEnv: { PATH: '/usr/bin' },
      sleep: async () => undefined,
      timeouts: { completeMs: 5_000 }
    })
    const started: number[] = []
    const tasks = [0, 1, 2].map((index) =>
      provider.complete({ prompt: 'ping', onStart: () => started.push(index) })
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(release).toHaveLength(2)
    // The third call waits at the gate: setup step 3 shows it as "Waiting its turn".
    expect(started).toEqual([0, 1])
    release[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(release).toHaveLength(3)
    expect(started).toEqual([0, 1, 2])
    release[1]?.()
    release[2]?.()
    await Promise.all(tasks)
    expect(max).toBe(2)
  })

  test('schemaAttempts 1 sends no schema retry and the failure carries its usage', async () => {
    const { logger } = captureLogger()
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean' } },
      required: ['ok']
    }
    const wrongShape = (): ReturnType<typeof commandResult> =>
      commandResult({
        stdout: JSON.stringify({
          type: 'result',
          result: '{"extra":1}',
          structured_output: { extra: 1 },
          usage: { input_tokens: 30, output_tokens: 6 }
        })
      })
    const once = commandScript({ print: wrongShape })
    const error = await claudeProvider(once, logger)
      .complete({ prompt: 'ping', schema, schemaAttempts: 1 })
      .then(
        () => null,
        (caught: unknown) => caught
      )
    expect(once.calls.filter((call) => call.args.includes('-p'))).toHaveLength(1)
    expect(error).toBeInstanceOf(ClaudeCallError)
    expect((error as ClaudeCallError).code).toBe('validation')
    expect((error as ClaudeCallError).usage?.inputTokens).toBe(30)

    const twice = commandScript({ print: wrongShape })
    const second = await claudeProvider(twice, logger)
      .complete({ prompt: 'ping', schema })
      .then(
        () => null,
        (caught: unknown) => caught
      )
    expect(twice.calls.filter((call) => call.args.includes('-p'))).toHaveLength(2)
    expect((second as ClaudeCallError).usage?.inputTokens).toBe(60)

    const fixed = commandScript({
      print: (_request, attempt) =>
        attempt === 1 ? wrongShape() : commandResult({ stdout: readFixture('claude-cli/ok.json') })
    })
    const completion = await claudeProvider(fixed, logger).complete({ prompt: 'ping', schema })
    expect(completion.attempts).toBe(2)
  })

  test('rejects a non-positive concurrency limit', () => {
    expect(() => createConcurrencyGate(0)).toThrow(ProviderError)
  })

  test('passes the Sonnet default when settings leave the model empty', async () => {
    const { logger, lines } = captureLogger()
    const empty = commandScript({})
    const completion = await createClaudeCodeProvider({
      command: empty,
      probe: probeFor([BINARY]),
      logger,
      savedBinaryPath: BINARY,
      model: null,
      pathEnv: '',
      baseEnv: { PATH: '/usr/bin' },
      sleep: async () => undefined
    }).complete({ prompt: 'ping' })
    const omitted = empty.calls.find((call) => call.args.includes('-p'))
    expect(omitted?.stdin).toBe('ping')
    expect(providerCommandSpawnOptions(omitted ?? { stdin: null }).stdio).toEqual([
      'pipe',
      'pipe',
      'pipe'
    ])
    const flag = omitted?.args.indexOf('--model') ?? -1
    expect(omitted?.args[flag + 1]).toBe(DEFAULT_CLAUDE_MODEL)
    expect(omitted?.args).not.toContain('ping')
    expect(completion.text).toBe('{"ok":true}')
    expect(completion.model).toBe(DEFAULT_CLAUDE_MODEL)
    expect(completion.resolvedModel).toBe(DEFAULT_CLAUDE_MODEL)
    expect(completion.usage).toMatchObject({
      inputTokens: 12,
      outputTokens: 4,
      cacheCreationInputTokens: 1,
      cacheReadInputTokens: 2,
      totalCostUsd: 0
    })
    const logged = lines.join('\n')
    expect(logged).toContain('"inputTokens":12')
    expect(logged).toContain(`"model":"${DEFAULT_CLAUDE_MODEL}"`)
    expect(logged).not.toContain('ping')

    const named = commandScript({})
    const namedCompletion = await createClaudeCodeProvider({
      command: named,
      probe: probeFor([BINARY]),
      logger,
      savedBinaryPath: BINARY,
      model: 'claude-haiku-4-5',
      pathEnv: '',
      baseEnv: { PATH: '/usr/bin' },
      sleep: async () => undefined
    }).complete({ prompt: 'ping' })
    const passed = named.calls.find((call) => call.args.includes('-p'))
    const namedFlag = passed?.args.indexOf('--model') ?? -1
    expect(passed?.args[namedFlag + 1]).toBe('claude-haiku-4-5')
    expect(namedCompletion.model).toBe('claude-haiku-4-5')
    expect(namedCompletion.resolvedModel).toBe(DEFAULT_CLAUDE_MODEL)
  })

  test('maps is_error onto typed failures and picks the busiest model', async () => {
    const { logger, lines } = captureLogger()
    const failed = commandScript({
      print: () => commandResult({ stdout: readFixture('claude-cli/is-error.json') })
    })
    await expect(
      createClaudeCodeProvider({
        command: failed,
        probe: probeFor([BINARY]),
        logger,
        savedBinaryPath: BINARY,
        model: null,
        pathEnv: '',
        baseEnv: { PATH: '/usr/bin' },
        sleep: async () => undefined
      }).complete({ prompt: 'ping' })
    ).rejects.toMatchObject({ code: 'spawn', resolvedModel: DEFAULT_CLAUDE_MODEL })
    expect(lines.join('\n')).toContain('"inputTokens":8')
    expect(lines.join('\n')).not.toContain('ping')

    const limited = commandScript({
      print: () =>
        commandResult({
          stdout: JSON.stringify({
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            result: 'You hit your limit',
            usage: {
              input_tokens: 3,
              output_tokens: 1,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0
            },
            modelUsage: {
              'claude-haiku-4-5': { inputTokens: 3, outputTokens: 1, costUSD: 0 }
            }
          })
        })
    })
    const db = memoryDb()
    const limit = await runClaudeCheckup({
      command: limited,
      probe: probeFor([BINARY]),
      logger,
      db,
      binaryPath: BINARY,
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      id: 'checkup-json-limit'
    })
    expect(limit.roundTrip).toBe('failed')
    expect(limit.rows.roundTrip.statusLabel).toBe('Plan limit')
    expect(limit.resolvedModel).toBe('claude-haiku-4-5')
    expect(getLatestClaudeCheckup(db)?.result.resolvedModel).toBe('claude-haiku-4-5')
  })
})

describe('claude code failure reasons', () => {
  test('reports the exit code and a redacted stderr line', async () => {
    const { logger } = captureLogger()
    const command = commandScript({
      print: () =>
        commandResult({
          exitCode: 7,
          stdout: readFixture('claude-cli/is-error.json'),
          stderr: `process failed before the reply ${STAPLE}\nsecond line`
        })
    })
    await expect(
      claudeProvider(command, logger, [STAPLE]).complete({ prompt: 'ping-fail' })
    ).rejects.toMatchObject({
      code: 'spawn',
      message: `Claude Code exited with code 7: process failed before the reply [REDACTED]`
    })
    expect(command.calls.filter((call) => call.args.includes('-p'))).toHaveLength(1)
  })

  test('reports a timeout', async () => {
    const { logger } = captureLogger()
    const command = commandScript({
      print: () => commandResult({ timedOut: true, exitCode: null, stderr: STAPLE })
    })
    const error = await claudeProvider(command, logger, [STAPLE])
      .complete({ prompt: 'ping-timeout' })
      .then(
        () => null,
        (caught: unknown) => caught
      )
    expect(error).toBeInstanceOf(ProviderTimeoutError)
    expect(error).toMatchObject({ code: 'timeout' })
    expect((error as Error).message).toMatch(/timed out/)
    expect((error as Error).message).not.toContain(STAPLE)
  })

  test('reports that Claude Code is not installed when the binary is missing', async () => {
    const { logger } = captureLogger()
    const provider = createClaudeCodeProvider({
      command: commandScript({}),
      probe: probeFor([]),
      logger,
      savedBinaryPath: null,
      model: null,
      pathEnv: '',
      baseEnv: { PATH: '/usr/bin' },
      sleep: async () => undefined
    })
    await expect(provider.complete({ prompt: 'ping-missing' })).rejects.toMatchObject({
      code: 'not_installed',
      message: 'Claude Code was not found.'
    })
  })

  test('reports that Claude Code is not installed when the process cannot start', async () => {
    const { logger } = captureLogger()
    const command = commandScript({
      print: () => commandResult({ spawnError: 'ENOENT', exitCode: null, stderr: STAPLE })
    })
    await expect(
      claudeProvider(command, logger, [STAPLE]).complete({ prompt: 'ping-enoent' })
    ).rejects.toMatchObject({
      code: 'not_installed',
      message: 'Claude Code is not installed.'
    })
  })
})
