import { afterEach, describe, expect, test } from 'vitest'
import { ProviderTimeoutError } from '../errors'
import { providerCommandSpawnOptions } from '../command'
import { WEB_SEARCH_MAX_TURNS } from './claude-args'
import {
  CLAUDE_CODE_COMPLETION_TIMEOUT_MS,
  CLAUDE_CODE_MIN_VERSION,
  CLAUDE_CODE_WEB_SEARCH_TIMEOUT_MS,
  EMPTY_MCP_CONFIG,
  claudePrintArgs,
  resetClaudeCodeFlagSupportForTests
} from './claude-code'
import {
  STAPLE,
  captureLeveledLogger,
  captureLogger,
  claudeProvider,
  commandResult,
  commandScript,
  readFixture
} from './claude-test-fakes.test-helper'
import { DEFAULT_CLAUDE_MODEL } from './model'
import { clearClaudeCodePause } from './shared-gate'

afterEach(() => {
  resetClaudeCodeFlagSupportForTests()
})

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' } },
  required: ['ok']
}

function unknownOption(flag: string): ReturnType<typeof commandResult> {
  return commandResult({ exitCode: 1, stdout: '', stderr: `error: unknown option '${flag}'` })
}

function okWithUsage(
  input: number,
  output: number,
  json: unknown
): ReturnType<typeof commandResult> {
  return commandResult({
    stdout: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: JSON.stringify(json),
      usage: { input_tokens: input, output_tokens: output },
      modelUsage: { [DEFAULT_CLAUDE_MODEL]: { inputTokens: input, outputTokens: output } }
    })
  })
}

describe('claude -p arguments', () => {
  test('pass the prompt on stdin, never in argv, with every restriction flag', () => {
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
  })

  test('a JSON-schema call may take a second turn for the structured reply; tools stay off', () => {
    // Claude Code returns --json-schema output through a synthetic tool, which needs a
    // follow-up turn: with --max-turns 1 about a fifth of first replies ended in
    // error_max_turns (prose instead of JSON) in the live run.
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } }
    const args = claudePrintArgs(DEFAULT_CLAUDE_MODEL, schema)
    expect(args.slice(args.indexOf('--max-turns'), args.indexOf('--max-turns') + 2)).toEqual([
      '--max-turns',
      '2'
    ])
    for (const flag of [
      '--tools',
      '--disallowedTools',
      '--strict-mcp-config',
      '--mcp-config',
      '--safe-mode',
      '--restricted',
      '--no-session-persistence'
    ]) {
      expect(args).toContain(flag)
    }
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('mcp__*')
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(schema))
    // A call without a schema stays single-turn (LLM-3).
    const plain = claudePrintArgs(DEFAULT_CLAUDE_MODEL, null)
    expect(plain[plain.indexOf('--max-turns') + 1]).toBe('1')
  })

  test('a completion writes the prompt to stdin and keeps it out of argv and logs', async () => {
    const { logger, lines } = captureLogger()
    const command = commandScript({})
    await claudeProvider(command, logger).complete({ prompt: 'secret-page-text' })
    const print = command.calls.find((call) => call.args.includes('-p'))
    expect(print?.stdin).toBe('secret-page-text')
    expect(print?.args.some((arg) => arg.includes('secret-page-text'))).toBe(false)
    expect(print?.args[0]).toBe('-p')
    expect(print?.args[1]).toBe('--output-format')
    expect(providerCommandSpawnOptions(print ?? { stdin: null }).stdio[0]).toBe('pipe')
    expect(print?.timeoutMs).toBe(CLAUDE_CODE_COMPLETION_TIMEOUT_MS)
    expect(CLAUDE_CODE_COMPLETION_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000)
    expect(lines.join('\n')).not.toContain('secret-page-text')
  })

  test('web search (batch 2 row 5) allows only WebSearch and WebFetch, for that call only', () => {
    const args = claudePrintArgs(DEFAULT_CLAUDE_MODEL, null, new Set(), { webSearch: true })
    expect(args[args.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch')
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('WebSearch,WebFetch')
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('mcp__*')
    expect(args[args.indexOf('--max-turns') + 1]).toBe(String(WEB_SEARCH_MAX_TURNS))
    for (const flag of [
      '--strict-mcp-config',
      '--mcp-config',
      '--safe-mode',
      '--restricted',
      '--no-session-persistence'
    ]) {
      expect(args).toContain(flag)
    }
    for (const tool of ['Bash', 'Edit', 'Write', 'Read', 'default']) {
      expect(args.some((arg) => arg.includes(tool))).toBe(false)
    }
    // Every other call keeps tools off.
    const plain = claudePrintArgs(DEFAULT_CLAUDE_MODEL, null)
    expect(plain[plain.indexOf('--tools') + 1]).toBe('')
    expect(plain).not.toContain('--allowedTools')
  })

  test('a web-search completion gets its own timeout and no transport retry', async () => {
    const command = commandScript({
      print: () => commandResult({ timedOut: true, exitCode: null })
    })
    await expect(
      claudeProvider(command, captureLogger().logger).complete({ prompt: 'p', webSearch: true })
    ).rejects.toBeInstanceOf(ProviderTimeoutError)
    const prints = command.calls.filter((call) => call.args.includes('-p'))
    expect(prints).toHaveLength(1)
    expect(prints[0]?.timeoutMs).toBe(CLAUDE_CODE_WEB_SEARCH_TIMEOUT_MS)
    expect(prints[0]?.args).toContain('WebSearch,WebFetch')
  })
})

