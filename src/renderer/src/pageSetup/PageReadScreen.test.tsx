// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
  type RenderResult
} from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PageDetail, PageReadResult } from '@shared/ipc'
import { textboltCatalog } from '../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockAssistClient } from '../assist/client'
import type { ShellClient } from '../projects/client'
import { createMockShellClient } from '../projects/mockClient'
import { resetAutoReads } from './autoRead'
import { PageReadScreen } from './PageReadScreen'

const assistClient = createMockAssistClient()

afterEach(() => {
  cleanup()
  resetAutoReads()
})

function page(pageId: string): PageDetail {
  return createProjectMemory(textboltCatalog()).getPage('textbolt', pageId)
}

function screen(pageId: string): RenderResult {
  return render(
    <PageReadScreen
      assistClient={assistClient}
      client={createMockShellClient({
        catalog: textboltCatalog(),
        activeStore: memoryActiveProjectStore()
      })}
      projectId="textbolt"
      page={page(pageId)}
    />
  )
}

function countingClient(
  getRead: ShellClient['getRead'],
  delayMs: number
): { client: ShellClient; starts: () => number } {
  const base = createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore()
  })
  let starts = 0
  const client: ShellClient = {
    ...base,
    getRead,
    readStart: async (request) => {
      starts += 1
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      return base.readStart(request)
    }
  }
  return { client, starts: () => starts }
}

describe('Page read auto-start', () => {
  it('does not auto-start when a read already exists, and Read again still starts one', async () => {
    const base = createMockShellClient({
      catalog: textboltCatalog(),
      activeStore: memoryActiveProjectStore()
    })
    let starts = 0
    const client: ShellClient = {
      ...base,
      readStart: (request) => {
        starts += 1
        return base.readStart(request)
      }
    }
    const view = render(
      <StrictMode>
        <PageReadScreen
          assistClient={assistClient}
          client={client}
          projectId="textbolt"
          page={page('alerts')}
        />
      </StrictMode>
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getByText(/content fingerprint/).textContent).toContain('7c21…e9')
    })
    expect(starts).toBe(0)
    fireEvent.click(body.getByRole('button', { name: 'Read again' }))
    await waitFor(() => {
      expect(starts).toBe(1)
    })
  })

  it('starts a missing read once under StrictMode and again after a remount joins the same read', async () => {
    const none = async (): Promise<PageReadResult | null> => null
    const first = countingClient(none, 0)
    const strict = render(
      <StrictMode>
        <PageReadScreen
          assistClient={assistClient}
          client={first.client}
          projectId="textbolt"
          page={page('alerts')}
        />
      </StrictMode>
    )
    await waitFor(() => {
      expect(within(strict.container).getByText('7c21…e9')).toBeTruthy()
    })
    expect(first.starts()).toBe(1)
    strict.unmount()

    const held = countingClient(none, 250)
    const running = render(
      <PageReadScreen
        assistClient={assistClient}
        client={held.client}
        projectId="textbolt"
        page={page('alerts')}
      />
    )
    await waitFor(() => {
      expect(held.starts()).toBe(1)
    })
    expect(within(running.container).queryByText('CiteFox has not read this page yet.')).toBeNull()
    running.unmount()
    const joined = render(
      <PageReadScreen
        assistClient={assistClient}
        client={held.client}
        projectId="textbolt"
        page={page('alerts')}
      />
    )
    await waitFor(() => {
      expect(within(joined.container).getByText('7c21…e9')).toBeTruthy()
    })
    expect(held.starts()).toBe(1)
  })
})

describe('Page read fingerprint', () => {
  it('shows the fingerprint line after a successful read', async () => {
    const view = screen('alerts')
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getByText(/content fingerprint/).textContent).toContain('7c21…e9')
    })
    expect(body.getByText(/CiteFox compares this fingerprint/)).toBeTruthy()
  })

  it('hides the fingerprint line when a failed read has a null contentHash', async () => {
    const view = screen('bulk')
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getByText(/could not read this page/)).toBeTruthy()
    })
    expect(body.queryByText(/content fingerprint/)).toBeNull()
    expect(body.queryByText(/CiteFox compares this fingerprint/)).toBeNull()
  })
})
