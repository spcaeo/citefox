import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  ASSISTANT_TEMPLATE_KINDS,
  TOPIC_TEMPLATE_KINDS,
  templateKindLifecycle
} from '@shared/domain'
import type { PromptDraft } from '../pipeline/validate'
import type {
  ClaudeCompletion,
  ClaudeCompletionRequest,
  ClaudeProvider
} from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import type { HttpTransport } from '../providers/http'
import { createLogger } from '../logging/logger'
import { templateHash } from '../pipeline/templates'
import {
  textboltGapReply,
  TEXTBOLT_PROFILE,
  TEXTBOLT_PROMPTS_EN,
  TEXTBOLT_URL,
  textboltJinaBody
} from '../pipeline/textbolt-fixture'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import type { SqliteDatabase } from '../storage/database'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { getTemplate } from '../storage/records'
import { createIpcHandlers, type IpcHandlerDeps } from './index'

const directories: string[] = []
const closers: (() => void)[] = []
const ORIGINAL_FETCH = globalThis.fetch
const MARKER = 'Project marker: write for weekend crews.'
const PLAIN_TONE = 'Tone: plain, direct sentences. No marketing language.'
const NO_SETTINGS = { model: null, language: null, promptCount: null, tone: null }

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  for (const close of closers.splice(0)) close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

type Handlers = ReturnType<typeof createIpcHandlers>

interface CallRow {
  source: string
  project_id?: string | null
  template_kind: string | null
  template_id: string | null
  template_hash: string | null
  connection: string
  model: string | null
  tokens_in: number
  tokens_out: number
  ok: number
}

