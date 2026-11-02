import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { ClaudeCheckupProgress } from '@shared/ipc'
import { closeDatabase, type SqliteDatabase } from '../../storage/database'
import { openAppDatabase } from '../../storage/app-database'
import { getLatestClaudeCheckup } from '../../storage/records'
import { ProviderError } from '../errors'
import { providerCommandSpawnOptions } from '../command'
import { isCredentialPath, locateClaudeBinary, usualClaudeBinaryCandidates } from './binary'
import {
  CHECKUP_PROMPT,
  CHECKUP_SCHEMA,
  ClaudeCheckupRunner,
  formatDuration,
  runClaudeCheckup
} from './checkup'
import {
  claudePrintArgs,
  EMPTY_MCP_CONFIG,
  resetClaudeCodeFlagSupportForTests,
  resolveClaudeModel
} from './claude-code'
import {
  ANTHROPIC_KEY,
  BINARY,
  EMAIL,
  STAPLE,
  captureLogger,
  commandResult,
  commandScript,
  probeFor,
  readFixture
} from './claude-test-fakes.test-helper'
import { scrubClaudeEnv } from './env'
import { DEFAULT_CLAUDE_MODEL } from './model'
import { parseAuthStatus, parseClaudeCliOutput, resolvedModelId } from './parse'

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

describe('Claude binary and env', () => {
  test('scrubs API keys and tokens and keeps PATH', () => {
    const env = scrubClaudeEnv({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      ANTHROPIC_AUTH_TOKEN: 'token',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      ANTHROPIC_CUSTOM_SECRET: 'secret',
      HOME: '/home/tester'
    })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/tester')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_CUSTOM_SECRET).toBeUndefined()
  })

  test('uses an override, then PATH, then the usual folders', () => {
    const home = '/home/tester'
    const usual = usualClaudeBinaryCandidates(home, 'linux')
    expect(usual.some((candidate) => isCredentialPath(candidate))).toBe(false)
    expect(isCredentialPath(`${home}/.claude.json`)).toBe(true)
    expect(isCredentialPath(`${home}/.claude/credentials`)).toBe(true)

    const missing = probeFor([])
    expect(
      locateClaudeBinary('/opt/missing/claude', missing, {
        home,
        platform: 'linux',
        pathEnv: '/opt/bin'
      })
    ).toEqual({ path: null, source: 'override' })
    expect(missing.searched).toBe(0)

    const onPath = probeFor([])
    onPath.searchPath = () => '/opt/bin/claude'
    expect(
      locateClaudeBinary(null, onPath, { home, platform: 'linux', pathEnv: '/opt/bin' })
    ).toEqual({ path: '/opt/bin/claude', source: 'path' })

    const installed = usual[0]
    if (installed === undefined) throw new Error('missing usual candidate')
    expect(
      locateClaudeBinary(null, probeFor([installed]), {
        home,
        platform: 'linux',
        pathEnv: ''
      })
    ).toEqual({ path: installed, source: 'usual' })
  })

  test('refuses account-switch arguments and always passes a model', () => {
    expect(claudePrintArgs(DEFAULT_CLAUDE_MODEL, null)).toEqual([
      '-p',
      '--output-format',
      'json',
      '--max-turns',
      '1',
      '--model',
      DEFAULT_CLAUDE_MODEL,
      '--tools',
      '',
      '--disallowedTools',
      'mcp__*',
      '--strict-mcp-config',
      '--mcp-config',
      EMPTY_MCP_CONFIG,
      '--safe-mode',
      '--restricted',
      '--no-session-persistence'
    ])
    expect(resolveClaudeModel(null, null)).toBe(DEFAULT_CLAUDE_MODEL)
    expect(resolveClaudeModel('', null)).toBe(DEFAULT_CLAUDE_MODEL)
    expect(resolveClaudeModel(null, 'claude-haiku-4-5')).toBe('claude-haiku-4-5')
    expect(() => claudePrintArgs('login', null)).toThrow(ProviderError)
  })
})

