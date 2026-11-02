// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DueList } from '@shared/domain'
import { CheckNowScreen } from './CheckNowScreen'
import { createMockShellClient } from './mockClient'

afterEach(() => cleanup())

const DUE: DueList = {
  day: '2026-10-20',
  pages: [
    {
      projectId: 'p1',
      pageId: 'page-a',
      label: 'Text alerts',
      title: null,
      url: 'https://example.com/a',
      marketIds: ['us-en'],
      dueAt: '2026-10-20T08:00:00.000Z',
      intervalDays: 14,
      reason: 'scheduled',
      promptIds: null
    },
    {
      projectId: 'p2',
      pageId: 'page-b',
      label: null,
      title: 'Other project page',
      url: 'https://other.example/b',
      marketIds: ['us-en'],
      dueAt: '2026-10-20T08:00:00.000Z',
      intervalDays: 30,
      reason: 'catch_up',
      promptIds: null
    }
  ]
}

describe('Check now', () => {
  it('lists the due pages in a drawer; each page opens its Results, switching project when needed', async () => {
    const view = render(
      <CheckNowScreen
        client={createMockShellClient()}
        pausedProject={false}
        projectId="p1"
        listDue={async () => DUE}
      />
    )
    const open = await view.findByRole('button', {
      name: "Show the due pages (2): the 2 pages on today's due list"
    })
    fireEvent.click(open)
    const dialog = view.getByRole('dialog')
    // Two pages plus the header row.
    expect(within(dialog).getByRole('grid').getAttribute('aria-rowcount')).toBe('3')
    expect(within(dialog).getByRole('link', { name: 'Text alerts' }).getAttribute('href')).toBe(
      '#/pages/page-a/results'
    )
    expect(
      within(dialog).getByRole('link', { name: 'Other project page' }).getAttribute('href')
    ).toBe('#/p/p2/pages/page-b/results')
  })

  it('still shows the queue when nothing is due', async () => {
    const view = render(
      <CheckNowScreen
        client={createMockShellClient()}
        pausedProject={false}
        listDue={async () => ({ day: '2026-10-20', pages: [] })}
      />
    )
    expect(await view.findByText(/pages? due/)).toBeTruthy()
    expect(view.queryByText('Loading the queue…')).toBeNull()
    expect(view.queryByRole('button', { name: /due list/ })).toBeNull()
  })

  it('disables Check now at 0 due, says why and points to choosing pages', async () => {
    const base = createMockShellClient()
    let started = 0
    const client = {
      ...base,
      getQueueStatus: async () => ({ ...(await base.getQueueStatus()), pagesDue: 0 }),
      checkDue: async () => {
        started += 1
        return base.checkDue()
      }
    }
    const view = render(
      <CheckNowScreen
        client={client}
        pausedProject={false}
        listDue={async () => ({ day: '2026-10-20', pages: [] })}
      />
    )
    await view.findByText(/0 pages due/)
    const button = view.getByRole('button', { name: 'Check due pages now' })
    expect(button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true').toBe(
      true
    )
    expect(view.getByText(/Nothing is due right now/)).toBeTruthy()
    const pick = view.getByRole('link', { name: /Choose pages in All pages/ })
    expect(pick.getAttribute('href')).toBe('#/pages')
    fireEvent.click(button)
    expect(started).toBe(0)
    expect(view.queryByText(/Check started for 0 pages/)).toBeNull()
  })
})