describe('template steps through IPC', () => {
  test('steps, project versions, settings and reset to shipped round trip', async () => {
    const { handlers } = harness()
    const project = await handlers['projects:create'](projectBody())
    const appSteps = await handlers['templates:steps']({})
    expect(appSteps.map((step) => [step.kind, step.status])).toEqual([
      ['buyer_profile', 'shipped'],
      ['buyer_prompts', 'shipped'],
      ['brand_prompts', 'shipped'],
      ['coverage_matrix', 'shipped'],
      ['page_audit', 'shipped'],
      ['coverage_fixes', 'shipped'],
      ['aio_gap', 'shipped'],
      ['answer_shape', 'shipped'],
      ['sentiment_claims_v2', 'shipped'],
      ['sentiment_fact_check', 'shipped'],
      ['video_brief', 'shipped'],
      ['run_summary', 'shipped'],
      // Planned kinds are not written yet; retired kinds are hidden from the run order.
      ...TOPIC_TEMPLATE_KINDS.filter((kind) => templateKindLifecycle(kind) === 'live').map(
        (kind) => [kind, 'shipped']
      ),
      ...ASSISTANT_TEMPLATE_KINDS.map((kind) => [kind, 'shipped'])
    ])

    const saved = await handlers['templates:saveOverride']({
      projectId: project.id,
      kind: 'aio_gap',
      body: 'Gap for {{ page.url }}',
      settings: { model: null, language: 'es', promptCount: 4, tone: 'plain' }
    })
    expect(saved.status).toBe('project')
    expect(saved.override?.version).toBe(1)
    expect(saved.effective.settings).toEqual({
      model: null,
      language: 'es',
      promptCount: null,
      tone: null
    })
    const projectSteps = await handlers['templates:steps']({ projectId: project.id })
    expect(projectSteps.find((step) => step.kind === 'aio_gap')?.status).toBe('project')
    expect((await handlers['templates:steps']({})).find((s) => s.kind === 'aio_gap')?.status).toBe(
      'shipped'
    )
    const reset = await handlers['templates:resetOverride']({
      projectId: project.id,
      kind: 'aio_gap'
    })
    expect(reset.status).toBe('shipped')
    expect(reset.override).toBeNull()
    await expect(
      handlers['templates:resetOverride']({ projectId: project.id, kind: 'aio_gap' })
    ).rejects.toThrow('This project has no version of that step.')

    const created = await handlers['templates:create']({
      kind: 'run_summary',
      name: 'Short summary',
      fromId: 'tpl-run-summary'
    })
    const updated = await handlers['templates:update']({
      id: created.id,
      body: 'Summary for {{ page.url }}',
      settings: { model: 'claude-haiku-5-5', language: 'fr', promptCount: 3, tone: null }
    })
    expect(updated.template.version).toBe(2)
    expect(updated.template.settings).toEqual({
      model: 'claude-haiku-5-5',
      language: 'fr',
      promptCount: null,
      tone: null
    })
    expect((await handlers['templates:get']({ id: created.id })).settings.language).toBe('fr')

    const shipped = await handlers['templates:get']({ id: 'tpl-run-summary' })
    const back = await handlers['templates:resetToShipped']({ id: created.id })
    expect(back.template.version).toBe(3)
    expect(back.template.body).toBe(shipped.body)
    expect(back.template.templateHash).toBe(shipped.templateHash)
    expect(back.template.settings).toEqual(NO_SETTINGS)
    await expect(handlers['templates:resetToShipped']({ id: 'tpl-run-summary' })).rejects.toThrow(
      'read-only'
    )
  })

  test('buyerProfile:generate uses the project version, its model and tone, and logs one call', async () => {
    const claude = scriptedClaude(route)
    const { handlers, storage } = harness({ http: jinaHttp(), claude })
    const project = await handlers['projects:create'](projectBody())
    const page = await handlers['pages:add'](pageBody(project.id))
    await handlers['pages:readStart']({
      projectId: project.id,
      pageId: page.id,
      reader: 'jina',
      suppliedText: null
    })
    const shipped = await handlers['templates:get']({ id: 'tpl-buyer-profile' })
    const body = `${shipped.body}\n${MARKER}`
    const step = await handlers['templates:saveOverride']({
      projectId: project.id,
      kind: 'buyer_profile',
      body,
      settings: { model: 'claude-opus-5-5', language: null, promptCount: null, tone: 'plain' }
    })
    const overrideId = step.override?.id ?? ''
    expect(overrideId.startsWith('ovr-')).toBe(true)

    const profile = await handlers['buyerProfile:generate']({
      projectId: project.id,
      pageId: page.id
    })
    expect(profile.templateId).toBe(overrideId)
    expect(profile.templateName).toBe("This project's version v1")
    expect(profile.templateHash).toBe(templateHash(body))
    expect(claude.requests).toHaveLength(1)
    expect(claude.requests[0]?.model).toBe('claude-opus-5-5')
    expect(claude.requests[0]?.prompt).toContain(MARKER)
    expect(claude.requests[0]?.prompt).toContain(PLAIN_TONE)

    const rows = withProjectDb(storage, project.slug, (db) => callRows(db))
    expect(rows).toEqual([
      {
        source: 'pipeline',
        template_kind: 'buyer_profile',
        template_id: overrideId,
        template_hash: templateHash(body),
        connection: 'claude-code',
        model: 'claude-sonnet',
        tokens_in: 101,
        tokens_out: 55,
        ok: 1
      }
    ])
    expect(callRows(storage.db, true)).toEqual([])
  })

  test('a prompt-count project version writes a new set; the earlier set keeps its hash (FR-26.4)', async () => {
    const claude = scriptedClaude(route)
    const { handlers, storage } = harness({ http: jinaHttp(), claude })
    const { projectId, pageId, slug } = await readyPage(handlers)
    const first = await handlers['prompts:generate']({ projectId, pageId })
    const shipped = await handlers['templates:get']({ id: 'tpl-buyer-prompts' })
    expect(first.prompts).toHaveLength(10)
    expect(first.templateHash).toBe(shipped.templateHash)

    const body = `${shipped.body}\n${MARKER}`
    const step = await handlers['templates:saveOverride']({
      projectId,
      kind: 'buyer_prompts',
      body,
      settings: { model: null, language: null, promptCount: 3, tone: null }
    })
    const second = await handlers['prompts:generate']({ projectId, pageId })
    expect(second.prompts).toHaveLength(3)
    expect(second.templateId).toBe(step.override?.id)
    expect(second.templateHash).toBe(templateHash(body))
    expect(second.version).toBe(2)
    expect(claude.requests.at(-1)?.prompt).toContain(
      'Write exactly 3 prompts, no more and no fewer.'
    )

    const sets = withProjectDb(storage, slug, (db) =>
      db
        .prepare<unknown[], { version: number; template_id: string; template_hash: string }>(
          `SELECT version, template_id, template_hash FROM prompt_sets
           WHERE page_id = ? ORDER BY version`
        )
        .all(pageId)
    )
    expect(sets).toEqual([
      { version: 1, template_id: 'tpl-buyer-prompts', template_hash: shipped.templateHash },
      { version: 2, template_id: step.override?.id, template_hash: templateHash(body) }
    ])
    const history = await handlers['prompts:listSets']({ projectId, pageId })
    expect(history.sets.map((set) => set.templateName)).toEqual([
      "This project's version v1",
      'CiteFox default'
    ])
  })

  test('gaps:generate uses the project version of the coverage matrix step', async () => {
    const claude = scriptedClaude(route)
    const { handlers, storage } = harness({ http: jinaHttp(), claude })
    const { projectId, pageId, slug } = await readyPage(handlers)
    await handlers['prompts:generate']({ projectId, pageId })
    const shipped = await handlers['templates:get']({ id: 'tpl-coverage-matrix' })
    const body = `${shipped.body}\n${MARKER}`
    const step = await handlers['templates:saveOverride']({
      projectId,
      kind: 'coverage_matrix',
      body,
      settings: NO_SETTINGS
    })
    const matrix = await handlers['gaps:generate']({ projectId, pageId })
    expect(matrix.templateId).toBe(step.override?.id)
    expect(matrix.templateHash).toBe(templateHash(body))
    const matrixPrompts = claude.requests.filter((request) =>
      request.prompt.startsWith('Template: coverage_matrix.md')
    )
    expect(matrixPrompts.length).toBeGreaterThan(0)
    expect(matrixPrompts.every((request) => request.prompt.includes(MARKER))).toBe(true)
    const coverageCalls = withProjectDb(storage, slug, (db) =>
      callRows(db).filter((row) => row.template_kind === 'coverage_matrix')
    )
    expect(coverageCalls.map((row) => row.template_id)).toEqual([step.override?.id])
  })

  test('playground:run through the claude seam logs a playground call in app.sqlite', async () => {
    const claude = scriptedClaude(() => ({ ok: true }))
    const { handlers, storage } = harness({
      claude,
      readPlaygroundPage: async (url) => ({
        url,
        title: 'Hello',
        metaDescription: '',
        h1: 'H',
        pageText: 'Body'
      })
    })
    const runs = await handlers['playground:run']({
      url: 'https://example.com/page',
      kind: 'coverage_matrix',
      overrides: null
    })
    expect(runs).toHaveLength(1)
    const shipped = getTemplate(storage.db, 'tpl-coverage-matrix')
    expect(callRows(storage.db, true)).toEqual([
      {
        source: 'playground',
        project_id: null,
        template_kind: 'coverage_matrix',
        template_id: 'tpl-coverage-matrix',
        template_hash: shipped?.hash,
        connection: 'claude-code',
        model: 'claude-sonnet',
        tokens_in: 101,
        tokens_out: 55,
        ok: 1
      }
    ])
    expect(runs[0]?.templateHash).toBe(shipped?.hash)
  })
})