describe('Claude Code checkup', () => {
  test('emits the ready sequence, stores resolvedModel, and sends the prompt on stdin', async () => {
    const { logger, lines } = captureLogger()
    const db = memoryDb()
    const events: ClaudeCheckupProgress[] = []
    const auth = JSON.parse(readFixture('claude-cli/auth-ok.json')) as Record<string, unknown>
    auth.email = EMAIL
    const scripted = commandScript({
      auth: commandResult({ stdout: JSON.stringify(auth) })
    })
    const runner = new ClaudeCheckupRunner({
      command: scripted,
      probe: probeFor([BINARY]),
      logger,
      db,
      secrets: [STAPLE, ANTHROPIC_KEY],
      home: '/home/tester',
      platform: 'linux',
      pathEnv: '',
      baseEnv: {
        PATH: '/usr/bin',
        ANTHROPIC_API_KEY: ANTHROPIC_KEY,
        HOME: '/home/tester'
      },
      sleep: async () => undefined,
      clock: sequence(1000, 4200),
      concurrency: 2
    })
    runner.on('progress', (event: ClaudeCheckupProgress) => {
      events.push(event)
    })
    const result = await runner.run({
      binaryPath: BINARY,
      savedBinaryPath: null,
      id: 'checkup-ready'
    })
    expect(events.map((event) => `${event.phase}:${event.state}`)).toEqual([
      'binary:running',
      'binary:ok',
      'login:running',
      'login:ok',
      'roundTrip:running',
      'roundTrip:ok'
    ])
    expect(result.ready).toBe(true)
    expect(result.plan).toBe('Claude Max')
    expect(result.login).toBe('logged_in')
    expect(result.durationMs).toBe(3200)
    expect(result.resolvedModel).toBe(DEFAULT_CLAUDE_MODEL)
    expect(result.rows.roundTrip.detail).toBe('Replied in 3.2 s')
    expect(result.rows.login.detail).toBe('Claude Max plan')
    expect(result.message).toContain('Claude Max')
    const prints = scripted.calls.filter((call) => call.args.includes('-p'))
    expect(prints).toHaveLength(1)
    const print = prints[0]
    expect(print?.stdin).toBe(CHECKUP_PROMPT)
    expect(print?.args).not.toContain(CHECKUP_PROMPT)
    expect(providerCommandSpawnOptions(print ?? { stdin: null })).toMatchObject({
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    expect(print?.args).toContain('--json-schema')
    const modelFlag = print?.args.indexOf('--model') ?? -1
    expect(print?.args[modelFlag + 1]).toBe(DEFAULT_CLAUDE_MODEL)
    expect(print?.args).toContain('--tools')
    expect(print?.args).toContain('--disallowedTools')
    expect(print?.args).toContain('--strict-mcp-config')
    expect(print?.args).toContain(EMPTY_MCP_CONFIG)
    expect(print?.args).toContain('--safe-mode')
    expect(print?.args).toContain('--restricted')
    expect(print?.args).not.toContain('--setting-sources')
    expect(print?.args).not.toContain('login')
    expect(prints[0]?.args).not.toContain('--account')
    expect(prints[0]?.args).not.toContain('setup-token')
    for (const call of scripted.calls) {
      expect(call.env?.ANTHROPIC_API_KEY).toBeUndefined()
      expect(call.env?.PATH).toBe('/usr/bin')
    }
    expect(JSON.stringify(result)).not.toContain(EMAIL)
    expect(lines.join('\n')).not.toContain(EMAIL)
    expect(lines.join('\n')).not.toContain(CHECKUP_PROMPT)
    expect(lines.join('\n')).toContain('"inputTokens":12')
    expect(lines.join('\n')).toContain('"outputTokens":4')
    expect(lines.join('\n')).toContain('"cacheCreationInputTokens":1')
    expect(lines.join('\n')).toContain('"cacheReadInputTokens":2')
    expect(lines.join('\n')).toContain(`"model":"${DEFAULT_CLAUDE_MODEL}"`)
    expect(lines.join('\n')).not.toContain(ANTHROPIC_KEY)
    const stored = getLatestClaudeCheckup(db)
    expect(stored?.id).toBe('checkup-ready')
    expect(stored?.binaryOk).toBe(true)
    expect(stored?.loginOk).toBe(true)
    expect(stored?.roundTripOk).toBe(true)
    expect(stored?.result.plan).toBe('Claude Max')
    expect(stored?.result.resolvedModel).toBe(DEFAULT_CLAUDE_MODEL)
  })

  test('skips login and the round trip when Claude Code is missing', async () => {
    const { logger } = captureLogger()
    const command = commandScript({})
    const db = memoryDb()
    const events: ClaudeCheckupProgress[] = []
    const result = await runClaudeCheckup({
      command,
      probe: probeFor([]),
      logger,
      db,
      binaryPath: null,
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      id: 'checkup-missing',
      now: () => new Date('2026-10-19T12:00:00.000Z'),
      onProgress: (event) => events.push(event)
    })
    expect(events.map((event) => `${event.phase}:${event.state}`)).toEqual([
      'binary:running',
      'binary:warning',
      'login:skipped',
      'roundTrip:skipped'
    ])
    expect(result.ready).toBe(false)
    expect(result.resolvedModel).toBeNull()
    expect(result.binaryPath).toBeNull()
    expect(result.rows.binary.statusLabel).toBe('Not found on PATH')
    expect(command.calls).toHaveLength(0)
    expect(getLatestClaudeCheckup(db)?.binaryOk).toBe(false)

    const override = await runClaudeCheckup({
      command,
      probe: probeFor([]),
      logger,
      db,
      binaryPath: '/opt/missing/claude',
      savedBinaryPath: null,
      pathEnv: '/usr/bin',
      home: '/home/tester',
      platform: 'linux',
      id: 'checkup-override',
      now: () => new Date('2026-10-19T13:00:00.000Z')
    })
    expect(override.rows.binary.statusLabel).toBe('Not found')
    expect(getLatestClaudeCheckup(db)?.id).toBe('checkup-override')
    expect(getLatestClaudeCheckup(db)?.result.resolvedModel).toBeNull()
  })

  test('stores null when the round trip JSON has no modelUsage', async () => {
    const { logger } = captureLogger()
    const db = memoryDb()
    const command = commandScript({
      print: () =>
        commandResult({
          stdout: JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: '{"ok":true}',
            structured_output: { ok: true }
          })
        })
    })
    const result = await runClaudeCheckup({
      command,
      probe: probeFor([BINARY]),
      logger,
      db,
      binaryPath: BINARY,
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      id: 'checkup-no-model-usage'
    })
    expect(result.ready).toBe(true)
    expect(result.resolvedModel).toBeNull()
    expect(getLatestClaudeCheckup(db)?.result.resolvedModel).toBeNull()
  })

  test('stops when the binary is not installed, logged out, or on an API key', async () => {
    const { logger } = captureLogger()
    const db = memoryDb()
    const missing = commandScript({
      version: commandResult({ spawnError: 'ENOENT', exitCode: null })
    })
    const notInstalled = await runClaudeCheckup({
      command: missing,
      probe: probeFor([BINARY]),
      logger,
      db,
      binaryPath: BINARY,
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      id: 'checkup-enoent'
    })
    expect(missing.calls).toHaveLength(1)
    expect(notInstalled.rows.binary.state).toBe('warning')
    expect(notInstalled.login).toBe('skipped')

    const loggedOut = commandScript({
      auth: commandResult({ stdout: readFixture('claude-cli/logged-out.json') })
    })
    const signedOut = await runClaudeCheckup({
      command: loggedOut,
      probe: probeFor([BINARY]),
      logger,
      db,
      binaryPath: BINARY,
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      id: 'checkup-logged-out'
    })
    expect(loggedOut.calls.some((call) => call.args.includes('-p'))).toBe(false)
    expect(signedOut.login).toBe('logged_out')
    expect(signedOut.resolvedModel).toBeNull()
    expect(signedOut.rows.login.statusLabel).toBe('Not logged in')
    expect(signedOut.rows.roundTrip.state).toBe('skipped')
    expect(signedOut.message).toMatch(/logged out/)

    const apiKey = commandScript({
      auth: commandResult({
        stdout: JSON.stringify({
          loggedIn: true,
          authMethod: 'api_key',
          subscriptionType: 'max'
        })
      })
    })
    const keyed = await runClaudeCheckup({
      command: apiKey,
      probe: probeFor([BINARY]),
      logger,
      db,
      binaryPath: BINARY,
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      id: 'checkup-api-key'
    })
    expect(apiKey.calls.some((call) => call.args.includes('-p'))).toBe(false)
    expect(keyed.login).toBe('api_key')
    expect(keyed.rows.login.statusLabel).toBe('API key only')
    expect(keyed.roundTrip).toBe('skipped')
  })

  test('skips later phases when version times out or is unreadable', async () => {
    const { logger } = captureLogger()
    const db = memoryDb()
    const events: ClaudeCheckupProgress[] = []
    const timed = commandScript({
      version: commandResult({ timedOut: true, exitCode: null })
    })
    const timeout = await runClaudeCheckup({
      command: timed,
      probe: probeFor([BINARY]),
      logger,
      db,
      binaryPath: BINARY,
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      sleep: async () => undefined,
      id: 'checkup-version-timeout',
      onProgress: (event) => events.push(event)
    })
    expect(timed.calls).toHaveLength(3)
    expect(events.map((event) => `${event.phase}:${event.state}`)).toEqual([
      'binary:running',
      'binary:warning',
      'login:skipped',
      'roundTrip:skipped'
    ])
    expect(timeout.rows.binary.statusLabel).toBe('Timed out')

    const unreadable = commandScript({
      version: commandResult({ stdout: 'Claude Code' })
    })
    const bad = await runClaudeCheckup({
      command: unreadable,
      probe: probeFor([BINARY]),
      logger,
      db,
      binaryPath: BINARY,
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      id: 'checkup-unreadable'
    })
    expect(unreadable.calls).toHaveLength(1)
    expect(bad.rows.binary.statusLabel).toBe('No version')
  })

  test('confirms an unknown login from the round trip, and warns when that call fails', async () => {
    const { logger } = captureLogger()
    const db = memoryDb()
    const events: ClaudeCheckupProgress[] = []
    const unknown = commandScript({
      auth: commandResult({ stdout: 'status unavailable' })
    })
    const confirmed = await runClaudeCheckup({
      command: unknown,
      probe: probeFor([BINARY]),
      logger,
      db,
      binaryPath: BINARY,
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      clock: sequence(1000, 4200),
      id: 'checkup-unknown-ok',
      onProgress: (event) => events.push(event)
    })
    expect(events.map((event) => `${event.phase}:${event.state}`)).toEqual([
      'binary:running',
      'binary:ok',
      'login:running',
      'roundTrip:running',
      'login:ok',
      'roundTrip:ok'
    ])
    expect(confirmed.login).toBe('logged_in')
    expect(confirmed.plan).toBeNull()

    const failedEvents: ClaudeCheckupProgress[] = []
    const failed = commandScript({
      auth: commandResult({ stdout: 'status unavailable' }),
      print: () => commandResult({ stdout: 'nope' })
    })
    const unconfirmed = await runClaudeCheckup({
      command: failed,
      probe: probeFor([BINARY]),
      logger,
      db,
      binaryPath: BINARY,
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      id: 'checkup-unknown-fail',
      onProgress: (event) => failedEvents.push(event)
    })
    expect(failed.calls.filter((call) => call.args.includes('-p'))).toHaveLength(1)
    expect(unconfirmed.login).toBe('logged_out')
    expect(unconfirmed.rows.login.statusLabel).toBe('Not confirmed')
    expect(unconfirmed.rows.login.detail).toBe('Could not confirm the Claude Code login.')
    expect(unconfirmed.roundTrip).toBe('failed')
    expect(failedEvents.some((event) => event.phase === 'login' && event.state === 'warning')).toBe(
      true
    )
    expect(
      failedEvents.some((event) => event.phase === 'roundTrip' && event.state === 'warning')
    ).toBe(true)
  })

  test('does not retry a plan limit and retries a schema failure once', async () => {
    const { logger } = captureLogger()
    const db = memoryDb()
    const limited = commandScript({
      print: () => commandResult({ stdout: 'You hit your limit' })
    })
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
      id: 'checkup-limit'
    })
    expect(limited.calls.filter((call) => call.args.includes('-p'))).toHaveLength(1)
    expect(limit.login).toBe('logged_in')
    expect(limit.roundTrip).toBe('failed')
    expect(limit.rows.roundTrip.statusLabel).toBe('Plan limit')
    expect(limit.message).toMatch(/plan limit/)
    expect(limit.nextStep).toMatch(/Anthropic API key/)

    const retried = commandScript({
      print: (_request, attempt) =>
        attempt === 1
          ? commandResult({
              stdout: JSON.stringify({
                type: 'result',
                result: '{"extra":1}',
                structured_output: { extra: 1 }
              })
            })
          : commandResult({ stdout: readFixture('claude-cli/ok.json') })
    })
    const ready = await runClaudeCheckup({
      command: retried,
      probe: probeFor([BINARY]),
      logger,
      db,
      binaryPath: BINARY,
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      clock: sequence(0, 500),
      id: 'checkup-retry'
    })
    const prints = retried.calls.filter((call) => call.args.includes('-p'))
    expect(prints).toHaveLength(2)
    expect(ready.ready).toBe(true)

    // error_max_turns exits 1 with an empty stderr; the schema retry still runs.
    const turns = commandScript({
      print: (_request, attempt) =>
        attempt === 1
          ? commandResult({ exitCode: 1, stdout: readFixture('claude-cli/max-turns.json') })
          : commandResult({ stdout: readFixture('claude-cli/ok.json') })
    })
    const recovered = await runClaudeCheckup({
      command: turns,
      probe: probeFor([BINARY]),
      logger,
      db,
      binaryPath: BINARY,
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      clock: sequence(0, 500),
      id: 'checkup-max-turns'
    })
    const turnPrints = turns.calls.filter((call) => call.args.includes('-p'))
    expect(turnPrints).toHaveLength(2)
    expect(turnPrints[1]?.stdin).toContain('failed validation')
    expect(recovered.ready).toBe(true)
    expect(prints[1]?.stdin).toContain('failed validation')
    expect(prints[1]?.args.some((arg) => arg.includes('failed validation'))).toBe(false)
    expect(prints[0]?.args).toContain(JSON.stringify(CHECKUP_SCHEMA))
    expect(ready.ready).toBe(true)
  })

  test('redacts secrets from progress, logs, errors, and the checkup file', async () => {
    const { logger, lines } = captureLogger()
    const secretPath = `/tmp/${STAPLE}-${ANTHROPIC_KEY}/claude`
    const command = commandScript({
      version: commandResult({
        stdout: readFixture('claude-cli/version.txt'),
        stderr: `${STAPLE} ${ANTHROPIC_KEY}`
      })
    })
    const directory = mkdtempSync(join(tmpdir(), 'citefox-checkup-'))
    const filename = join(directory, 'app.sqlite')
    const db = openAppDatabase(filename)
    try {
      const events: ClaudeCheckupProgress[] = []
      const result = await runClaudeCheckup({
        command,
        probe: probeFor([secretPath]),
        logger,
        db,
        binaryPath: secretPath,
        savedBinaryPath: null,
        pathEnv: '',
        home: '/home/tester',
        platform: 'linux',
        secrets: [STAPLE],
        id: 'checkup-redacted',
        onProgress: (event) => events.push(event)
      })
      const dumped = JSON.stringify({ result, events, lines })
      expect(dumped).not.toContain(STAPLE)
      expect(dumped).not.toContain(ANTHROPIC_KEY)
      closeDatabase(db)
      const file = readDatabaseBytes(filename)
      expect(file.includes(Buffer.from(STAPLE))).toBe(false)
      expect(file.includes(Buffer.from(ANTHROPIC_KEY))).toBe(false)
    } finally {
      closeDatabase(db)
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('claude JSON result', () => {
  test('a schema call that ends in error_max_turns is a reply that missed the schema', () => {
    const stdout = readFixture('claude-cli/max-turns.json')
    const withSchema = parseClaudeCliOutput(stdout, '', CHECKUP_SCHEMA, [])
    expect(withSchema).toMatchObject({ ok: false, reason: 'validation' })
    if (withSchema.ok) return
    expect(withSchema.detail).toMatch(/answered in text instead of the JSON reply/)
    expect(withSchema.usage?.outputTokens).toBe(8535)
    // Without a schema, running out of turns is an ordinary CLI error.
    expect(parseClaudeCliOutput(stdout, '', null, [])).toMatchObject({ ok: false, reason: 'error' })
  })

  test('reads result text, usage, and the model with the most output tokens', () => {
    const parsed = parseClaudeCliOutput(readFixture('claude-cli/ok.json'), '', null, [])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.text).toBe('{"ok":true}')
    expect(parsed.usage.totalCostUsd).toBe(0)
    expect(resolvedModelId(parsed.usage.modelUsage)).toBe(DEFAULT_CLAUDE_MODEL)

    const error = parseClaudeCliOutput(readFixture('claude-cli/is-error.json'), '', null, [])
    expect(error.ok).toBe(false)
    if (error.ok) return
    expect(error.reason).toBe('error')
    expect(resolvedModelId(error.usage?.modelUsage)).toBe(DEFAULT_CLAUDE_MODEL)
    expect(resolvedModelId(undefined)).toBeNull()
    expect(resolvedModelId({})).toBeNull()
    expect(
      resolvedModelId({
        'claude-haiku-4-5': { outputTokens: 4 },
        'claude-sonnet-5-5': { outputTokens: 4 }
      })
    ).toBe('claude-haiku-4-5')
  })

  test('a web-search call reports the requested model, not the page-summarising helper', () => {
    // Live P7 run: the haiku that summarises fetched pages wrote more tokens than the answer.
    const usage = {
      'claude-haiku-5-5': { outputTokens: 9120 },
      'claude-sonnet-5-5': { outputTokens: 2310 }
    }
    expect(resolvedModelId(usage)).toBe('claude-haiku-5-5')
    expect(resolvedModelId(usage, 'claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
    expect(
      resolvedModelId(
        {
          'claude-haiku-5-5': { outputTokens: 900 },
          'claude-sonnet-5-5[1m]': { outputTokens: 20 }
        },
        'claude-sonnet-5-5'
      )
    ).toBe('claude-sonnet-5-5[1m]')
    // The requested model is not in the usage: the most output tokens, as before.
    expect(resolvedModelId(usage, 'claude-opus-5-5')).toBe('claude-haiku-5-5')
    // A longer id is a different model, not the requested one.
    expect(
      resolvedModelId(
        { 'claude-haiku-5-5': { outputTokens: 50 }, 'claude-sonnet-5-50': { outputTokens: 1 } },
        'claude-sonnet-5-5'
      )
    ).toBe('claude-haiku-5-5')
  })
})

describe('auth status parsing', () => {
  test('keeps the plan name and drops email', () => {
    expect(
      parseAuthStatus(
        JSON.stringify({
          loggedIn: true,
          authMethod: 'claude.ai',
          subscriptionType: 'pro',
          email: EMAIL
        }),
        ''
      )
    ).toEqual({ status: 'logged_in', plan: 'Claude Pro', authMethod: 'claude.ai' })
    expect(
      parseAuthStatus(
        JSON.stringify({
          loggedIn: true,
          authMethod: 'claude.ai',
          apiKeySource: 'ANTHROPIC_API_KEY'
        }),
        ''
      ).status
    ).toBe('api_key')
  })
})

function readDatabaseBytes(filename: string): Buffer {
  const parts = [readFileSync(filename)]
  for (const suffix of ['-wal', '-shm']) {
    const extra = `${filename}${suffix}`
    if (existsSync(extra)) parts.push(readFileSync(extra))
  }
  return Buffer.concat(parts)
}

function sequence(first: number, second: number): () => number {
  let calls = 0
  return () => {
    calls += 1
    return calls === 1 ? first : second
  }
}

describe('formatDuration', () => {
  test('matches the round-trip row copy', () => {
    expect(formatDuration(3200)).toBe('3.2 s')
    expect(formatDuration(800)).toBe('800 ms')
    expect(formatDuration(12_000)).toBe('12 s')
  })
})
