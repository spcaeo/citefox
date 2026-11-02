import { afterEach, describe, expect, test } from 'vitest'
import { cleanupHarness } from '../handlers/test-harness'
import { IpcRequestError } from '../ipc-request'
import { recordActivity } from '../storage/activity-events'
import { connectionOf } from '../assist/label'
import { connectionLabel, planProjectClaude, projectClaudeModel, resolveClaude } from './claude'
import { adminHarness, projectRequest } from './project-settings/admin.test-helper'

afterEach(() => {
  cleanupHarness()
})

const CLIENT_KEY = 'sk-ant-client-secret-0001'
const MINE_KEY = 'sk-ant-mine-secret-0002'

function keyHeader(headers: Readonly<Record<string, string>> | undefined): string | undefined {
  return headers?.['x-api-key']
}

async function setup(): Promise<
  ReturnType<typeof adminHarness> & { mine: string; client: string }
> {
  const opened = adminHarness()
  const mine = await opened.handlers['keys:add']({
    provider: 'anthropic',
    name: 'My key',
    secret: MINE_KEY,
    cap: null,
    projectIds: []
  })
  const client = await opened.handlers['keys:add']({
    provider: 'anthropic',
    name: 'Acme Clinics',
    secret: CLIENT_KEY,
    cap: null,
    projectIds: []
  })
  return { ...opened, mine: mine.id, client: client.id }
}

