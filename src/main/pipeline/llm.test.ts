import { afterEach, describe, expect, test } from 'vitest'
import { createLogger } from '../logging/logger'
import { createAnthropicApiProvider } from '../providers/claude/anthropic-api'
import { ClaudeCodeCallError, type ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import type { HttpRequest, HttpTransport } from '../providers/http'
import { MemorySecretStore } from '../secrets/secret-store'
import { listGenerations } from '../storage/content-records'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from '../storage/database'
import { insertPage } from '../storage/pages'
import { ensureProjectSchema } from '../storage/project-profile'
import type { ValidationProblem } from './errors'
import { completeStructured, MODEL_REQUESTS_PER_GENERATION } from './llm'

const NOW = '2026-10-19T12:00:00.000Z'
const REF = 'citefox.anthropic.key-1'
const KEY = 'sk-ant-api03-FAKE000000000000000000'
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' } },
  required: ['ok']
}
const GOOD = '{"ok":true}'
const BAD = 'not json'
const DOMAIN_MISS: ValidationProblem = {
  code: 'brand_in_prompt',
  message: 'A prompt names the brand.'
}

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('completeStructured retries', () => {
  test.each([
    {
      name: 'a schema miss, then domain misses',
      replies: [BAD, GOOD, GOOD, GOOD, GOOD],
      requests: 3,
      code: 'brand_in_prompt'
    },
    {
      name: 'domain misses, then schema misses',
      replies: [GOOD, BAD, BAD, BAD, BAD],
      requests: 3,
      code: 'schema_validation'
    },
    {
      name: 'only domain misses',
      replies: [GOOD, GOOD, GOOD, GOOD, GOOD],
      requests: 2,
      code: 'brand_in_prompt'
    },
    {
      name: 'only schema misses (the provider owns schema retries)',
      replies: [BAD, BAD, BAD, BAD, BAD],
      requests: 2,
      code: 'schema_validation'
    }
  ])('$name sends at most three model requests', async ({ replies, requests, code }) => {
    const transport = scriptedMessages(replies.map((text) => ({ text })))
    const db = projectDb()
    await expect(run(db, anthropic(transport), () => DOMAIN_MISS)).rejects.toMatchObject({ code })
    expect(transport.calls).toHaveLength(requests)
    expect(transport.calls.length).toBeLessThanOrEqual(MODEL_REQUESTS_PER_GENERATION)
  })

  test('a domain miss is retried once and the fixed reply is used', async () => {
    const transport = scriptedMessages([{ text: GOOD }, { text: '{"ok":false}' }])
    const db = projectDb()
    const result = await run(db, anthropic(transport), (value) =>
      (value as { ok: boolean }).ok ? DOMAIN_MISS : null
    )
    expect(result.value).toEqual({ ok: false })
    expect(transport.calls).toHaveLength(2)
    expect(transport.calls[1]?.body).toContain('failed validation: A prompt names the brand.')
    expect(listGenerations(db, 'page-1').map((row) => row.ok)).toEqual([false, true])
  })

  test('records the summed usage when the provider throws after a schema retry', async () => {
    const transport = scriptedMessages([
      { text: BAD, input: 3, output: 2 },
      { text: BAD, input: 4, output: 5 }
    ])
    const db = projectDb()
    await expect(run(db, anthropic(transport), () => null)).rejects.toMatchObject({
      code: 'schema_validation'
    })
    const rows = listGenerations(db, 'page-1')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.ok).toBe(false)
    expect(rows[0]?.usage).toMatchObject({ inputTokens: 7, outputTokens: 7 })
  })

  test('records every attempt, including the one inside the provider', async () => {
    const transport = scriptedMessages([
      { text: BAD, input: 3, output: 2 },
      { text: GOOD, input: 4, output: 5 },
      { text: GOOD, input: 6, output: 1 }
    ])
    const db = projectDb()
    await expect(run(db, anthropic(transport), () => DOMAIN_MISS)).rejects.toMatchObject({
      code: 'brand_in_prompt'
    })
    const usage = listGenerations(db, 'page-1').map((row) => [
      row.usage.inputTokens,
      row.usage.outputTokens
    ])
    expect(usage.sort()).toEqual([
      [6, 1],
      [7, 7]
    ])
  })

  test('records the usage of a reply cut off at max_tokens', async () => {
    const transport = scriptedMessages([
      { text: '{"ok":', input: 10, output: 8000, stop: 'max_tokens' }
    ])
    const db = projectDb()
    await expect(run(db, anthropic(transport), () => null)).rejects.toMatchObject({
      code: 'fetch_failed'
    })
    expect(transport.calls).toHaveLength(1)
    expect(listGenerations(db, 'page-1')[0]?.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 8000
    })
  })

  test('records usage a Claude Code failure carries', async () => {
    const usage = emptyClaudeCliUsage()
    usage.inputTokens = 40
    usage.outputTokens = 9
    usage.cacheReadInputTokens = 2
    const provider: ClaudeProvider = {
      id: 'claude-code',
      async complete() {
        throw new ClaudeCodeCallError(
          'Claude Code reply failed validation',
          { code: 'validation', state: 'warning', nextStep: 'Check again.' },
          usage
        )
      }
    }
    const db = projectDb()
    await expect(run(db, provider, () => null)).rejects.toMatchObject({
      code: 'schema_validation'
    })
    expect(listGenerations(db, 'page-1')[0]?.usage).toMatchObject({
      inputTokens: 40,
      outputTokens: 9,
      cacheReadTokens: 2
    })
  })

  test('a provider that does not report attempts counts one request per call', async () => {
    let calls = 0
    const provider: ClaudeProvider = {
      id: 'claude-code',
      async complete(request) {
        calls += 1
        expect(request.schemaAttempts).toBeGreaterThanOrEqual(1)
        return {
          provider: 'claude-code',
          text: GOOD,
          json: { ok: true },
          inputTokens: 1,
          outputTokens: 1,
          durationMs: 1,
          model: 'claude-sonnet',
          resolvedModel: null,
          usage: emptyClaudeCliUsage()
        }
      }
    }
    await expect(run(projectDb(), provider, () => DOMAIN_MISS)).rejects.toMatchObject({
      code: 'brand_in_prompt'
    })
    expect(calls).toBe(2)
  })
})

