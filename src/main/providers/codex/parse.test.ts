import { describe, expect, test } from 'vitest'
import { readFixture } from '../claude/claude-test-fakes.test-helper'
import { codexFailure, formatResetTime } from './errors'
import {
  classifyCodexFailure,
  codexResetsAt,
  parseCodexExecOutput,
  parseCodexLoginStatus,
  parseCodexVersion,
  type CodexParse
} from './parse'

const NOW = new Date(2026, 9, 29, 9, 0)
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { color: { type: 'string' }, count: { type: 'integer' } },
  required: ['color', 'count']
}

function codex(name: string): string {
  return readFixture(`codex-cli/${name}`)
}

function failed(parsed: CodexParse): Extract<CodexParse, { ok: false }> {
  if (parsed.ok) throw new Error('expected a failure')
  return parsed
}

describe('codex version and sign-in', () => {
  test('reads the version line', () => {
    expect(parseCodexVersion(codex('version.txt'))).toBe('0.149.0')
    expect(parseCodexVersion('nothing here')).toBeNull()
  })

  test('reads a ChatGPT sign-in, a missing one and an API key without keeping it', () => {
    expect(parseCodexLoginStatus('', codex('login-chatgpt.txt'))).toEqual({
      status: 'logged_in',
      plan: 'ChatGPT',
      authMethod: 'chatgpt'
    })
    expect(parseCodexLoginStatus('', codex('login-none.txt')).status).toBe('logged_out')
    const key = parseCodexLoginStatus('', 'Logged in using an API key - sk-proj-FAKE0000')
    expect(key.status).toBe('api_key')
    expect(JSON.stringify(key)).not.toContain('sk-proj')
    expect(parseCodexLoginStatus('', 'something else').status).toBe('unknown')
  })
})

