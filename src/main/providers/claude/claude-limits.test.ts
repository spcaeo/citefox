import { describe, expect, test } from 'vitest'
import { MemorySecretStore } from '../../secrets/secret-store'
import type { CommandResult } from '../command'
import type { HttpTransport } from '../http'
import { ProviderError } from '../errors'
import { createAnthropicApiProvider } from './anthropic-api'
import { createClaudeCodeProvider } from './claude-code'
import {
  BINARY,
  captureLogger,
  commandResult,
  commandScript,
  probeFor
} from './claude-test-fakes.test-helper'
import { CLAUDE_PAUSE_MARGIN_MS, CLAUDE_PAUSE_UNKNOWN_MS, claudeCodePause } from './shared-gate'

// The words read the computer's own zone, so the patterns accept today or tomorrow.
const NOW = Date.parse('2026-10-29T18:00:00Z')
const OTHER_BINARY = '/opt/fake/claude'

function failed(result: string): CommandResult {
  return commandResult({
    exitCode: 1,
    stdout: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      api_error_status: 429,
      result,
      usage: { input_tokens: 0, output_tokens: 0 },
      modelUsage: {}
    })
  })
}

function provider(
  command: ReturnType<typeof commandScript>,
  options: { binary?: string; clock?: () => number; ignorePause?: boolean } = {}
): ReturnType<typeof createClaudeCodeProvider> {
  const binary = options.binary ?? BINARY
  return createClaudeCodeProvider({
    command,
    probe: probeFor([binary]),
    logger: captureLogger().logger,
    savedBinaryPath: binary,
    platform: 'linux',
    model: null,
    pathEnv: '',
    baseEnv: { PATH: '/usr/bin' },
    sleep: async () => undefined,
    clock: options.clock ?? ((): number => NOW),
    ...(options.ignorePause === undefined ? {} : { ignorePause: options.ignorePause })
  })
}

function prints(command: ReturnType<typeof commandScript>): number {
  return command.calls.filter((call) => call.args.includes('-p')).length
}

describe('Claude Code failures, in plain words', () => {
  test.each([
    [
      "You've hit your session limit · resets 7:30pm (America/Toronto)",
      'plan_limit',
      /^You've reached your 5-hour Claude usage limit\. It resets (?:today|tomorrow) at .+\. Work already done is kept\. You can wait, add an Anthropic API key in Connections and keys, or carry on with the steps that don't need AI\.$/
    ],
    [
      "You've hit your weekly limit · resets Nov 2, 9am (America/Toronto)",
      'plan_limit',
      /^You've reached your weekly Claude usage limit\. It resets \w+, Nov [23] at .+\. Work already done is kept\./
    ],
    [
      'Claude AI usage limit reached|1793307600',
      'plan_limit',
      /^You've reached your 5-hour Claude usage limit\. It resets (?:today|tomorrow) at/
    ],
    ['Opus weekly limit reached', 'plan_limit', /did not say when it resets/],
    ['Not logged in · Please run /login', 'logged_out', /^Claude Code is signed out/],
    [
      'Your Claude subscription has expired. Renew your plan at claude.ai to keep using Claude Code.',
      'plan_inactive',
      /^Your Claude subscription is not active/
    ],
    ['Credit balance is too low', 'credit_low', /run out of credit/],
    ['Invalid API key · Please run /login', 'unauthorized', /\(401\)/],
    [
      'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      'overloaded',
      /busy right now/
    ]
  ])('%s', async (result, code, message) => {
    const command = commandScript({ print: () => failed(result) })
    const error = await provider(command)
      .complete({ prompt: 'ping' })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ code })
    expect((error as ProviderError).message).toMatch(message)
    // Never started again: a limit or a sign-in problem is not retried.
    expect(prints(command)).toBe(1)
  })
})