describe('restriction flag support', () => {
  test('drops only the rejected cosmetic flag and keeps tools off', async () => {
    const { logger, lines, warnings } = captureLeveledLogger()
    const command = commandScript({
      print: (request) =>
        request.args.includes('--restricted')
          ? commandResult({
              exitCode: 1,
              stdout: '',
              stderr: `error: unknown option '--restricted' ${STAPLE}`
            })
          : commandResult({ stdout: readFixture('claude-cli/ok.json') })
    })
    const completion = await claudeProvider(command, logger, [STAPLE]).complete({
      prompt: 'ping-lean'
    })
    const prints = command.calls.filter((call) => call.args.includes('-p'))
    expect(prints).toHaveLength(2)
    expect(prints[1]?.args).not.toContain('--restricted')
    for (const kept of ['--tools', '--disallowedTools', '--safe-mode', '--strict-mcp-config']) {
      expect(prints[1]?.args).toContain(kept)
    }
    expect(prints[1]?.stdin).toBe('ping-lean')
    expect(completion.text).toBe('{"ok":true}')
    expect(warnings.join('\n')).toContain('"flag":"--restricted"')
    expect(lines.join('\n')).not.toContain(STAPLE)
    expect(lines.join('\n')).not.toContain('ping-lean')
  })

  test('remembers each rejected flag for later calls and drops them one at a time', async () => {
    const { logger } = captureLogger()
    const rejecting = commandScript({
      print: (request) => {
        if (request.args.includes('--restricted')) return unknownOption('--restricted')
        if (request.args.includes('--no-session-persistence')) {
          return unknownOption('--no-session-persistence')
        }
        return commandResult({ stdout: readFixture('claude-cli/ok.json') })
      }
    })
    await claudeProvider(rejecting, logger).complete({ prompt: 'first-call' })
    expect(rejecting.calls.filter((call) => call.args.includes('-p'))).toHaveLength(3)

    const later = commandScript({})
    await claudeProvider(later, logger).complete({ prompt: 'second-call' })
    const second = later.calls.filter((call) => call.args.includes('-p'))
    expect(second).toHaveLength(1)
    expect(second[0]?.args).toEqual(
      claudePrintArgs(
        DEFAULT_CLAUDE_MODEL,
        null,
        new Set(['--restricted', '--no-session-persistence'])
      )
    )
    expect(second[0]?.args).toContain('--tools')
    expect(second[0]?.args).toContain('--safe-mode')
  })

  test.each(['--tools', '--disallowedTools'])(
    'fails with an update message when the CLI rejects %s',
    async (flag) => {
      const { logger } = captureLogger()
      const command = commandScript({ print: () => unknownOption(flag) })
      const error = await claudeProvider(command, logger)
        .complete({ prompt: 'ping-old' })
        .then(
          () => null,
          (caught: unknown) => caught
        )
      expect(error).toMatchObject({ code: 'spawn' })
      expect((error as Error).message).toContain(
        `Update Claude Code to version ${CLAUDE_CODE_MIN_VERSION}`
      )
      expect((error as Error).message).toContain(flag)
      const prints = command.calls.filter((call) => call.args.includes('-p'))
      expect(prints).toHaveLength(1)

      const again = commandScript({})
      await expect(
        claudeProvider(again, logger).complete({ prompt: 'ping-again' })
      ).resolves.toMatchObject({ text: '{"ok":true}' })
      expect(again.calls.filter((call) => call.args.includes('-p'))[0]?.args).toContain(flag)
    }
  )

  test('does not drop flags on auth, rate-limit, or model errors', async () => {
    const cases: Array<{ stderr: string; code: string }> = [
      {
        stderr:
          "error: unknown option '--restricted'\nPlease run `claude` /login. You are not logged in.",
        code: 'logged_out'
      },
      { stderr: "error: invalid argument '--safe-mode'\nYou hit your limit", code: 'plan_limit' },
      {
        stderr: "error: unknown option '--restricted'\nunknown model 'claude-sonnet-5-5'",
        code: 'malformed'
      }
    ]
    for (const entry of cases) {
      resetClaudeCodeFlagSupportForTests()
      // The limit case pauses Claude Code for the process; lift it for the next case.
      clearClaudeCodePause()
      const { logger, warnings } = captureLeveledLogger()
      const command = commandScript({
        print: () => commandResult({ exitCode: 1, stdout: '', stderr: entry.stderr })
      })
      await expect(
        claudeProvider(command, logger).complete({ prompt: 'ping-auth' })
      ).rejects.toMatchObject({ code: entry.code })
      expect(command.calls.filter((call) => call.args.includes('-p'))).toHaveLength(1)
      expect(warnings.join('\n')).not.toContain('"flag"')
    }
  })
})

