import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSpawnCommandTransport } from '../command'
import { ProviderError, ProviderTimeoutError } from '../errors'
import { createFsBinaryProbe } from './binary'
import { createClaudeCodeProvider, type ClaudeCodeProvider } from './claude-code'
import { captureLogger, readFixture } from './claude-test-fakes.test-helper'
import { claudeCodePause, clearClaudeCodePause } from './shared-gate'

/**
 * Runs scripts/fake-claude.mjs (through its `claude` shell file) as a real child
 * process behind ClaudeCodeProvider, the way the app would. The "real" claude it
 * passes calls to is a stub that prints the recorded ok reply, so no quota is used.
 */
const SHIM = resolve('scripts/fake-claude/claude')
const posix = process.platform !== 'win32'

let folder = ''
let stub = ''
let state = ''

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), 'citefox-fake-claude-'))
  const reply = join(folder, 'ok.json')
  writeFileSync(reply, readFixture('claude-cli/ok.json'))
  stub = join(folder, 'claude')
  writeFileSync(
    stub,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.312 (Claude Code)"; exit 0; fi\ncat > /dev/null\ncat "${reply}"\n`
  )
  chmodSync(stub, 0o755)
  state = join(folder, 'state.json')
})

afterAll(() => {
  rmSync(folder, { recursive: true, force: true })
})

function fake(
  mode: string,
  extra: Record<string, string> = {},
  completeMs = 20_000
): ClaudeCodeProvider {
  rmSync(state, { force: true })
  return createClaudeCodeProvider({
    command: createSpawnCommandTransport(),
    probe: createFsBinaryProbe(),
    logger: captureLogger().logger,
    savedBinaryPath: SHIM,
    model: null,
    baseEnv: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: folder,
      FAKE_CLAUDE_MODE: mode,
      FAKE_CLAUDE_STATE: state,
      FAKE_CLAUDE_REAL: stub,
      FAKE_CLAUDE_ZONE: 'America/Toronto',
      ...extra
    },
    sleep: async () => undefined,
    timeouts: { completeMs }
  })
}

function printCount(): number {
  return (JSON.parse(readFileSync(state, 'utf8')) as { prints: number }).prints
}

describe.runIf(posix)('fake claude through ClaudeCodeProvider', () => {
  test.each([
    ['session_limit', 'plan_limit', /^You've reached your 5-hour Claude usage limit\. It resets/],
    ['weekly_limit', 'plan_limit', /^You've reached your weekly Claude usage limit\. It resets/],
    ['legacy_limit', 'plan_limit', /Claude usage limit\. It resets/],
    ['signed_out', 'logged_out', /^Claude Code is signed out/],
    ['plan_inactive', 'plan_inactive', /^Your Claude subscription is not active/],
    ['api_credit_low', 'credit_low', /run out of credit/],
    ['overloaded', 'overloaded', /busy right now/],
    ['malformed', 'malformed', /.+/]
  ])('%s', async (mode, code, message) => {
    const error = await fake(mode)
      .complete({ prompt: 'ping' })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ code })
    expect((error as Error).message).toMatch(message)
  })

  test('passes calls through until the trigger, then a weekly limit pauses Claude Code', async () => {
    const provider = fake('weekly_limit', { FAKE_CLAUDE_AFTER: '2' })
    await expect(provider.complete({ prompt: 'one' })).resolves.toMatchObject({
      text: '{"ok":true}'
    })
    await expect(provider.complete({ prompt: 'two' })).resolves.toMatchObject({
      text: '{"ok":true}'
    })
    const limited = await provider.complete({ prompt: 'three' }).catch((caught: unknown) => caught)
    expect(limited).toMatchObject({ code: 'plan_limit', limit: { kind: 'weekly' } })
    expect(claudeCodePause(SHIM, Date.now())?.limit.kind).toBe('weekly')
    // Paused: the fourth call never starts the program.
    await expect(provider.complete({ prompt: 'four' })).rejects.toMatchObject({
      code: 'plan_limit'
    })
    expect(printCount()).toBe(3)
  })

  test('once its reset time passes, the fake lets calls through again', async () => {
    // The limit "resets" a minute before it hits, so the next call finds it lifted.
    const provider = fake('session_limit', { FAKE_CLAUDE_RESET_MINUTES: '-1' })
    await expect(provider.complete({ prompt: 'one' })).rejects.toMatchObject({ code: 'plan_limit' })
    // CiteFox's own pause would hold the next call until then; lift it as the reset would.
    clearClaudeCodePause()
    await expect(provider.complete({ prompt: 'two' })).resolves.toMatchObject({
      text: '{"ok":true}'
    })
    expect(printCount()).toBe(2)
  })

  test('answers --version and auth status like Claude Code for each mode', async () => {
    const signedOut = fake('signed_out')
    await expect(signedOut.readVersion(SHIM)).resolves.toEqual({ ok: true, version: '2.1.312' })
    await expect(signedOut.readLogin(SHIM)).resolves.toMatchObject({ status: 'logged_out' })
    await expect(fake('api_credit_low').readLogin(SHIM)).resolves.toMatchObject({
      status: 'api_key'
    })
    await expect(fake('weekly_limit').readLogin(SHIM)).resolves.toMatchObject({
      status: 'logged_in',
      plan: 'Claude Max'
    })
  })

  test('timeout hangs past the limit and is reported as a timeout', async () => {
    const error = await fake('timeout', { FAKE_CLAUDE_SLEEP_MS: '60000' }, 1500)
      .complete({ prompt: 'ping' })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderTimeoutError)
  }, 20_000)
})
