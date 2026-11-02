// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { textboltCatalog } from '../mocks/m2/catalog'
import { memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockPlaygroundClient } from '../playground/client'
import type { ShellClient } from '../projects/client'
import { createMockShellClient } from '../projects/mockClient'
import { createMockTemplatesClient } from '../templates/client'
import { AppShell } from './AppShell'
import { pageHash, parseHash, projectHash, sectionHash, unavailableHash } from './routes'

const EVENTS = new Set<string>(IPC_EVENT_CHANNELS)

// The page tabs read results through the preload bridge; a bridge whose calls never settle
// keeps them loading, so the test sees the shell's own part of the route.
beforeEach(() => {
  vi.stubGlobal(
    'citefox',
    new Proxy(
      {},
      {
        // Event subscriptions return their unsubscribe; invokes stay pending.
        get: (_target, key) =>
          EVENTS.has(String(key))
            ? () => () => undefined
            : () => new Promise<never>(() => undefined)
      }
    )
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '#/')
})

function shellClient(): ShellClient {
  return createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore('textbolt'),
    initialFinished: true
  })
}

function renderAt(client: ShellClient, hash: string): ReturnType<typeof render> {
  window.history.replaceState(null, '', hash)
  return render(
    <AppShell
      location={parseHash(hash)}
      bridgeError={null}
      client={client}
      templatesClient={createMockTemplatesClient()}
      playgroundClient={createMockPlaygroundClient()}
    />
  )
}

describe('project routes (#/p/<projectId>/…)', () => {
  it('switches to the named project and opens the page in one step', async () => {
    const client = shellClient()
    const switchProject = vi.spyOn(client, 'switchProject')
    const view = renderAt(client, projectHash('acme', pageHash('acme-page-1', 'results')))
    await waitFor(() => expect(switchProject).toHaveBeenCalledWith({ projectId: 'acme' }))
    await waitFor(() => expect(window.location.hash).toBe(pageHash('acme-page-1', 'results')))
    const switcher = await view.findByRole('button', { name: /^Switch project, Acme Clinics/ })
    expect(switcher).toBeTruthy()
    expect((await view.findAllByText(/Acme Clinics \w+ page 1/)).length).toBeGreaterThan(0)
    expect(view.queryByText('That page is not in this project.')).toBeNull()
    expect(switchProject).toHaveBeenCalledTimes(1)
  })

  it('does not switch when the route names the open project, and drops the prefix', async () => {
    const client = shellClient()
    const switchProject = vi.spyOn(client, 'switchProject')
    renderAt(client, projectHash('textbolt', sectionHash('status')))
    await waitFor(() => expect(window.location.hash).toBe(sectionHash('status')))
    expect(switchProject).not.toHaveBeenCalled()
  })

  it("keeps the screen's own query values (?view=, ?show=) when it drops the prefix", async () => {
    renderAt(
      shellClient(),
      `${projectHash('acme', pageHash('acme-page-1', 'progress'))}?view=fixes&show=table`
    )
    await waitFor(() =>
      expect(window.location.hash).toBe(
        `${pageHash('acme-page-1', 'progress')}?view=fixes&show=table`
      )
    )
  })

  it('shows "not available to you" when the project cannot be opened', async () => {
    renderAt(shellClient(), projectHash('deleted', pageHash('x', 'results')))
    await waitFor(() => expect(window.location.hash).toBe(unavailableHash('project')))
    // No project id in the URL it lands on.
    expect(window.location.hash).not.toContain('deleted')
  })

  it('renders the plain state for that URL', async () => {
    const view = renderAt(shellClient(), unavailableHash('project'))
    expect(
      await view.findByRole('heading', { level: 1, name: 'Not available to you' })
    ).toBeTruthy()
    expect(view.getByRole('link', { name: 'Go to Projects' }).getAttribute('href')).toBe(
      sectionHash('projects')
    )
  })

  it('lands on Summary, and says so plainly for an unknown address', async () => {
    const view = renderAt(shellClient(), '#/')
    expect(await view.findByRole('heading', { level: 1, name: 'Summary' })).toBeTruthy()
    cleanup()
    const missing = renderAt(shellClient(), '#/no-such-route')
    expect(
      await missing.findByRole('heading', { level: 1, name: 'This page isn’t available' })
    ).toBeTruthy()
  })
})