function callRows(db: SqliteDatabase, appTable = false): CallRow[] {
  const projectColumn = appTable ? 'project_id, ' : ''
  return db
    .prepare<unknown[], CallRow>(
      `SELECT source, ${projectColumn}template_kind, template_id, template_hash, connection, model,
         tokens_in, tokens_out, ok
       FROM llm_calls ORDER BY started_at, id`
    )
    .all()
}

function withProjectDb<T>(storage: AppStorage, slug: string, run: (db: SqliteDatabase) => T): T {
  const db = openProjectDatabase(storage.paths.projectsDirectory, slug)
  try {
    return run(db)
  } finally {
    closeProjectDatabase(db)
  }
}

async function readyPage(
  handlers: Handlers
): Promise<{ projectId: string; pageId: string; slug: string }> {
  const project = await handlers['projects:create'](projectBody())
  const page = await handlers['pages:add'](pageBody(project.id))
  await handlers['pages:readStart']({
    projectId: project.id,
    pageId: page.id,
    reader: 'jina',
    suppliedText: null
  })
  await handlers['buyerProfile:generate']({ projectId: project.id, pageId: page.id })
  return { projectId: project.id, pageId: page.id, slug: project.slug }
}

function projectBody(): {
  name: string
  domain: string
  includeSubdomains: boolean
  brandNames: string[]
  competitors: string[]
  clientName: null
  country: string
  language: string
  location: null
  device: 'desktop'
} {
  return {
    name: 'TextBolt',
    domain: 'textbolt.com',
    includeSubdomains: true,
    brandNames: ['TextBolt', 'Text Bolt'],
    competitors: ['Twilio'],
    clientName: null,
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop'
  }
}