describe('codex exec output', () => {
  test('a plain reply with its usage', () => {
    const parsed = parseCodexExecOutput(codex('exec-text.jsonl'), '', null, [], NOW)
    expect(parsed).toMatchObject({ ok: true, text: 'pong', json: null, webSearches: 0 })
    if (!parsed.ok) return
    expect(parsed.usage.inputTokens).toBe(13802)
    expect(parsed.usage.outputTokens).toBe(5)
    expect(parsed.usage.cacheReadInputTokens).toBe(0)
  })

  test('a schema reply is parsed and checked', () => {
    const parsed = parseCodexExecOutput(codex('exec-schema.jsonl'), '', SCHEMA, [], NOW)
    expect(parsed).toMatchObject({ ok: true, json: { color: 'red', count: 3 } })
  })

  test('a null the strict schema forced on an optional field is dropped', () => {
    const schema = {
      type: 'object',
      properties: { ok: { type: 'boolean' }, note: { type: 'string' } },
      required: ['ok']
    }
    const parsed = parseCodexExecOutput(codex('exec-schema-nullable.jsonl'), '', schema, [], NOW)
    expect(parsed).toMatchObject({ ok: true, json: { ok: true }, text: '{"ok":true}' })
  })

  test('the code-mode warning item does not fail a run', () => {
    expect(parseCodexExecOutput(codex('exec-schema-nullable.jsonl'), '', null, [], NOW).ok).toBe(
      true
    )
  })

  test('counts web searches', () => {
    const parsed = parseCodexExecOutput(codex('exec-web-search.jsonl'), '', null, [], NOW)
    expect(parsed).toMatchObject({ ok: true, text: '0.164.0', webSearches: 1 })
    if (parsed.ok) expect(parsed.usage.cacheReadInputTokens).toBe(7552)
  })

  test('the last of several messages is the reply', () => {
    const parsed = parseCodexExecOutput(codex('exec-two-messages.jsonl'), '', null, [], NOW)
    expect(parsed.ok && parsed.text.startsWith('{"listed"')).toBe(true)
  })

  test('a fenced JSON reply is accepted, a wrong shape is a validation failure', () => {
    const fenced = [
      '{"type":"item.completed","item":{"type":"agent_message","text":"```json\\n{\\"color\\":\\"red\\",\\"count\\":1}\\n```"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'
    ].join('\n')
    expect(parseCodexExecOutput(fenced, '', SCHEMA, [], NOW).ok).toBe(true)
    const wrong = parseCodexExecOutput(codex('exec-text.jsonl'), '', SCHEMA, [], NOW)
    expect(failed(wrong)).toMatchObject({ reason: 'validation' })
    expect(failed(wrong).usage?.inputTokens).toBe(13802)
  })

  test('no events at all is malformed, a finished turn with no message too', () => {
    expect(failed(parseCodexExecOutput('', '', null, [], NOW)).reason).toBe('malformed')
    const silent = '{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":0}}'
    expect(failed(parseCodexExecOutput(silent, '', null, [], NOW)).reason).toBe('malformed')
  })

  test.each([
    ['exec-logged-out.jsonl', 'logged_out'],
    ['exec-model-not-found.jsonl', 'model'],
    ['exec-schema-rejected.jsonl', 'schema_rejected'],
    ['constructed-usage-limit.jsonl', 'limit'],
    ['constructed-rate-limited.jsonl', 'rate_limited'],
    ['constructed-overloaded.jsonl', 'overloaded']
  ])('%s is %s', (name, reason) => {
    const parsed = failed(parseCodexExecOutput(codex(name), 'log line', null, [], NOW))
    expect(parsed.reason).toBe(reason)
    expect(parsed.detail).not.toMatch(/^\{/)
  })

  test('a usage limit carries its reset time', () => {
    const parsed = failed(
      parseCodexExecOutput(codex('constructed-usage-limit.jsonl'), '', null, [], NOW)
    )
    expect(parsed.resetsAt).toEqual(new Date(2026, 9, 30, 15, 45))
  })

  test('stderr is read only when Codex wrote no error of its own', () => {
    const parsed = failed(parseCodexExecOutput('', 'Error: not logged in', null, [], NOW))
    expect(parsed.reason).toBe('logged_out')
    const unknown = failed(parseCodexExecOutput('', 'something odd', null, [], NOW))
    expect(unknown).toMatchObject({ reason: 'error', detail: 'something odd' })
  })

  test('a secret in an error is redacted', () => {
    const parsed = classifyCodexFailure('boom sk-proj-SECRET0000 here', ['sk-proj-SECRET0000'], {
      usage: null,
      now: NOW
    })
    expect(failed(parsed).detail).not.toContain('SECRET0000')
  })
})

describe('codex reset times', () => {
  test('reads every wording Codex uses', () => {
    expect(codexResetsAt('try again at 3:45 PM.', NOW)).toEqual(new Date(2026, 9, 29, 15, 45))
    expect(codexResetsAt('try again at 8:15 AM.', NOW)).toEqual(new Date(2026, 9, 30, 8, 15))
    expect(codexResetsAt('try again at Oct 30th, 2026 3:45 PM.', NOW)).toEqual(
      new Date(2026, 9, 30, 15, 45)
    )
    expect(codexResetsAt('try again in 2 hours and 5 minutes', NOW)).toEqual(
      new Date(NOW.getTime() + 125 * 60_000)
    )
    expect(codexResetsAt('{"resets_at":1793372400}', NOW)).toEqual(new Date(1793372400 * 1000))
    expect(codexResetsAt('{"resets_in_seconds":90}', NOW)).toEqual(new Date(NOW.getTime() + 90_000))
    expect(codexResetsAt('no time given', NOW)).toBeNull()
  })
})

describe('codex errors in plain English', () => {
  const kinds: Array<[Extract<CodexParse, { ok: false }>['reason'], string]> = [
    ['limit', 'plan_limit'],
    ['logged_out', 'logged_out'],
    ['rate_limited', 'rate_limited'],
    ['overloaded', 'overloaded'],
    ['model', 'validation'],
    ['validation', 'validation'],
    ['schema_rejected', 'malformed'],
    ['malformed', 'malformed'],
    ['error', 'spawn']
  ]

  test.each(kinds)('%s maps to %s and never names Claude', (reason, code) => {
    const error = codexFailure(
      { ok: false, reason, detail: 'detail', usage: null, resetsAt: null },
      null,
      'gpt-5.6-terra',
      [],
      NOW
    )
    expect(error.code).toBe(code)
    expect(error.message).toContain('Codex')
    expect(`${error.message} ${error.nextStep ?? ''}`).not.toMatch(/claude/i)
  })

  test('a usage limit says when it resets and keeps the time', () => {
    const at = new Date(2026, 9, 29, 15, 45)
    const error = codexFailure(
      { ok: false, reason: 'limit', detail: '', usage: null, resetsAt: at },
      null,
      'gpt-5.6-terra',
      [],
      NOW
    )
    expect(error.resetsAt).toEqual(at)
    expect(error.message).toContain(formatResetTime(at, NOW))
    expect(formatResetTime(new Date(2026, 9, 30, 15, 45), NOW)).toContain('Oct 30')
  })
})