describe('completeStructured web search (prompt audit P0 item 8)', () => {
  type Request = Parameters<ClaudeProvider['complete']>[0]
  function capturing(): { provider: ClaudeProvider; requests: Request[] } {
    const requests: Request[] = []
    const provider: ClaudeProvider = {
      id: 'claude-code',
      async complete(request) {
        requests.push(request)
        return {
          provider: 'claude-code',
          text: GOOD,
          json: { ok: true },
          inputTokens: 1,
          outputTokens: 1,
          durationMs: 1,
          model: 'claude-sonnet',
          resolvedModel: null,
          usage: emptyClaudeCliUsage()
        }
      }
    }
    return { provider, requests }
  }

  test('webSearch: true is forwarded to the provider request', async () => {
    const { provider, requests } = capturing()
    await run(projectDb(), provider, () => null, { webSearch: true })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.webSearch).toBe(true)
  })

  test('left out or false, the request carries no webSearch flag', async () => {
    const off = capturing()
    await run(projectDb(), off.provider, () => null)
    expect(off.requests[0]).not.toHaveProperty('webSearch')
    const no = capturing()
    await run(projectDb(), no.provider, () => null, { webSearch: false })
    expect(no.requests[0]).not.toHaveProperty('webSearch')
  })
})

function run(
  db: SqliteDatabase,
  provider: ClaudeProvider,
  validate: (value: unknown) => ValidationProblem | null,
  extra: { webSearch?: boolean } = {}
): ReturnType<typeof completeStructured> {
  return completeStructured({
    ...extra,
    db,
    pageId: 'page-1',
    provider,
    logger: createLogger({ write: () => undefined }),
    kind: 'buyer_profile',
    templateId: 'tpl-buyer-profile',
    templateHash: 'a'.repeat(64),
    prompt: 'Reply with JSON.',
    schema: SCHEMA,
    inputHash: 'b'.repeat(64),
    validate,
    now: () => NOW
  })
}

interface ScriptedReply {
  text: string
  input?: number
  output?: number
  stop?: string
}

function scriptedMessages(replies: readonly ScriptedReply[]): HttpTransport & {
  calls: HttpRequest[]
} {
  const calls: HttpRequest[] = []
  return {
    calls,
    async request(request) {
      calls.push(request)
      const reply = replies[calls.length - 1] ?? replies[replies.length - 1]
      return {
        status: 200,
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: reply?.text ?? '' }],
          stop_reason: reply?.stop ?? 'end_turn',
          usage: { input_tokens: reply?.input ?? 1, output_tokens: reply?.output ?? 1 }
        })
      }
    }
  }
}

function anthropic(transport: HttpTransport): ClaudeProvider {
  const store = new MemorySecretStore()
  store.set(REF, KEY)
  return createAnthropicApiProvider({
    secretStore: store,
    keychainRef: REF,
    transport,
    logger: createLogger({ write: () => undefined }),
    clock: () => 0
  })
}

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  databases.push(db)
  ensureProjectSchema(db)
  insertPage(db, {
    id: 'page-1',
    projectId: 'proj-1',
    url: 'https://textbolt.com/alerts',
    title: null,
    label: null,
    folder: null,
    status: 'not_tracked',
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: null,
    pinned: false,
    score: null,
    promptSetVersion: null
  })
  return db
}
