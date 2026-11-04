import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { CoverageMatrix } from '@shared/domain'
import type { AddApiKeyRequest } from '@shared/ipc'
import { createIpcHandlers, type IpcHandlerDeps } from './index'
import { createLogger } from '../logging/logger'
import type { ClaudeCompletion, ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import { createFileFixtureSource, readFixtureEnvelope } from '../providers/fixtures'
import type { HttpRequest, HttpTransport } from '../providers/http'
import type { PlaygroundPage } from '../pipeline/playground'
import {
  TEXTBOLT_COVERAGE,
  textboltGapReply,
  TEXTBOLT_H1,
  TEXTBOLT_PROFILE,
  TEXTBOLT_PROMPTS_EN,
  TEXTBOLT_URL,
  textboltJinaBody
} from '../pipeline/textbolt-fixture'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import { listGenerations } from '../storage/content-records'
import { getKeyUsageForMonth } from '../storage/key-usage'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { writeActiveProjectId } from '../storage/records'

const directories: string[] = []
const closers: (() => void)[] = []
const ORIGINAL_FETCH = globalThis.fetch
const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures')
const SERP_SECRET = 'serp-live-key-value-zzzz'

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  for (const close of closers.splice(0)) close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('E5b coverage, gaps, and playground', () => {
  test('coverage:list returns stored runs oldest first and rejects a bad request', async () => {
    const { handlers } = textboltHarness()
    const project = await handlers['projects:create'](projectBody())
    const page = await handlers['pages:add'](pageBody(project.id))
    await expect(
      (handlers['coverage:list'] as (value: unknown) => Promise<unknown>)({ projectId: project.id })
    ).rejects.toThrow('coverage:list: Invalid request')
    expect(await handlers['coverage:list']({ projectId: project.id, pageId: page.id })).toEqual({
      pageId: page.id,
      runs: []
    })

    await readProfileAndPrompts(handlers, project.id, page.id)
    const first = await handlers['gaps:generate']({ projectId: project.id, pageId: page.id })
    await handlers['pages:readStart']({
      projectId: project.id,
      pageId: page.id,
      reader: 'jina',
      suppliedText: null
    })
    const second = await handlers['gaps:generate']({ projectId: project.id, pageId: page.id })
    const listed = await handlers['coverage:list']({ projectId: project.id, pageId: page.id })
    expect(listed.runs.map((run) => run.runId)).toEqual([first.runId, second.runId])
    const older = listed.runs[0]
    const newer = listed.runs[1]
    if (older === undefined || newer === undefined) throw new Error('missing runs')
    expect(older.recordedAt < newer.recordedAt).toBe(true)
    expect(older.contentHash).not.toBe(newer.contentHash)
  })

  test('coverage:get returns one TextBolt matrix and rejects an unknown run', async () => {
    const { handlers } = textboltHarness()
    const { projectId, pageId } = await readyPage(handlers)
    const matrix = await handlers['gaps:generate']({ projectId, pageId })
    const loaded = await handlers['coverage:get']({ projectId, pageId, runId: matrix.runId })
    expect(loaded.runId).toBe(matrix.runId)
    expect(loaded.rows).toHaveLength(10)
    expect(loaded.templateId).toBe('tpl-coverage-matrix')
    expect(loaded.templateUpdatedAt).toBeNull()
    expect(matrixSatisfiesTextBolt(loaded)).toBe(true)
    await expect(
      handlers['coverage:get']({ projectId, pageId, runId: 'missing-run' })
    ).rejects.toThrow('coverage:get: That coverage run is not stored for this page.')
  })

  test('gaps:get returns the latest matrix and rejects a bad request', async () => {
    const { handlers } = textboltHarness()
    const project = await handlers['projects:create'](projectBody())
    const page = await handlers['pages:add'](pageBody(project.id))
    await expect(
      (handlers['gaps:get'] as (value: unknown) => Promise<unknown>)({ projectId: project.id })
    ).rejects.toThrow('gaps:get: Invalid request')
    expect(await handlers['gaps:get']({ projectId: project.id, pageId: page.id })).toBeNull()

    await readProfileAndPrompts(handlers, project.id, page.id)
    const matrix = await handlers['gaps:generate']({ projectId: project.id, pageId: page.id })
    const latest = await handlers['gaps:get']({ projectId: project.id, pageId: page.id })
    expect(latest?.runId).toBe(matrix.runId)
    expect(latest?.stale).toBe(false)
    expect(matrixSatisfiesTextBolt(latest ?? matrix)).toBe(true)

    await handlers['pages:readStart']({
      projectId: project.id,
      pageId: page.id,
      reader: 'jina',
      suppliedText: null
    })
    const stale = await handlers['gaps:get']({ projectId: project.id, pageId: page.id })
    expect(stale?.stale).toBe(true)
    expect(stale?.runId).toBe(matrix.runId)
  })

  test('gaps:generate stores the TextBolt matrix and rejects a bad request', async () => {
    const claude = scriptedClaude((prompt) => route(prompt))
    const { handlers, storage } = textboltHarness(claude)
    const project = await handlers['projects:create'](projectBody())
    await expect(
      (handlers['gaps:generate'] as (value: unknown) => Promise<unknown>)({
        projectId: project.id
      })
    ).rejects.toThrow('gaps:generate: Invalid request')
    const page = await handlers['pages:add'](pageBody(project.id))
    await readProfileAndPrompts(handlers, project.id, page.id)

    const before = claude.calls.length
    const matrix = await handlers['gaps:generate']({ projectId: project.id, pageId: page.id })
    const shipped = await handlers['templates:get']({ id: 'tpl-coverage-matrix' })
    expect(matrix.reused).toBe(false)
    expect(matrix.stale).toBe(false)
    expect(matrix.rows).toHaveLength(10)
    expect(matrix.rows[0]?.coverage).toBe('partial')
    expect(matrix.rows[0]?.actions).toEqual(['update_existing', 'new_faq'])
    expect(matrix.rows[4]?.coverage).toBe('weak')
    expect(matrix.rows[4]?.priority).toBe('high')
    expect(matrix.findings.map((finding) => finding.kind)).toEqual([
      'factual_claim',
      'typo',
      'missing_promised_section'
    ])
    expect(matrix.templateId).toBe('tpl-coverage-matrix')
    expect(matrix.templateName).toBe('CiteFox default')
    expect(matrix.templateHash).toBe(shipped.templateHash)
    expect(matrix.templateUpdatedAt).toBeNull()
    expect(shipped.version).toBe(1)
    expect(matrixSatisfiesTextBolt(matrix)).toBe(true)
    // The matrix (one batch of 10), the page audit, then two fixes calls for the five rows that are not strong.
    expect(claude.calls.length).toBe(before + 4)

    const again = await handlers['gaps:generate']({ projectId: project.id, pageId: page.id })
    expect(again.reused).toBe(true)
    expect(again.runId).toBe(matrix.runId)
    expect(claude.calls.length).toBe(before + 4)

    await handlers['pages:readStart']({
      projectId: project.id,
      pageId: page.id,
      reader: 'jina',
      suppliedText: null
    })
    const created = await handlers['templates:create']({
      kind: 'coverage_matrix',
      name: 'Saturday copy',
      fromId: 'tpl-coverage-matrix'
    })
    const updated = await handlers['templates:update']({
      id: created.id,
      body: `${created.body}\nPrefer the Saturday crew example.\n`
    })
    expect(updated.template.version).toBe(2)
    const fresh = await handlers['gaps:generate']({
      projectId: project.id,
      pageId: page.id,
      templateId: created.id
    })
    expect(fresh.reused).toBe(false)
    expect(fresh.runId).not.toBe(matrix.runId)
    expect(fresh.templateId).toBe(created.id)
    expect(fresh.templateHash).toBe(updated.template.templateHash)
    expect(fresh.templateUpdatedAt).toBe(updated.template.updatedAt)
    expect(fresh.stale).toBe(false)
    const generations = projectGenerations(storage, project.slug, page.id).filter(
      (row) => row.kind === 'coverage_matrix'
    )
    expect(generations.map((row) => row.templateHash)).toEqual([
      shipped.templateHash,
      updated.template.templateHash
    ])
    expect(generations.every((row) => row.usage.serpapiSearches === 0)).toBe(true)
  })

  test('gaps:setDone marks a row and rejects a bad request', async () => {
    const { handlers } = textboltHarness()
    const { projectId, pageId } = await readyPage(handlers)
    const matrix = await handlers['gaps:generate']({ projectId, pageId })
    const promptId = matrix.rows[0]?.promptId
    if (promptId === undefined) throw new Error('missing prompt')
    await expect(
      (handlers['gaps:setDone'] as (value: unknown) => Promise<unknown>)({
        projectId,
        pageId,
        promptId,
        done: 'yes'
      })
    ).rejects.toThrow('gaps:setDone: Invalid request')
    const marked = await handlers['gaps:setDone']({ projectId, pageId, promptId, done: true })
    expect(marked.rows[0]?.done).toBe(true)
    expect(marked.runId).toBe(matrix.runId)
    expect((await handlers['gaps:get']({ projectId, pageId }))?.rows[0]?.done).toBe(true)
  })

  test("gaps:updateDraft keeps Claude's draft for a reset; gaps:setStatus marks rows done", async () => {
    const { handlers } = textboltHarness()
    const { projectId, pageId } = await readyPage(handlers)
    const matrix = await handlers['gaps:generate']({ projectId, pageId })
    const [first, second] = matrix.rows
    if (first === undefined || second === undefined) throw new Error('missing rows')
    expect(await handlers['gaps:getStates']({ projectId, pageId })).toEqual({ pageId, states: [] })

    const edited = await handlers['gaps:updateDraft']({
      projectId,
      pageId,
      promptId: first.promptId,
      question: '  Can my crew get alerts without a developer?  ',
      answer: 'Yes. TextBolt sends a text from any email in two minutes.'
    })
    expect(edited.states).toHaveLength(1)
    expect(edited.states[0]).toMatchObject({
      promptId: first.promptId,
      status: null,
      faq: { question: 'Can my crew get alerts without a developer?', wordCount: 11 }
    })
    // Claude's draft stays on the matrix row.
    const after = await handlers['gaps:get']({ projectId, pageId })
    expect(after?.rows[0]?.suggestedFaq).toEqual(first.suggestedFaq)

    const published = await handlers['gaps:setStatus']({
      projectId,
      pageId,
      promptIds: [first.promptId, second.promptId],
      status: 'published',
      publishedUrl: 'https://textbolt.com/alerts#faq'
    })
    expect(published.states.map((state) => state.status)).toEqual(['published', 'published'])
    const marked = await handlers['gaps:get']({ projectId, pageId })
    expect(marked?.rows.filter((row) => row.done)).toHaveLength(2)

    await handlers['gaps:setStatus']({
      projectId,
      pageId,
      promptIds: [first.promptId],
      status: 'verified'
    })
    const reopened = await handlers['gaps:setStatus']({
      projectId,
      pageId,
      promptIds: [second.promptId],
      status: 'open'
    })
    const byPrompt = new Map(reopened.states.map((state) => [state.promptId, state]))
    expect(byPrompt.get(first.promptId)).toMatchObject({
      status: 'verified',
      publishedUrl: 'https://textbolt.com/alerts#faq'
    })
    expect(byPrompt.get(second.promptId)).toMatchObject({ status: 'open', publishedUrl: null })
    expect((await handlers['gaps:get']({ projectId, pageId }))?.rows[1]?.done).toBe(false)

    const reset = await handlers['gaps:updateDraft']({
      projectId,
      pageId,
      promptId: first.promptId,
      question: '',
      answer: '',
      reset: true
    })
    expect(reset.states.find((state) => state.promptId === first.promptId)?.faq).toBeNull()

    // gaps:setDone hands the status back to the done mark.
    await handlers['gaps:setDone']({ projectId, pageId, promptId: first.promptId, done: false })
    const cleared = await handlers['gaps:getStates']({ projectId, pageId })
    expect(cleared.states.find((state) => state.promptId === first.promptId)).toBeUndefined()

    const loose = handlers['gaps:setStatus'] as (value: unknown) => Promise<unknown>
    await expect(
      loose({ projectId, pageId, promptIds: [first.promptId], status: 'done' })
    ).rejects.toThrow('gaps:setStatus: Invalid request')
    await expect(
      loose({ projectId, pageId, promptIds: ['prompt-nope'], status: 'published' })
    ).rejects.toThrow('That prompt is not in this matrix.')
    await expect(
      (handlers['gaps:updateDraft'] as (value: unknown) => Promise<unknown>)({
        projectId,
        pageId,
        promptId: first.promptId,
        question: '',
        answer: 'x'
      })
    ).rejects.toThrow('gaps:updateDraft: Invalid request')
  })

  test('gaps:redo regenerates one row and reports a template failure as gaps:redo', async () => {
    const claude = scriptedClaude((prompt) => route(prompt))
    const { handlers, storage } = textboltHarness(claude)
    const project = await handlers['projects:create'](projectBody())
    const page = await handlers['pages:add'](pageBody(project.id))
    await expect(
      (handlers['gaps:redo'] as (value: unknown) => Promise<unknown>)({
        projectId: project.id,
        pageId: page.id
      })
    ).rejects.toThrow('gaps:redo: Invalid request')
    await readProfileAndPrompts(handlers, project.id, page.id)
    const matrix = await handlers['gaps:generate']({ projectId: project.id, pageId: page.id })
    const shipped = await handlers['templates:get']({ id: 'tpl-coverage-matrix' })
    const promptId = matrix.rows[0]?.promptId
    if (promptId === undefined) throw new Error('missing prompt')
    await handlers['gaps:setDone']({
      projectId: project.id,
      pageId: page.id,
      promptId,
      done: true
    })
    const before = claude.calls.length
    const redone = await handlers['gaps:redo']({
      projectId: project.id,
      pageId: page.id,
      promptId
    })
    expect(redone.runId).toBe(matrix.runId)
    expect(redone.reused).toBe(false)
    expect(redone.rows[0]?.done).toBe(false)
    expect(redone.rows[0]?.mainGap).toBe('The H1 still never says employees need no new app.')
    expect(redone.findings).toHaveLength(matrix.findings.length)
    expect(redone.templateId).toBe('tpl-coverage-matrix')
    expect(redone.templateName).toBe('CiteFox default')
    expect(redone.templateHash).toBe(shipped.templateHash)
    expect(redone.templateUpdatedAt).toBeNull()
    // The prompt is rated again, then its fix is written again; the audit is not rerun.
    expect(claude.calls.length).toBe(before + 2)
    const coverage = projectGenerations(storage, project.slug, page.id).filter(
      (row) => row.kind === 'coverage_matrix'
    )
    expect(coverage.map((row) => row.templateHash)).toEqual([
      shipped.templateHash,
      shipped.templateHash
    ])

    storage.db
      .prepare(
        `UPDATE templates
         SET is_default = 0, deleted_at = '2026-10-19T00:00:00.000Z'
         WHERE kind = 'coverage_matrix' AND is_default = 1`
      )
      .run()
    await expect(
      handlers['gaps:redo']({ projectId: project.id, pageId: page.id, promptId })
    ).rejects.toMatchObject({
      channel: 'gaps:redo',
      code: 'not_found',
      message: 'gaps:redo: No template has that id.'
    })
    expect(
      (await handlers['gaps:get']({ projectId: project.id, pageId: page.id }))?.rows[0]?.mainGap
    ).toBe('The H1 still never says employees need no new app.')
    expect(
      projectGenerations(storage, project.slug, page.id).filter(
        (row) => row.kind === 'coverage_matrix'
      )
    ).toHaveLength(2)
  })

  test('playground:checkAio checks fixtures on one key and rejects a bad request', async () => {
    const calls: string[] = []
    const { handlers, storage, logs } = harness({ http: serpHttp(calls) })
    const unset = await handlers['playground:checkAio']({
      url: TEXTBOLT_URL,
      prompts: ['How do employees get a text?', ''],
      market: null,
      runId: null
    })
    expect(unset.prompts.map((prompt) => prompt.ok)).toEqual([false, false])
    expect(unset.prompts[0]?.keyId).toBeNull()
    expect(unset.prompts[0]?.message).toMatch(/No default market/)
    expect(unset.prompts[1]?.message).toMatch(/Enter a prompt/)
    expect(calls).toHaveLength(0)

    await handlers['settings:update']({ defaultCountry: 'US', defaultLanguage: 'en' })
    const noKey = await handlers['playground:checkAio']({
      url: TEXTBOLT_URL,
      prompts: ['How do employees get a text?'],
      market: null,
      runId: null
    })
    expect(noKey.prompts[0]).toMatchObject({ ok: false, keyId: null, reason: 'other' })
    expect(noKey.prompts[0]?.message).toMatch(/No search key/)
    expect(calls).toHaveLength(0)

    const project = await handlers['projects:create'](projectBody())
    const added = await handlers['keys:add'](keyRequest(SERP_SECRET))
    const market = {
      country: 'US' as const,
      language: 'en',
      location: null,
      device: 'desktop' as const,
      localWording: false
    }
    const first = TEXTBOLT_PROMPTS_EN.prompts[0]?.text ?? ''
    const verizon = TEXTBOLT_PROMPTS_EN.prompts[4]?.text ?? ''
    const checked = await handlers['playground:checkAio']({
      url: TEXTBOLT_URL,
      prompts: [first, verizon],
      market,
      runId: null
    })
    expect(checked.prompts[0]).toMatchObject({
      ok: true,
      keyId: added.id,
      keyLabel: 'Personal',
      cited: true,
      position: 2,
      reason: null
    })
    expect(checked.prompts[0]?.citedSources[1]).toMatchObject({
      domain: 'textbolt.com',
      position: 2
    })
    expect(checked.prompts[1]).toMatchObject({
      ok: true,
      cited: false,
      position: null,
      summary: null,
      citedSources: []
    })
    expect(calls).toHaveLength(3)
    const urls = calls.map((call) => new URL(call))
    expect(urls.map((url) => url.searchParams.get('api_key'))).toEqual([
      SERP_SECRET,
      SERP_SECRET,
      SERP_SECRET
    ])
    expect(urls[0]?.searchParams.get('engine')).toBe('google')
    expect(urls[0]?.searchParams.get('gl')).toBe('us')
    expect(urls[0]?.searchParams.get('hl')).toBe('en')
    expect(urls[0]?.searchParams.get('no_cache')).toBe('true')
    expect(urls[1]?.searchParams.get('engine')).toBe('google_ai_overview')
    expect(urls[1]?.searchParams.get('page_token')).toBe('fixture-page-token')
    expect(urls[2]?.searchParams.get('q')).toContain('Verizon')
    expect(getKeyUsageForMonth(storage.db, '2026-10')).toMatchObject({
      totals: { searches: 3 },
      keys: [{ keyId: added.id, searches: 3, projects: [{ projectId: project.id, searches: 3 }] }]
    })
    const logged = logs.join('\n')
    expect(logged).not.toContain(SERP_SECRET)
    expect(logged).not.toContain('fixture-page-token')

    const probed = await handlers['keys:test']({ id: added.id })
    expect(probed.reason).not.toBeNull()
    expect(getKeyUsageForMonth(storage.db, '2026-10').totals.searches).toBe(3)

    writeActiveProjectId(storage.db, null)
    await handlers['playground:checkAio']({
      url: TEXTBOLT_URL,
      prompts: [first],
      market,
      runId: null
    })
    await handlers['playground:checkAio']({
      url: TEXTBOLT_URL,
      prompts: [verizon],
      market,
      runId: null
    })
    expect(getKeyUsageForMonth(storage.db, '2026-10')).toMatchObject({
      totals: { searches: 6 },
      keys: [
        {
          keyId: added.id,
          searches: 6,
          projects: [
            { projectId: null, searches: 3 },
            { projectId: project.id, searches: 3 }
          ]
        }
      ]
    })
    const stored = storage.db
      .prepare<unknown[], { project_id: string | null; searches: number }>(
        `SELECT project_id, searches FROM key_usage ORDER BY project_id ASC`
      )
      .all()
    expect(stored).toEqual([
      { project_id: null, searches: 3 },
      { project_id: project.id, searches: 3 }
    ])

    await expect(
      (handlers['playground:checkAio'] as (value: unknown) => Promise<unknown>)({
        url: TEXTBOLT_URL,
        prompts: [],
        market: null,
        runId: null
      })
    ).rejects.toThrow('playground:checkAio: Invalid request')
    expect(getKeyUsageForMonth(storage.db, '2026-10').totals.searches).toBe(6)
    expect(logs.join('\n')).not.toContain(SERP_SECRET)
  })

  test('playground:saveToProject saves written parts and refuses prompts without a profile', async () => {
    const calls: string[] = []
    const page = textboltPage()
    const { handlers, storage } = harness({
      http: serpHttp(calls),
      readPlaygroundPage: async () => page,
      completePlayground: async (prompt) => ({
        text: JSON.stringify(
          prompt.includes('Write six parts') ? TEXTBOLT_PROFILE : TEXTBOLT_PROMPTS_EN
        ),
        resolvedModel: 'claude-sonnet',
        usage: {
          inputTokens: 3,
          outputTokens: 4,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          serpapiSearches: 0
        },
        durationMs: 5
      })
    })
    const project = await handlers['projects:create'](projectBody())
    await handlers['keys:add'](keyRequest(SERP_SECRET))
    const promptsRun = await handlers['playground:run']({
      url: TEXTBOLT_URL,
      kind: 'buyer_prompts',
      overrides: null
    })
    const promptsId = promptsRun[0]?.runId
    if (promptsId === undefined) throw new Error('missing run')
    await expect(
      handlers['playground:saveToProject']({
        runId: promptsId,
        projectId: project.id,
        parts: ['prompts', 'pageRead', 'coverage']
      })
    ).rejects.toMatchObject({
      message: 'playground:saveToProject: This page has no buyer profile.',
      nextStep: 'Generate a buyer profile for that page first.'
    })
    expect(projectCounts(storage, project.slug)).toEqual({
      pages: 0,
      promptSets: 0,
      coverageRuns: 0,
      buyerProfiles: 0
    })
    expect(getKeyUsageForMonth(storage.db, '2026-10').totals.searches).toBe(0)

    const profileRun = await handlers['playground:run']({
      url: TEXTBOLT_URL,
      kind: 'buyer_profile',
      overrides: null
    })
    const profileId = profileRun[0]?.runId
    if (profileId === undefined) throw new Error('missing profile run')
    const savedProfile = await handlers['playground:saveToProject']({
      runId: profileId,
      projectId: project.id,
      parts: ['buyerProfile', 'pageRead']
    })
    expect(savedProfile.parts).toEqual(['pageRead', 'buyerProfile'])

    const savedPrompts = await handlers['playground:saveToProject']({
      runId: promptsId,
      projectId: project.id,
      parts: ['prompts']
    })
    expect(savedPrompts.parts).toEqual(['prompts'])
    expect(savedPrompts.pageId).toBe(savedProfile.pageId)
    expect(savedPrompts.runId).toBe(promptsId)
    const listed = await handlers['prompts:list']({
      projectId: project.id,
      pageId: savedPrompts.pageId
    })
    expect(listed.prompts).toHaveLength(10)
    expect(listed.prompts[0]?.variants).toHaveLength(1)
    expect(listed.prompts[0]?.variants[0]?.text).toBe(TEXTBOLT_PROMPTS_EN.prompts[0]?.text)

    // The combined coverage step is retired (Docs/PROMPT-AUDIT.md, P1): the
    // playground no longer runs it, and a prompts run saves no coverage.
    await expect(
      handlers['playground:run']({ url: TEXTBOLT_URL, kind: 'coverage', overrides: null })
    ).rejects.toThrow('This step was split into new steps')
    const coverageId = promptsId
    const savedCoverage = await handlers['playground:saveToProject']({
      runId: coverageId,
      projectId: project.id,
      parts: ['coverage', 'buyerProfile']
    })
    expect(savedCoverage.parts).toEqual([])
    expect(savedCoverage.pageId).toBe(savedPrompts.pageId)
    expect(
      await handlers['gaps:get']({ projectId: project.id, pageId: savedCoverage.pageId })
    ).toBeNull()

    const checked = await handlers['playground:checkAio']({
      url: TEXTBOLT_URL,
      prompts: [TEXTBOLT_PROMPTS_EN.prompts[0]?.text ?? ''],
      market: {
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false
      },
      runId: coverageId
    })
    expect(checked.prompts[0]?.cited).toBe(true)
    expect(calls).toHaveLength(2)
    const charged = getKeyUsageForMonth(storage.db, '2026-10').totals.searches
    expect(charged).toBe(2)
    const savedCheck = await handlers['playground:saveToProject']({
      runId: coverageId,
      projectId: project.id,
      parts: ['aioChecks']
    })
    expect(savedCheck.parts).toEqual(['aioChecks'])
    expect(savedCheck.runId).toBe(coverageId)
    expect(getKeyUsageForMonth(storage.db, '2026-10').totals.searches).toBe(charged)
    expect(projectGenerations(storage, project.slug, savedPrompts.pageId)).toEqual([])

    await expect(
      handlers['playground:saveToProject']({
        runId: 'missing-run',
        projectId: project.id,
        parts: ['prompts']
      })
    ).rejects.toThrow('playground:saveToProject: Invalid request')
    await expect(
      handlers['playground:saveToProject']({
        runId: promptsId,
        projectId: project.id,
        parts: ['prompts', 'prompts']
      })
    ).rejects.toThrow('playground:saveToProject: Invalid request')
  })
})

function textboltHarness(claude: ClaudeProvider = scriptedClaude((prompt) => route(prompt))): {
  handlers: ReturnType<typeof createIpcHandlers>
  storage: AppStorage
  logs: string[]
} {
  let reads = 0
  return harness({
    claude,
    http: {
      async request(request) {
        if (!request.url.startsWith('https://r.jina.ai/')) return { status: 500, body: '' }
        reads += 1
        if (reads === 1) return { status: 200, body: textboltJinaBody() }
        const parsed = JSON.parse(textboltJinaBody()) as { data: { content: string } }
        parsed.data.content += '\n\nA later sentence about Saturday alerts.'
        return { status: 200, body: JSON.stringify(parsed) }
      }
    }
  })
}

async function readyPage(handlers: ReturnType<typeof createIpcHandlers>): Promise<{
  projectId: string
  pageId: string
  slug: string
}> {
  const project = await handlers['projects:create'](projectBody())
  const page = await handlers['pages:add'](pageBody(project.id))
  await readProfileAndPrompts(handlers, project.id, page.id)
  return { projectId: project.id, pageId: page.id, slug: project.slug }
}

async function readProfileAndPrompts(
  handlers: ReturnType<typeof createIpcHandlers>,
  projectId: string,
  pageId: string
): Promise<void> {
  await handlers['pages:readStart']({
    projectId,
    pageId,
    reader: 'jina',
    suppliedText: null
  })
  await handlers['buyerProfile:generate']({ projectId, pageId })
  await handlers['prompts:generate']({ projectId, pageId })
}

function projectCounts(
  storage: AppStorage,
  slug: string
): { pages: number; promptSets: number; coverageRuns: number; buyerProfiles: number } {
  const db = openProjectDatabase(storage.paths.projectsDirectory, slug)
  try {
    const count = (sql: string): number => {
      const row = db.prepare<unknown[], { n: number }>(sql).get()
      return row?.n ?? 0
    }
    return {
      pages: count('SELECT COUNT(*) AS n FROM pages'),
      promptSets: count('SELECT COUNT(*) AS n FROM prompt_sets'),
      coverageRuns: count('SELECT COUNT(*) AS n FROM coverage_runs'),
      buyerProfiles: count('SELECT COUNT(*) AS n FROM buyer_profiles')
    }
  } finally {
    closeProjectDatabase(db)
  }
}

function matrixSatisfiesTextBolt(matrix: CoverageMatrix): boolean {
  return matrix.rows.every((row, index) => {
    const expected = TEXTBOLT_COVERAGE.rows[index]
    return (
      expected !== undefined &&
      row.coverage === expected.coverage &&
      row.priority === expected.priority &&
      row.whereCovered[0] === expected.whereCovered[0]
    )
  })
}

function textboltPage(): PlaygroundPage {
  const parsed = JSON.parse(textboltJinaBody()) as {
    data: { title: string; description: string; content: string }
  }
  return {
    url: TEXTBOLT_URL,
    title: parsed.data.title,
    metaDescription: parsed.data.description,
    h1: TEXTBOLT_H1,
    pageText: parsed.data.content
  }
}

function serpHttp(calls: string[]): HttpTransport {
  return {
    async request(request: HttpRequest) {
      const url = new URL(request.url)
      if (url.hostname !== 'serpapi.com' || url.pathname !== '/search.json') {
        return { status: 500, body: '' }
      }
      calls.push(request.url)
      const engine = url.searchParams.get('engine')
      const q = url.searchParams.get('q') ?? ''
      const name =
        engine === 'google_ai_overview'
          ? 'serpapi/google-ai-overview.json'
          : q.includes('Verizon')
            ? 'serpapi/google-no-aio.json'
            : 'serpapi/google-page-token.json'
      const recorded = readFixtureEnvelope(createFileFixtureSource(FIXTURES), name)
      return { status: recorded.status, body: JSON.stringify(recorded.body) }
    }
  }
}

function projectGenerations(
  storage: AppStorage,
  slug: string,
  pageId: string
): ReturnType<typeof listGenerations> {
  const db = openProjectDatabase(storage.paths.projectsDirectory, slug)
  try {
    return listGenerations(db, pageId)
  } finally {
    closeProjectDatabase(db)
  }
}

const REDO_GAP = 'The H1 still never says employees need no new app.'

function route(prompt: string): unknown {
  const gap = textboltGapReply(prompt) as { rows?: Record<string, unknown>[] } | null
  // A redo rates one prompt: a matrix call with a single numbered prompt line.
  if (prompt.startsWith('Template: coverage_matrix.md') && gap?.rows?.length === 1) {
    return { rows: gap.rows.map((row) => ({ ...row, mainGap: REDO_GAP })) }
  }
  if (gap !== null) return gap
  if (prompt.includes('Write six parts')) return TEXTBOLT_PROFILE
  return TEXTBOLT_PROMPTS_EN
}

function scriptedClaude(reply: (prompt: string) => unknown): ClaudeProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    id: 'claude-code',
    calls,
    async complete(request): Promise<ClaudeCompletion> {
      calls.push(request.prompt)
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

function keyRequest(secret: string): AddApiKeyRequest {
  return { provider: 'serpapi', name: 'Personal', secret, cap: null, projectIds: [] }
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

function harness(overrides: Partial<IpcHandlerDeps> = {}): {
  handlers: ReturnType<typeof createIpcHandlers>
  storage: AppStorage
  logs: string[]
} {
  globalThis.fetch = (() => {
    throw new Error('network')
  }) as typeof fetch
  const directory = mkdtempSync(join(tmpdir(), 'citefox-e5b-'))
  directories.push(directory)
  const storage = openAppStorage(directory)
  closers.push(() => storage.close())
  const registry = new SecretRegistry()
  const secrets = new MemorySecretStore(registry)
  const logs: string[] = []
  const logger = createLogger({
    write: (_level, line) => {
      logs.push(line)
    },
    secrets: () => registry.list()
  })
  let clock = Date.parse('2026-10-19T12:00:00.000Z')
  let sequence = 0
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '9.9.9' }),
    storage,
    secrets,
    logger,
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
  return { handlers, storage, logs }
}
