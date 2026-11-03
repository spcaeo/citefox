// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { textboltCatalog } from '../mocks/m2/catalog'
import { memoryActiveProjectStore } from '../mocks/m2/memory'
import { loadAppInfo, resetAppInfoCache } from '../buildMenu/appInfoStore'
import { createMockPlaygroundClient } from '../playground/client'
import { createMockShellClient } from '../projects/mockClient'
import { createMockTemplatesClient } from '../templates/client'
import { resetUpdateStore } from '../updates/updateStore'
import { AppShell } from './AppShell'
import { parseHash } from './routes'

afterEach(() => {
  cleanup()
  resetAppInfoCache()
  resetUpdateStore()
  localStorage.clear()
  window.history.replaceState(null, '', '#/')
})

describe('the release line on the Start route', () => {
  it('shows under the focus-mode first-run journey, not only inside the shell', async () => {
    await loadAppInfo(() =>
      Promise.resolve({
        name: 'CiteFox',
        version: '0.13.0',
        build: { commit: 'fae9b4e', number: 1424, builtAt: '2026-11-02T13:49:00.000Z' }
      } as never)
    )
    window.history.replaceState(null, '', '#/start')
    const view = render(
      <AppShell
        location={parseHash('#/start')}
        bridgeError={null}
        client={createMockShellClient({
          catalog: textboltCatalog(),
          activeStore: memoryActiveProjectStore('textbolt'),
          initialFinished: true
        })}
        templatesClient={createMockTemplatesClient()}
        playgroundClient={createMockPlaygroundClient()}
      />
    )
    await waitFor(() => {
      expect(view.getByLabelText('Release', { selector: 'footer' }).textContent).toContain(
        'v0.13.0 · build 1424 · Nov 2, 2026 8:49 AM EST'
      )
    })
    // Focus mode: no shell main area around the journey.
    expect(view.container.querySelector('.release-line')?.closest('main')).toBeNull()
  })
})
