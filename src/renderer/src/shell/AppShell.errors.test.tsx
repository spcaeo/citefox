// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { textboltCatalog } from '../mocks/m2/catalog'
import { memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockPlaygroundClient } from '../playground/client'
import type { ShellClient } from '../projects/client'
import { createMockShellClient } from '../projects/mockClient'
import { createMockTemplatesClient } from '../templates/client'
import { AppShell } from './AppShell'
import type { ShellLocation } from './routes'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function baseClient(): ShellClient {
  return createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore('textbolt'),
    initialFinished: true
  })
}

function renderShell(client: ShellClient, location: ShellLocation): ReturnType<typeof render> {
  return render(
    <AppShell
      location={location}
      bridgeError={null}
      client={client}
      templatesClient={createMockTemplatesClient()}
      playgroundClient={createMockPlaygroundClient()}
    />
  )
}

describe('AppShell load failures', () => {
  it('shows the project load error with Try again, not the first-run screens', async () => {
    const base = baseClient()
    let fail = true
    const client: ShellClient = {
      ...base,
      listProjects: () =>
        fail ? Promise.reject(new Error('The database is busy.')) : base.listProjects()
    }
    const view = renderShell(client, { kind: 'section', section: 'pages' })
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('CiteFox could not load your projects.')
    expect(alert.textContent).toContain('The database is busy.')
    const main = (): string => view.container.querySelector('main')?.textContent ?? ''
    expect(main()).not.toContain('No project yet')
    fail = false
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(view.queryByText('CiteFox could not load your projects.')).toBeNull()
    })
    expect(main()).not.toContain('No project yet')
    expect(main()).toContain('textbolt.com')
  })

  it('tells a missing page apart from a failed read', async () => {
    const base = baseClient()
    const missing: ShellClient = {
      ...base,
      getPage: () =>
        Promise.reject(
          new Error(
            "Error invoking remote method 'pages:get': IpcRequestError: pages:get: That page was not found"
          )
        )
    }
    const first = renderShell(missing, { kind: 'page', pageId: 'nope', tab: 'results' })
    expect(await first.findByText('That page is not in this project.')).toBeTruthy()
    expect(first.queryByText('CiteFox could not load this page.')).toBeNull()
    cleanup()

    let fail = true
    const flaky: ShellClient = {
      ...base,
      getPage: (request) =>
        fail ? Promise.reject(new Error('The database is busy.')) : base.getPage(request)
    }
    const view = renderShell(flaky, { kind: 'page', pageId: 'alerts', tab: 'results' })
    expect(await view.findByText('CiteFox could not load this page.')).toBeTruthy()
    expect(view.queryByText('That page is not in this project.')).toBeNull()
    fail = false
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(view.queryByText('CiteFox could not load this page.')).toBeNull()
    })
  })

  it('shows a settings load error with Try again', async () => {
    const base = baseClient()
    let fail = true
    const client: ShellClient = {
      ...base,
      getSettings: () =>
        fail ? Promise.reject(new Error('Settings file is busy.')) : base.getSettings()
    }
    const view = renderShell(client, { kind: 'section', section: 'settings' })
    expect(await view.findByText('CiteFox could not load your settings.')).toBeTruthy()
    expect(view.container.textContent).toContain('Settings file is busy.')
    expect(view.container.textContent).not.toContain('Could not load connections.')
    fail = false
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(view.queryByText('CiteFox could not load your settings.')).toBeNull()
    })
  })
})
