// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { textboltCatalog } from '../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore } from '../mocks/m2/memory'
import type { ShellClient } from '../projects/client'
import { createMockShellClient } from '../projects/mockClient'
import { createMockTemplatesClient } from '../templates/client'
import { AudienceScreen } from './AudienceScreen'
import { GapsScreen } from './GapsScreen'
import { PromptsScreen } from './PromptsScreen'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function base(): ShellClient {
  return createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore()
  })
}

const page = createProjectMemory(textboltCatalog()).getPage('textbolt', 'alerts')
const busy = (): Promise<never> => Promise.reject(new Error('The database is busy.'))

describe('page setup load errors', () => {
  it('Buyer profile: replaces the loading line with Try again, then loads', async () => {
    const mock = base()
    let fail = true
    const client: ShellClient = {
      ...mock,
      getBuyerProfile: (request) => (fail ? busy() : mock.getBuyerProfile(request))
    }
    const view = render(
      <AudienceScreen
        client={client}
        templatesClient={createMockTemplatesClient()}
        projectId="textbolt"
        page={page}
      />
    )
    expect(await view.findByText('CiteFox could not load the buyer profile.')).toBeTruthy()
    expect(view.queryByText('Loading the buyer profile…')).toBeNull()
    fail = false
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(view.queryByText('CiteFox could not load the buyer profile.')).toBeNull()
    })
    expect(view.queryByText('Loading the buyer profile…')).toBeNull()
  })

  it('Buyer profile: a missing profile offers to write it, never a manual dead-end', async () => {
    const mock = base()
    const client: ShellClient = { ...mock, getBuyerProfile: () => Promise.resolve(null) }
    const view = render(
      <AudienceScreen
        client={client}
        templatesClient={createMockTemplatesClient()}
        projectId="textbolt"
        page={page}
      />
    )
    expect(await view.findByText('No buyer profile on this page')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Write the buyer profile' })).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Generate buyer profile' })).toBeNull()
    expect(view.queryByText(/before the questions/)).toBeNull()
  })

  it('Prompts: shows Try again in place of the loading line', async () => {
    const mock = base()
    const client: ShellClient = { ...mock, listPrompts: busy }
    const view = render(
      <PromptsScreen
        client={client}
        templatesClient={createMockTemplatesClient()}
        projectId="textbolt"
        page={page}
        marketId="us"
        onChanged={() => undefined}
      />
    )
    expect(await view.findByText("CiteFox could not load this page's questions.")).toBeTruthy()
    expect(view.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(view.queryByText('Loading questions…')).toBeNull()
  })

  it('Content gaps: shows Try again in place of the loading line', async () => {
    const mock = base()
    const client: ShellClient = { ...mock, getGaps: busy }
    const view = render(
      <GapsScreen
        client={client}
        templatesClient={createMockTemplatesClient()}
        projectId="textbolt"
        page={page}
        marketId="us"
      />
    )
    expect(await view.findByText('CiteFox could not load the coverage matrix.')).toBeTruthy()
    expect(view.queryByText('Loading the coverage matrix…')).toBeNull()
  })
})