describe('per-project Claude connection (FR-11.7, LLM-5)', () => {
  test('a project on a named API key sends that key and the project model', async () => {
    const opened = await setup()
    const project = await opened.handlers['projects:create'](
      projectRequest('Acme Clinics', 'acme.example', {
        clientName: 'Acme Inc.',
        claude: {
          connection: 'api_key',
          keyId: opened.client,
          fallback: 'ask',
          fallbackKeyId: null,
          model: 'claude-opus-5-5'
        }
      })
    )
    const host = opened.host()
    expect(projectClaudeModel(host, project.id)).toBe('claude-opus-5-5')
    opened.requests.length = 0
    const claude = resolveClaude(host, 'test:call', project.id)
    await claude.complete({ prompt: 'Reply with ok.' })
    const sent = opened.requests.filter((request) => request.url.includes('anthropic.com'))
    expect(sent).toHaveLength(1)
    expect(keyHeader(sent[0]?.headers)).toBe(CLIENT_KEY)
    expect(JSON.parse(sent[0]?.body ?? '{}')).toMatchObject({ model: 'claude-opus-5-5' })
    const rows = opened.storage.db
      .prepare<unknown[], { project_id: string | null; key_id: string | null }>(
        `SELECT project_id, key_id FROM activity_events WHERE kind = 'claude_call'`
      )
      .all()
    expect(rows).toEqual([{ project_id: project.id, key_id: opened.client }])
  })

  test('app_default follows Settings, and the project model falls back to the app model', async () => {
    const opened = await setup()
    const project = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    await opened.handlers['settings:update']({
      claudeModel: 'claude-sonnet-5-5',
      claudeProvider: 'anthropic-api'
    })
    const host = opened.host()
    expect(projectClaudeModel(host, project.id)).toBe('claude-sonnet-5-5')
    const settings = host.settings()
    const plan = planProjectClaude(host.storage, settings, project.id)
    expect(settings.claudeProvider).toBe('anthropic-api')
    expect(plan.connection?.kind).toBe('api-key')
    expect(plan.connection === null ? null : connectionLabel(plan.connection)).toBe(
      'Anthropic API · My key'
    )
    await opened.handlers['settings:update']({ claudeProvider: 'claude-code' })
    const code = planProjectClaude(host.storage, host.settings(), project.id)
    expect(code.connection).toEqual({ kind: 'claude-code' })
  })

  test('Codex in Settings: app_default projects use Codex, a Claude Code project does not', async () => {
    const opened = await setup()
    const follows = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const pinned = await opened.handlers['projects:create'](
      projectRequest('Acme Clinics', 'acme.example', {
        claude: {
          connection: 'claude_code',
          keyId: null,
          fallback: 'wait',
          fallbackKeyId: null,
          model: null
        }
      })
    )
    await opened.handlers['settings:update']({
      claudeProvider: 'codex',
      codexModel: 'gpt-5.6-terra',
      codexQuickModel: 'gpt-5.6-luna'
    })
    const host = opened.host()
    const settings = host.settings()
    expect(settings).toMatchObject({
      claudeProvider: 'codex',
      codexModel: 'gpt-5.6-terra',
      codexQuickModel: 'gpt-5.6-luna'
    })
    const plan = planProjectClaude(host.storage, settings, follows.id)
    expect(plan.connection).toEqual({ kind: 'codex' })
    expect(plan.connection === null ? null : connectionLabel(plan.connection)).toBe('Codex')
    expect(connectionOf(host, follows.id)).toBe('codex')
    expect(connectionOf(host, null)).toBe('codex')
    expect(planProjectClaude(host.storage, settings, pinned.id).connection).toEqual({
      kind: 'claude-code'
    })
    expect(connectionOf(host, pinned.id)).toBe('claude-code')
  })

  test('a removed key is named, and the error points to Project settings', async () => {
    const opened = await setup()
    const project = await opened.handlers['projects:create'](
      projectRequest('Acme Clinics', 'acme.example', {
        claude: {
          connection: 'api_key',
          keyId: opened.client,
          fallback: 'wait',
          fallbackKeyId: null,
          model: null
        }
      })
    )
    await opened.handlers['keys:remove']({ id: opened.client })
    const host = opened.host()
    let caught: unknown = null
    try {
      resolveClaude(host, 'test:call', project.id)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(IpcRequestError)
    expect((caught as Error).message).toContain('Project settings')
  })

  test('switch_key moves a failing project call to the named fallback key', async () => {
    let first = true
    const opened = adminHarness((request) => {
      if (!request.url.includes('anthropic.com')) return null
      if (request.headers?.['x-api-key'] === CLIENT_KEY && first) {
        first = false
        return {
          status: 401,
          body: JSON.stringify({
            type: 'error',
            error: { type: 'authentication_error', message: 'invalid x-api-key' }
          })
        }
      }
      return null
    })
    const mine = await opened.handlers['keys:add']({
      provider: 'anthropic',
      name: 'My key',
      secret: MINE_KEY,
      cap: null,
      projectIds: []
    })
    const client = await opened.handlers['keys:add']({
      provider: 'anthropic',
      name: 'Acme Clinics',
      secret: CLIENT_KEY,
      cap: null,
      projectIds: []
    })
    // The key test on save used the first scripted answer; the next client call fails.
    first = true
    const project = await opened.handlers['projects:create'](
      projectRequest('Acme Clinics', 'acme.example', {
        claude: {
          connection: 'api_key',
          keyId: client.id,
          fallback: 'switch_key',
          fallbackKeyId: mine.id,
          model: null
        }
      })
    )
    opened.requests.length = 0
    const claude = resolveClaude(opened.host(), 'test:call', project.id)
    const reply = await claude.complete({ prompt: 'Reply with ok.' })
    expect(reply.text).toContain('ok')
    const keys = opened.requests
      .filter((request) => request.url.includes('anthropic.com'))
      .map((request) => keyHeader(request.headers))
    expect(keys).toEqual([CLIENT_KEY, MINE_KEY])
    const notice = opened.storage.db
      .prepare<unknown[], { detail: string }>(
        `SELECT detail FROM activity_events WHERE kind = 'claude_fallback'`
      )
      .get()
    expect(notice?.detail).toContain('switched to "My key"')
  })

  test('activity for a missing project is kept with no project', () => {
    const opened = adminHarness()
    recordActivity(opened.storage.db, {
      id: 'act-1',
      at: '2026-10-19T12:00:00.000Z',
      kind: 'claude_call',
      keyId: null,
      projectId: 'gone',
      count: 1,
      detail: null
    })
    const row = opened.storage.db
      .prepare<unknown[], { project_id: string | null }>(`SELECT project_id FROM activity_events`)
      .get()
    expect(row?.project_id).toBeNull()
  })
})
