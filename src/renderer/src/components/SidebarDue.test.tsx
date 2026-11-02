// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DueList, DuePage, Market } from '@shared/domain'
import { DrillHost } from '../drill/DrillHost'
import { SidebarDue, type SidebarDueSource } from './SidebarDue'

afterEach(cleanup)

/**
 * Live check 2026-10-21: the sidebar foot read "0 pages due today" while the All pages
 * "Due today" tile showed 1, and the line did not open the due list. It now opens the
 * same list (`schedule:listDue`) in the shared drill drawer, with the same count.
 */
const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

function duePage(pageId: string): DuePage {
  return {
    projectId: 'proj-1',
    pageId,
    label: `Page ${pageId}`,
    title: null,
    url: `https://textbolt.com/${pageId}`,
    marketIds: ['mkt-us'],
    dueAt: '2026-10-21T13:00:00.000Z',
    intervalDays: 14,
    reason: 'scheduled',
    promptIds: null
  }
}

const PROJECT = {
  id: 'proj-1',
  name: 'TextBolt',
  slug: 'textbolt',
  domain: 'textbolt.com',
  dbPath: 'projects/textbolt.sqlite',
  clientName: null,
  status: 'active' as const,
  markets: [US]
}

function source(list: DueList | Error): SidebarDueSource {
  return {
    listDue: () => (list instanceof Error ? Promise.reject(list) : Promise.resolve(list))
  }
}

describe('sidebar pages due today', () => {
  it('opens the due list in the shared drill drawer with the count it shows', async () => {
    const view = render(
      <DrillHost>
        <SidebarDue
          project={PROJECT}
          trayCount={0}
          refreshKey={0}
          source={source({ day: '2026-10-21', pages: [duePage('a')] })}
        />
      </DrillHost>
    )
    const body = within(view.container)
    const opener = await body.findByRole('button', { name: '1 page due today: show them' })
    expect(opener.textContent).toBe('1 page due today')
    fireEvent.click(opener)
    const drawer = await body.findByRole('dialog', { name: /Pages due today/ })
    expect(within(drawer).getByText('Page a')).toBeTruthy()
    expect(drawer.textContent).toContain('US')
  })

  it('keeps the tray count as text while the list cannot be read', async () => {
    const view = render(
      <DrillHost>
        <SidebarDue
          project={PROJECT}
          trayCount={3}
          refreshKey={0}
          source={source(new Error('busy'))}
        />
      </DrillHost>
    )
    await waitFor(() => expect(view.container.textContent).toBe('3 pages due today'))
    expect(within(view.container).queryByRole('button')).toBeNull()
  })
})
