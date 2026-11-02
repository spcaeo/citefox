import { beforeEach, describe, expect, test } from 'vitest'
import { PLAYGROUND_MEMORY_RUNS } from '@shared/domain'
import type { PlaygroundRunRequest, PlaygroundRunResult } from '@shared/ipc'
import { resetM2Memory } from './memory'
import {
  checkPlaygroundAio,
  listPlaygroundRuns,
  runPlayground,
  savePlaygroundRun
} from './playground'
import { sha256Hex } from './sha256'
import { createTemplate, getTemplate } from './templates'
import { TEXTBOLT_PROMPTS, TEXTBOLT_URL } from './textbolt'

async function firstRun(request: PlaygroundRunRequest): Promise<PlaygroundRunResult> {
  const [result] = await runPlayground(request)
  if (!result) throw new Error('expected a run')
  return result
}

const promptsRun = {
  url: TEXTBOLT_URL,
  templateId: 'buyer-prompts',
  overrides: null
}

describe('playground memory', () => {
  beforeEach(() => {
    resetM2Memory()
  })

  test('runs the TextBolt buyer prompts and hashes the body that was rendered', async () => {
    const template = await getTemplate({ id: 'buyer-prompts' })
    const result = await firstRun(promptsRun)
    expect(result.runId).toBe('pg-1')
    expect(result.templateId).toBe('buyer-prompts')
    expect(result.templateName).toBe('CiteFox default')
    expect(result.resolvedModel).toBe('claude-sonnet-5-5')
    expect(result.templateUpdatedAt).toBeNull()
    expect(result.templateHash).toBe(await sha256Hex(template.body))
    expect(result.usage.serpapiSearches).toBe(0)
    expect(result.modelOutput.split('\n').filter((line) => line.length > 0)).toHaveLength(10)
    expect(result.modelOutput).toContain(TEXTBOLT_PROMPTS[0])
    expect(result.renderedPrompt).toContain('textbolt.com')
    expect(JSON.stringify(result)).not.toContain('citefox-sample')
  })

  test('warns on an unknown variable and still stores the run', async () => {
    const body = 'See {{ competitor }}.'
    const result = await firstRun({
      ...promptsRun,
      overrides: { body, promptCount: null, brandName: null }
    })
    expect(result.warnings.map((warning) => warning.name)).toEqual(['competitor'])
    expect(result.renderedPrompt).toBe('See .')
    expect(result.templateHash).toBe(await sha256Hex(body))
    expect(listPlaygroundRuns()).toHaveLength(1)
  })

  test('rejects a syntax error without echoing the body or storing a run', async () => {
    const body = 'Hello {{ url'
    await expect(
      runPlayground({
        ...promptsRun,
        overrides: { body, promptCount: null, brandName: null }
      })
    ).rejects.toThrow('playground:run: Nunjucks syntax error')
    try {
      await runPlayground({
        ...promptsRun,
        overrides: { body, promptCount: null, brandName: null }
      })
    } catch (cause) {
      expect(cause instanceof Error ? cause.message : '').not.toContain('Hello')
    }
    expect(listPlaygroundRuns()).toHaveLength(0)
  })

  test('keeps the latest 20 runs', async () => {
    for (let index = 0; index < PLAYGROUND_MEMORY_RUNS + 1; index += 1) {
      await runPlayground({ ...promptsRun, templateId: 'buyer-profile' })
    }
    const runs = listPlaygroundRuns()
    expect(runs).toHaveLength(PLAYGROUND_MEMORY_RUNS)
    expect(runs[0]?.runId).toBe('pg-2')
    expect(runs.at(-1)?.runId).toBe(`pg-${PLAYGROUND_MEMORY_RUNS + 1}`)
  })

  test('checks an AI Overview with cited sources and a key label', async () => {
    const run = await firstRun(promptsRun)
    const aio = await checkPlaygroundAio({
      url: TEXTBOLT_URL,
      prompts: [TEXTBOLT_PROMPTS[0], '   '],
      market: null,
      runId: run.runId
    })
    const cited = aio.prompts[0]
    const blank = aio.prompts[1]
    expect(cited?.ok).toBe(true)
    expect(cited?.cited).toBe(true)
    expect(cited?.position).toBe(2)
    expect(cited?.keyLabel).toBe('Work SerpApi')
    expect(cited?.keyId).toBe('serpapi-work')
    expect(cited?.citedSources.map((source) => [source.position, source.domain])).toEqual([
      [1, 'simpletexting.com'],
      [2, 'textbolt.com'],
      [3, 'twilio.com'],
      [4, 'clicksend.com'],
      [5, 'officeops-journal.com'],
      [6, 'textmagic.com']
    ])
    expect(blank?.ok).toBe(false)
    expect(blank?.keyLabel).toBeNull()
    expect(blank?.message).toBe('Enter a prompt to check. No search was sent.')
    expect(listPlaygroundRuns()[0]?.usage.serpapiSearches).toBe(1)
    const encoded = JSON.stringify(aio)
    expect(encoded).not.toContain('citefox-sample')
    expect(encoded).not.toMatch(/sk-[A-Za-z0-9]/)
  })

  test('writes the intersection of requested parts and what the run produced', async () => {
    const run = await firstRun(promptsRun)
    expect(
      savePlaygroundRun({
        runId: run.runId,
        projectId: 'textbolt',
        parts: ['pageRead', 'buyerProfile', 'prompts']
      })
    ).toEqual({
      projectId: 'textbolt',
      pageId: 'alerts',
      runId: 'pg-1',
      parts: ['pageRead', 'prompts']
    })
    expect(
      savePlaygroundRun({
        runId: run.runId,
        projectId: 'textbolt',
        parts: ['coverage']
      }).parts
    ).toEqual([])
  })

  test('rejects an empty url and an unknown run', async () => {
    await expect(
      runPlayground({ url: '   ', templateId: 'buyer-profile', overrides: null })
    ).rejects.toThrow('playground:run: Invalid request')
    expect(() =>
      savePlaygroundRun({
        runId: 'pg-missing',
        projectId: 'textbolt',
        parts: ['pageRead']
      })
    ).toThrow('playground:saveToProject: Invalid request')
  })

  test('coverage output counts match the matrix rows', async () => {
    const result = await firstRun({ ...promptsRun, templateId: 'coverage' })
    expect(result.modelOutput).toContain('Page-wide findings')
    expect(result.modelOutput.match(/\tStrong\t/g)).toHaveLength(5)
    expect(result.modelOutput.match(/\tPartial\t/g)).toHaveLength(4)
    expect(result.modelOutput.match(/\tWeak\t/g)).toHaveLength(1)
    expect(result.usage.serpapiSearches).toBe(0)
  })

  test('compares two templates of one kind and names each run', async () => {
    const copy = await createTemplate({
      kind: 'buyer_profile',
      name: 'Short buyer',
      fromId: 'buyer-profile'
    })
    const results = await runPlayground({
      url: TEXTBOLT_URL,
      templateIds: ['buyer-profile', copy.id],
      overrides: null
    })
    expect(results.map((item) => [item.templateId, item.templateName])).toEqual([
      ['buyer-profile', 'CiteFox default'],
      [copy.id, 'Short buyer']
    ])
    expect(results[0]?.modelOutput).toContain('Wording from CiteFox default.')
    expect(results[1]?.modelOutput).toContain('Wording from Short buyer.')
    expect(results[0]?.modelOutput).not.toContain('Short buyer')
    expect(results[1]?.modelOutput).not.toContain('Wording from CiteFox default.')
    for (const result of results) {
      expect(result.modelOutput).toContain(result.templateName)
      expect(result.templateName).not.toBe(result.templateId)
    }
    expect(listPlaygroundRuns()).toHaveLength(2)
    const byKind = await firstRun({ url: TEXTBOLT_URL, kind: 'coverage', overrides: null })
    expect(byKind.templateId).toBe('coverage')
    expect(byKind.templateName).toBe('CiteFox default')
    const omitted = await firstRun({
      url: TEXTBOLT_URL,
      templateIds: [],
      kind: 'buyer_prompts',
      overrides: null
    })
    expect(omitted.templateId).toBe('buyer-prompts')
    expect(omitted.templateName).toBe('CiteFox default')
  })

  test('rejects a mixed selection and a compare past the limit', async () => {
    await expect(
      runPlayground({
        url: TEXTBOLT_URL,
        templateId: 'buyer-profile',
        templateIds: ['buyer-prompts'],
        overrides: null
      })
    ).rejects.toThrow('playground:run: Provide templateId or templateIds, not both.')
    await expect(
      runPlayground({
        url: TEXTBOLT_URL,
        templateIds: ['buyer-profile', 'coverage'],
        overrides: null
      })
    ).rejects.toThrow('playground:run: Those templates are not the same kind.')
    await expect(
      runPlayground({
        url: TEXTBOLT_URL,
        templateIds: ['coverage', 'coverage', 'coverage', 'coverage'],
        overrides: null
      })
    ).rejects.toThrow('playground:run: A playground compare accepts at most 3 templates.')
    expect(listPlaygroundRuns()).toHaveLength(0)
  })
})