function pageBody(projectId: string): {
  projectId: string
  url: string
  markets: []
  intervalDays: 14
  samples: 1
  promptCount: number
} {
  return {
    projectId,
    url: TEXTBOLT_URL,
    markets: [],
    intervalDays: 14,
    samples: 1,
    promptCount: 10
  }
}

/** Prompt replies sized to "Write exactly N prompts.", keeping the three required sources. */
function promptsFor(prompt: string): { prompts: PromptDraft[] } {
  const count = Number(/Write (?:exactly )?(\d+) prompts/.exec(prompt)?.[1] ?? '10')
  const all = TEXTBOLT_PROMPTS_EN.prompts
  if (count >= all.length) return TEXTBOLT_PROMPTS_EN
  const required = ['title_meta_h1', 'trigger_event', 'objection']
  const picked = required
    .map((source) => all.find((item) => item.source === source))
    .filter((item): item is PromptDraft => item !== undefined)
  for (const item of all) {
    if (picked.length >= count) break
    if (!picked.includes(item)) picked.push(item)
  }
  return { prompts: picked.slice(0, count) }
}

function route(prompt: string): unknown {
  const gap = textboltGapReply(prompt)
  if (gap !== null) return gap
  if (prompt.includes('Write six parts')) return TEXTBOLT_PROFILE
  return promptsFor(prompt)
}

function scriptedClaude(
  reply: (prompt: string) => unknown
): ClaudeProvider & { requests: ClaudeCompletionRequest[] } {
  const requests: ClaudeCompletionRequest[] = []
  return {
    id: 'claude-code',
    requests,
    async complete(request): Promise<ClaudeCompletion> {
      requests.push(request)
      const json = reply(request.prompt)
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 11,
        outputTokens: 22,
        durationMs: 8,
        model: 'claude-sonnet',
        resolvedModel: 'claude-sonnet',
        usage: { ...emptyClaudeCliUsage(), inputTokens: 101, outputTokens: 55 }
      }
    }
  }
}

function jinaHttp(): HttpTransport {
  return {
    async request(request) {
      if (request.url.startsWith('https://r.jina.ai/')) {
        return { status: 200, body: textboltJinaBody() }
      }
      return { status: 500, body: '' }
    }
  }
}

function harness(overrides: Partial<IpcHandlerDeps> = {}): {
  handlers: Handlers
  storage: AppStorage
} {
  globalThis.fetch = (() => {
    throw new Error('network')
  }) as typeof fetch
  const directory = mkdtempSync(join(tmpdir(), 'citefox-steps-ipc-'))
  directories.push(directory)
  const storage = openAppStorage(directory)
  closers.push(() => storage.close())
  const registry = new SecretRegistry()
  let clock = Date.parse('2026-10-19T12:00:00.000Z')
  let sequence = 0
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '9.9.9' }),
    storage,
    secrets: new MemorySecretStore(registry),
    logger: createLogger({ write: () => undefined, secrets: () => registry.list() }),
    http: {
      async request() {
        return { status: 500, body: '' }
      }
    },
    claudeCommand: {
      async run() {
        throw new Error('claude cli')
      }
    },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    emitPageReadProgress: () => undefined,
    emitFillProgress: () => undefined,
    knownSecrets: () => registry.list(),
    now: () => {
      const current = new Date(clock)
      clock += 1000
      return current
    },
    createId: () => {
      sequence += 1
      return `id-${sequence}`
    },
    ...overrides
  })
  return { handlers, storage }
}