describe('the shared pause after a limit (no retry storm)', () => {
  test('later calls fail at once, without starting claude, until the reset', async () => {
    let now = NOW
    const command = commandScript({
      print: () => failed("You've hit your session limit · resets 7:30pm (America/Toronto)")
    })
    const first = provider(command, { clock: () => now })
    await expect(first.complete({ prompt: 'a' })).rejects.toMatchObject({ code: 'plan_limit' })
    const paused = claudeCodePause(BINARY, now)
    expect(paused?.limit.kind).toBe('session')
    expect(paused?.until).toBe(Date.parse('2026-10-29T23:30:00Z') + CLAUDE_PAUSE_MARGIN_MS)

    // A provider built for another IPC call shares the pause.
    const second = provider(command, { clock: () => now })
    const results = await Promise.allSettled([
      second.complete({ prompt: 'b' }),
      second.complete({ prompt: 'c' }),
      second.complete({ prompt: 'd' })
    ])
    expect(results.every((entry) => entry.status === 'rejected')).toBe(true)
    expect(prints(command)).toBe(1)
    const reason = (results[0] as PromiseRejectedResult).reason as ProviderError
    expect(reason.code).toBe('plan_limit')
    expect(reason.limit?.resetsAt?.toISOString()).toBe('2026-10-29T23:30:00.000Z')
    expect(reason.message).toMatch(/It resets (?:today|tomorrow) at/)

    // After the reset (and margin) calls start again.
    now = Date.parse('2026-10-29T23:33:00Z')
    expect(claudeCodePause(BINARY, now)).toBeNull()
    await expect(second.complete({ prompt: 'e' })).rejects.toMatchObject({ code: 'plan_limit' })
    expect(prints(command)).toBe(2)
  })

  test('an unknown reset pauses for an hour', async () => {
    const command = commandScript({ print: () => failed('Opus weekly limit reached') })
    await expect(provider(command).complete({ prompt: 'a' })).rejects.toMatchObject({
      code: 'plan_limit'
    })
    expect(claudeCodePause(BINARY, NOW)?.until).toBe(NOW + CLAUDE_PAUSE_UNKNOWN_MS)
  })

  test('another claude program is not paused, and a sign-in problem never pauses', async () => {
    const limited = commandScript({ print: () => failed("You've hit your weekly limit") })
    await expect(provider(limited).complete({ prompt: 'a' })).rejects.toMatchObject({
      code: 'plan_limit'
    })
    const other = commandScript({})
    await expect(
      provider(other, { binary: OTHER_BINARY }).complete({ prompt: 'b' })
    ).resolves.toMatchObject({ text: '{"ok":true}' })

    const command = commandScript({ print: () => failed('Not logged in · Please run /login') })
    await expect(
      provider(command, { binary: OTHER_BINARY }).complete({ prompt: 'c' })
    ).rejects.toMatchObject({ code: 'logged_out' })
    expect(claudeCodePause(OTHER_BINARY, NOW)).toBeNull()
  })

  test('the checkup call runs while paused, and a reply lifts the pause', async () => {
    let limitedOnce = false
    const command = commandScript({
      print: () => {
        if (limitedOnce) return commandResult({ stdout: JSON.stringify(okResult()) })
        limitedOnce = true
        return failed("You've hit your session limit · resets 7:30pm (America/Toronto)")
      }
    })
    await expect(provider(command).complete({ prompt: 'a' })).rejects.toMatchObject({
      code: 'plan_limit'
    })
    await expect(provider(command).complete({ prompt: 'b' })).rejects.toMatchObject({
      code: 'plan_limit'
    })
    expect(prints(command)).toBe(1)
    await expect(
      provider(command, { ignorePause: true }).complete({ prompt: 'check' })
    ).resolves.toMatchObject({ text: 'ok' })
    expect(claudeCodePause(BINARY, NOW)).toBeNull()
    await expect(provider(command).complete({ prompt: 'c' })).resolves.toMatchObject({
      text: 'ok'
    })
  })
})

function okResult(): Record<string, unknown> {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ok',
    usage: { input_tokens: 1, output_tokens: 1 }
  }
}

describe('Anthropic API key failures', () => {
  function apiProvider(
    status: number,
    body: unknown
  ): ReturnType<typeof createAnthropicApiProvider> {
    const store = new MemorySecretStore()
    store.set('ref', 'sk-ant-api03-FAKE000000000000000000')
    const transport: HttpTransport = {
      request: async () => ({ status, headers: {}, body: JSON.stringify(body) })
    }
    return createAnthropicApiProvider({
      secretStore: store,
      keychainRef: 'ref',
      transport,
      logger: captureLogger().logger,
      sleep: async () => undefined
    })
  }

  test('a low credit balance says so, with what to do', async () => {
    const error = await apiProvider(400, {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message:
          'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
      }
    })
      .complete({ prompt: 'ping' })
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'credit_low' })
    expect((error as Error).message).toMatch(/^Your Anthropic API key has run out of credit\./)
  })

  test('a 401 is a rejected key, never a limit', async () => {
    const error = await apiProvider(401, {
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' }
    })
      .complete({ prompt: 'ping' })
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'unauthorized' })
    expect((error as Error).message).toMatch(/rejected this API key/)
  })
})
