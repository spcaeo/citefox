import { afterEach, describe, expect, test } from 'vitest'
import { DEFAULT_TEMPLATE_SETTINGS, type TemplateSettings } from '@shared/domain'
import type { TryTemplateRequest } from '@shared/ipc'
import { cleanupHarness, harness } from '../handlers/test-harness'
import { BUYER_PROFILE_TEMPLATE } from '../pipeline/template-bodies'
import { templateHash } from '../pipeline/templates'
import { TEXTBOLT_PROFILE } from '../pipeline/textbolt-fixture'
import type {
  ClaudeCompletion,
  ClaudeCompletionRequest,
  ClaudeProvider
} from '../providers/claude/claude-code'
import { ClaudeCallError } from '../providers/claude/call-error'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import type { AppStorage } from '../storage/app-storage'
import { addPageMarket, insertPage } from '../storage/pages'
import {
  closeProjectDatabase,
  createProjectDatabase,
  openProjectDatabase
} from '../storage/project-files'
import { insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { AIO_GAP_TEMPLATE, RUN_SUMMARY_TEMPLATE } from './checks/report-templates'
import { seedCheckedProject } from './checks/report-seed.test-helper'
import { NOW, page, PAGE_URL } from './checks/reports.test-helper'

afterEach(cleanupHarness)

const COUNTED = ['generations', 'buyer_profiles', 'prompt_sets', 'coverage_runs', 'analyses']

interface Fake extends ClaudeProvider {
  requests: ClaudeCompletionRequest[]
}

function fake(reply: (request: ClaudeCompletionRequest) => unknown): Fake {
  const requests: ClaudeCompletionRequest[] = []
  return {
    id: 'claude-code',
    requests,
    async complete(request): Promise<ClaudeCompletion> {
      requests.push(request)
      const json = reply(request)
      return {
        provider: 'claude-code',
        text: typeof json === 'string' ? json : JSON.stringify(json),
        json: typeof json === 'string' ? null : json,
        inputTokens: 5,
        outputTokens: 7,
        durationMs: 12,
        model: 'claude-test',
        resolvedModel: 'claude-test',
        usage: { ...emptyClaudeCliUsage(), inputTokens: 50, outputTokens: 70 }
      }
    }
  }
}

function setup(claude: ClaudeProvider): {
  handlers: ReturnType<typeof harness>['handlers']
  storage: AppStorage
} {
  const { handlers, storage } = harness({ claude })
  insertProject(storage.db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  const db = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    seedCheckedProject(db)
  } finally {
    closeProjectDatabase(db)
  }
  return { handlers, storage }
}

function counts(storage: AppStorage): Record<string, number> {
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    const result: Record<string, number> = {}
    for (const table of [...COUNTED, 'llm_calls']) {
      result[table] =
        db.prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0
    }
    return result
  } finally {
    closeProjectDatabase(db)
  }
}

function llmCalls(storage: AppStorage): Record<string, unknown>[] {
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    return db.prepare<unknown[], Record<string, unknown>>(`SELECT * FROM llm_calls`).all()
  } finally {
    closeProjectDatabase(db)
  }
}

function request(
  kind: TryTemplateRequest['kind'],
  body: string,
  settings: TemplateSettings = DEFAULT_TEMPLATE_SETTINGS,
  marketId: string | null = null
): TryTemplateRequest {
  return { projectId: 'proj-1', pageId: 'page-1', marketId, kind, body, settings }
}

