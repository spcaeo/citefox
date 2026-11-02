// @vitest-environment happy-dom
import { useState, type JSX } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PageDetail } from '@shared/ipc'
import { textboltCatalog } from '../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockShellClient } from '../projects/mockClient'
import { createMockTemplatesClient } from '../templates/client'
import { PageTabBody } from './PageTabBody'
import type { PageTabId } from './routes'

let mounts = 0

// Progress stands in for ScoresScreen: it reads the hash once, on mount, like
// `takeFixDraft` does for "Plan as Fix N".
vi.mock('../visibility/ScoresScreen', () => ({
  ScoresScreen: function ScoresStub(): JSX.Element {
    const [seen] = useState(() => {
      mounts += 1
      return window.location.hash
    })
    return <p data-testid="progress">{seen}</p>
  }
}))

// Results whose lazy chunk is still loading: it never resolves.
vi.mock('../m3/ResultsPanel', () => ({
  ResultsPanel: function ResultsStub(): JSX.Element {
    throw new Promise<never>(() => undefined)
  }
}))

afterEach(() => {
  cleanup()
  mounts = 0
  window.location.hash = ''
})

function checkedPage(): PageDetail {
  const page = createProjectMemory(textboltCatalog()).getPage('textbolt', 'alerts')
  return { ...page, score: page.score ?? 70 }
}

describe('PageTabBody', () => {
  it('mounts a fresh Progress after a tab that was still loading, so it reads the new hash', async () => {
    const page = checkedPage()
    const props = {
      client: createMockShellClient({
        catalog: textboltCatalog(),
        activeStore: memoryActiveProjectStore()
      }),
      templatesClient: createMockTemplatesClient(),
      projectId: 'textbolt',
      projectName: 'TextBolt',
      page,
      marketId: page.markets[0]?.id ?? '',
      onChanged: () => undefined
    }
    const view = (tab: PageTabId): JSX.Element => <PageTabBody {...props} tab={tab} />

    window.location.hash = '#/pages/alerts/progress'
    const screen = render(view('progress'))
    expect((await screen.findByTestId('progress')).textContent).toBe('#/pages/alerts/progress')
    expect(mounts).toBe(1)

    // Results suspends; React keeps a reused boundary's old children hidden meanwhile.
    await act(async () => {
      screen.rerender(view('results'))
    })
    window.location.hash = '#/pages/alerts/progress?plan=1&prompts=p1'
    await act(async () => {
      screen.rerender(view('progress'))
    })

    expect(mounts).toBe(2)
    expect(screen.getByTestId('progress').textContent).toBe(
      '#/pages/alerts/progress?plan=1&prompts=p1'
    )
  })
})
