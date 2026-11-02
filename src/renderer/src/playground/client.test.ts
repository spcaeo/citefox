import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CiteFoxApi, PlaygroundRunResult } from '@shared/ipc'
import { createPlaygroundClient } from './client'

function run(runId: string): PlaygroundRunResult {
  return {
    runId,
    url: 'https://example.com',
    templateId: 'tpl-buyer-profile',
    templateName: 'CiteFox default',
    templateHash: 'a'.repeat(64),
    templateUpdatedAt: null,
    renderedPrompt: 'prompt',
    modelOutput: 'output',
    resolvedModel: 'claude-test',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      serpapiSearches: 0
    },
    durationMs: 1,
    warnings: []
  }
}

function installBridge(api: Partial<CiteFoxApi>): void {
  vi.stubGlobal('window', { citefox: api })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('playground client', () => {
  test('listRuns returns a new array after each run so React re-renders', async () => {
    let next = 0
    installBridge({
      'playground:run': () => {
        next += 1
        return Promise.resolve([run(`run-${next}`)])
      }
    })
    const client = createPlaygroundClient('ipc')
    const before = await client.listRuns()
    await client.run({ url: 'https://example.com', kind: 'buyer_profile', overrides: null })
    const after = await client.listRuns()
    expect(after).not.toBe(before)
    expect(after.map((item) => item.runId)).toEqual(['run-1'])
    expect(before).toEqual([])
    await client.run({ url: 'https://example.com', kind: 'buyer_profile', overrides: null })
    const third = await client.listRuns()
    expect(third).not.toBe(after)
    expect(after.map((item) => item.runId)).toEqual(['run-1'])
    expect(third.map((item) => item.runId)).toEqual(['run-1', 'run-2'])
  })

  test('a release build without the e2e flag never uses the mock, even when asked', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_CITEFOX_E2E_MOCKS', '')
    const listTemplates = vi.fn(() => Promise.resolve([]))
    installBridge({ 'templates:list': listTemplates })
    const client = createPlaygroundClient('mock')
    await client.listTemplates()
    expect(listTemplates).toHaveBeenCalledTimes(1)
  })

  test('the e2e flag allows the mock in a release build', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_CITEFOX_E2E_MOCKS', '1')
    const listTemplates = vi.fn(() => Promise.resolve([]))
    installBridge({ 'templates:list': listTemplates })
    const client = createPlaygroundClient('mock')
    const templates = await client.listTemplates({ kind: 'buyer_profile' })
    expect(listTemplates).not.toHaveBeenCalled()
    expect(templates.length).toBeGreaterThan(0)
  })
})