describe('templates:try (FR-26.6)', () => {
  test('a buyer profile draft runs once on the saved snapshot, matches, and saves nothing', async () => {
    const claude = fake(() => TEXTBOLT_PROFILE)
    const { handlers, storage } = setup(claude)
    const before = counts(storage)
    const body = `${BUYER_PROFILE_TEMPLATE}\nDraft marker line.`
    const result = await handlers['templates:try'](
      request('buyer_profile', body, {
        model: 'claude-opus-5-5',
        language: null,
        promptCount: 7,
        tone: 'plain'
      })
    )
    expect(result.matched).toBe(true)
    expect(result.problem).toBeNull()
    expect(result.savedNothing).toBe(true)
    expect(result.model).toBe('claude-test')
    expect(result.durationMs).toBe(12)
    expect(result.label.text).toBe('CiteFox AI · on your plan · about 20 s')
    expect(JSON.parse(result.output)).toEqual(TEXTBOLT_PROFILE)
    expect(result.renderedPrompt).toContain(PAGE_URL)
    expect(result.renderedPrompt).toContain('Draft marker line.')
    expect(result.renderedPrompt).toContain('Tone: plain, direct sentences.')
    expect(claude.requests).toHaveLength(1)
    expect(claude.requests[0]?.model).toBe('claude-opus-5-5')
    expect(claude.requests[0]?.schema).toMatchObject({ type: 'object' })
    expect(claude.requests[0]?.prompt).toBe(result.renderedPrompt)
    const after = counts(storage)
    for (const table of COUNTED) expect(after[table]).toBe(before[table])
    expect(after.llm_calls).toBe((before.llm_calls ?? 0) + 1)
    expect(llmCalls(storage)[0]).toMatchObject({
      source: 'pipeline',
      template_kind: 'buyer_profile',
      template_id: 'draft',
      template_hash: templateHash(body),
      assist_id: null,
      ok: 1,
      tokens_in: 50,
      tokens_out: 70
    })
  })

  test('a reply that misses the output fields comes back with the problem', async () => {
    const { handlers, storage } = setup(fake(() => ({ who: 'Office managers.' })))
    const before = counts(storage)
    const result = await handlers['templates:try'](request('buyer_profile', BUYER_PROFILE_TEMPLATE))
    expect(result.matched).toBe(false)
    expect(result.problem).toEqual(expect.any(String))
    expect(JSON.parse(result.output)).toEqual({ who: 'Office managers.' })
    const after = counts(storage)
    for (const table of COUNTED) expect(after[table]).toBe(before[table])
    expect(after.llm_calls).toBe((before.llm_calls ?? 0) + 1)
  })

  test('a reply that is not JSON is shown as text and does not match', async () => {
    const { handlers } = setup(fake(() => 'Here is a profile in prose.'))
    const result = await handlers['templates:try'](request('buyer_profile', BUYER_PROFILE_TEMPLATE))
    expect(result).toMatchObject({
      matched: false,
      problem: 'The reply was not JSON.',
      output: 'Here is a profile in prose.'
    })
  })

  test('a reply the provider rejects for its schema is a result, and the call is still logged', async () => {
    const claude: ClaudeProvider = {
      id: 'claude-code',
      async complete() {
        throw new ClaudeCallError(
          'Claude Code reply failed validation: missing who',
          { code: 'validation', state: 'warning', nextStep: 'Try again.' },
          { ...emptyClaudeCliUsage(), inputTokens: 9, outputTokens: 3 },
          'claude-test'
        )
      }
    }
    const { handlers, storage } = setup(claude)
    const result = await handlers['templates:try'](request('buyer_profile', BUYER_PROFILE_TEMPLATE))
    expect(result.matched).toBe(false)
    expect(result.problem).toContain('failed validation')
    expect(llmCalls(storage)).toEqual([
      expect.objectContaining({ ok: 0, template_id: 'draft', tokens_in: 9 })
    ])
  })

  test('an overview gap draft reads the latest finished check and its first gap prompt', async () => {
    const claude = fake(() => ({
      facts: [
        {
          fact: 'Carrier gateways shut down and email-to-text stops.',
          likelySource: 'https://simpletexting.com/blog/text-employees/'
        }
      ]
    }))
    const { handlers, storage } = setup(claude)
    const before = counts(storage)
    const body = `${AIO_GAP_TEMPLATE.body}\nGap draft marker.`
    const result = await handlers['templates:try'](
      request('aio_gap', body, { ...DEFAULT_TEMPLATE_SETTINGS, language: 'es' }, 'mkt-us')
    )
    expect(result.matched).toBe(true)
    expect(result.renderedPrompt).toContain('What happens when a carrier gateway shuts down?')
    expect(result.renderedPrompt).toContain('Carrier gateways shut down and email-to-text stops.')
    expect(result.renderedPrompt).toContain('Gap draft marker.')
    expect(result.renderedPrompt).toContain('Write every sentence of the output in Spanish (es).')
    expect(claude.requests[0]?.trace).toEqual({
      source: 'pipeline',
      projectId: 'proj-1',
      templateKind: 'aio_gap',
      templateId: 'draft',
      templateHash: templateHash(body),
      assistId: null
    })
    const after = counts(storage)
    for (const table of COUNTED) expect(after[table]).toBe(before[table])
    expect(after.llm_calls).toBe((before.llm_calls ?? 0) + 1)
  })

  test('an overview gap reply that claims a cause does not match', async () => {
    const { handlers } = setup(
      fake(() => ({
        facts: [{ fact: 'The citation was caused by the edit.', likelySource: null }]
      }))
    )
    const result = await handlers['templates:try'](request('aio_gap', AIO_GAP_TEMPLATE.body))
    expect(result).toMatchObject({ matched: false, problem: 'The reply claims a cause.' })
  })

  test('a check summary draft reads the run counts', async () => {
    const claude = fake(() => ({
      headline: 'One overview left the page out.',
      body: 'The check shows one overview and no citation.'
    }))
    const { handlers } = setup(claude)
    const result = await handlers['templates:try'](
      request('run_summary', RUN_SUMMARY_TEMPLATE.body)
    )
    expect(result.matched).toBe(true)
    expect(result.renderedPrompt).toContain(PAGE_URL)
  })

  test('a step without the data it reads says what to do first', async () => {
    const { handlers, storage } = setup(fake(() => ({})))
    await expect(
      handlers['templates:try'](
        request('run_summary', RUN_SUMMARY_TEMPLATE.body, undefined, 'mkt-uk')
      )
    ).rejects.toMatchObject({ nextStep: 'Press Check now in this market first.' })
    await expect(
      handlers['templates:try'](request('aio_gap', '{{ page.nope }}', undefined, 'mkt-us'))
    ).rejects.toThrow(/unknown variable/)
    const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
    try {
      insertPage(db, { ...page(), id: 'page-2', url: `${PAGE_URL}two/`, title: 'Two' })
      addPageMarket(db, { pageId: 'page-2', marketId: 'mkt-us', addedAt: NOW, baselineRunId: null })
    } finally {
      closeProjectDatabase(db)
    }
    await expect(
      handlers['templates:try']({
        ...request('buyer_profile', BUYER_PROFILE_TEMPLATE),
        pageId: 'page-2'
      })
    ).rejects.toMatchObject({ nextStep: 'Read the page first.' })
    await expect(handlers['templates:try'](request('buyer_profile', '   '))).rejects.toThrow(
      /Write the template/
    )
    await expect(
      handlers['templates:try'](
        request('buyer_profile', BUYER_PROFILE_TEMPLATE, undefined, 'mkt-x')
      )
    ).rejects.toThrow(/not on this page/)
    expect(counts(storage).llm_calls).toBe(0)
  })
})