describe('Claude Code attempt budget', () => {
  test('a timeout is retried once, not three times', async () => {
    const { logger } = captureLogger()
    const command = commandScript({
      print: () => commandResult({ timedOut: true, exitCode: null })
    })
    await expect(
      claudeProvider(command, logger).complete({ prompt: 'ping-slow' })
    ).rejects.toBeInstanceOf(ProviderTimeoutError)
    expect(command.calls.filter((call) => call.args.includes('-p'))).toHaveLength(2)
  })

  test('transport and schema retries share one budget of three calls', async () => {
    const { logger } = captureLogger()
    const command = commandScript({
      print: (_request, attempt) => {
        if (attempt === 1) return commandResult({ timedOut: true, exitCode: null })
        if (attempt === 2) return okWithUsage(5, 2, { ok: 'not-a-boolean' })
        return commandResult({ timedOut: true, exitCode: null })
      }
    })
    await expect(
      claudeProvider(command, logger).complete({ prompt: 'ping-budget', schema: SCHEMA })
    ).rejects.toBeInstanceOf(ProviderTimeoutError)
    expect(command.calls.filter((call) => call.args.includes('-p'))).toHaveLength(3)
  })

  test('sums token usage across a schema retry', async () => {
    const { logger } = captureLogger()
    const command = commandScript({
      print: (_request, attempt) =>
        attempt === 1 ? okWithUsage(10, 3, { ok: 'nope' }) : okWithUsage(20, 4, { ok: true })
    })
    const completion = await claudeProvider(command, logger).complete({
      prompt: 'ping-sum',
      schema: SCHEMA
    })
    expect(completion.json).toEqual({ ok: true })
    expect(completion.inputTokens).toBe(30)
    expect(completion.outputTokens).toBe(7)
    expect(completion.usage.inputTokens).toBe(30)
    expect(completion.usage.modelUsage[DEFAULT_CLAUDE_MODEL]?.outputTokens).toBe(7)
  })

  test('reports a max_tokens stop as truncation without a schema retry', async () => {
    const { logger } = captureLogger()
    const command = commandScript({
      print: () =>
        commandResult({
          stdout: JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            stop_reason: 'max_tokens',
            result: '{"ok":',
            usage: { input_tokens: 9, output_tokens: 32000 }
          })
        })
    })
    const error = await claudeProvider(command, logger)
      .complete({ prompt: 'ping-long', schema: SCHEMA })
      .then(
        () => null,
        (caught: unknown) => caught
      )
    expect((error as Error).message).toMatch(/cut off/i)
    expect(error).toMatchObject({ usage: { outputTokens: 32000 } })
    expect(command.calls.filter((call) => call.args.includes('-p'))).toHaveLength(1)
  })
})

describe('process-wide Claude gate', () => {
  test('providers created per action share the configured calls-at-once limit', async () => {
    const { logger } = captureLogger()
    const release: Array<() => void> = []
    let active = 0
    let max = 0
    const command = commandScript({})
    const slow: typeof command = {
      calls: command.calls,
      async run(request) {
        if (!request.args.includes('-p')) return command.run(request)
        active += 1
        max = Math.max(max, active)
        await new Promise<void>((resolve) => {
          release.push(() => {
            active -= 1
            resolve()
          })
        })
        return commandResult({ stdout: readFixture('claude-cli/ok.json') })
      }
    }
    const providers = [0, 1, 2].map(() => claudeProvider(slow, logger))
    const tasks = providers.map((provider) => provider.complete({ prompt: 'ping' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(release).toHaveLength(2)
    release[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(release).toHaveLength(3)
    release[1]?.()
    release[2]?.()
    await Promise.all(tasks)
    expect(max).toBe(2)
  })
})
