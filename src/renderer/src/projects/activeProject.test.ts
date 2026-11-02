import { describe, expect, test } from 'vitest'
import type { ProjectIdRequest } from '@shared/ipc'
import { textboltCatalog } from '../mocks/m2/catalog'
import { memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockShellClient } from './mockClient'
import { activeDetail, readActiveProject } from './activeProject'

const CREATE = {
  name: 'Northwind',
  domain: 'northwind.example',
  includeSubdomains: true,
  brandNames: ['Northwind'],
  competitors: [],
  clientName: null,
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop' as const
}

describe('active project comes from projects:list', () => {
  test('switch calls projects:switch and the UI reads the new activeProjectId', async () => {
    const store = memoryActiveProjectStore()
    const calls: string[] = []
    const client = createMockShellClient({ activeStore: store, catalog: textboltCatalog() })
    const wrapped = {
      ...client,
      switchProject(request: ProjectIdRequest) {
        calls.push(request.projectId)
        return client.switchProject(request)
      }
    }
    await wrapped.switchProject({ projectId: 'acme' })
    const shown = await readActiveProject(wrapped)
    expect(calls).toEqual(['acme'])
    expect(shown.list.activeProjectId).toBe('acme')
    expect(shown.active?.id).toBe(shown.list.activeProjectId)
    expect(shown.active?.name).toBe('Acme Clinics')

    const reloaded = await readActiveProject(
      createMockShellClient({ activeStore: store, catalog: textboltCatalog() })
    )
    expect(reloaded.list.activeProjectId).toBe('acme')
    expect(reloaded.active?.id).toBe('acme')
  })

  test('create makes the new project active on the next projects:list', async () => {
    const client = createMockShellClient({ catalog: textboltCatalog() })
    const created = await client.createProject(CREATE)
    const shown = await readActiveProject(client)
    expect(shown.list.activeProjectId).toBe(created.id)
    expect(shown.active?.id).toBe(created.id)
    expect(shown.active?.name).toBe('Northwind')
    expect(activeDetail(shown.list, shown.details)?.id).toBe(created.id)
    const remembered = activeDetail({ ...shown.list, activeProjectId: 'textbolt' }, shown.details)
    expect(remembered?.id).toBe('textbolt')
    expect(remembered?.id).not.toBe(created.id)
  })
})
