import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CiteFoxApi } from '@shared/ipc'
import { textboltCatalog } from '../mocks/m2/catalog'
import { memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockShellClient } from '../projects/mockClient'
import { createPromptSetsClient, createShellPromptSetsClient } from './promptSets'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('question sets client', () => {
  test('the mock shell reports its one saved set as the set in use', async () => {
    const shell = createMockShellClient({
      catalog: textboltCatalog(),
      activeStore: memoryActiveProjectStore()
    })
    const projectId = 'textbolt'
    const pageId = 'alerts'
    const client = createShellPromptSetsClient(shell)
    const list = await client.listSets({ projectId, pageId })
    const view = await shell.listPrompts({ projectId, pageId })
    expect(list.sets).toHaveLength(1)
    expect(list.sets[0]).toMatchObject({ id: view.promptSetId, isActive: true })
    expect((await client.setActive({ projectId, pageId, promptSetId: 'x' })).promptSetId).toBe(
      view.promptSetId
    )
  })

  test('a release build calls the IPC channels even when mock mode is stored', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_CITEFOX_E2E_MOCKS', '')
    const listSets = vi.fn(() => Promise.resolve({ pageId: 'page-1', sets: [] }))
    const api: Partial<CiteFoxApi> = { 'prompts:listSets': listSets }
    vi.stubGlobal('window', { citefox: api })
    const shell = createMockShellClient({
      catalog: textboltCatalog(),
      activeStore: memoryActiveProjectStore()
    })
    await createPromptSetsClient('mock', shell).listSets({ projectId: 'p', pageId: 'page-1' })
    expect(listSets).toHaveBeenCalledWith({ projectId: 'p', pageId: 'page-1' })
  })
})
