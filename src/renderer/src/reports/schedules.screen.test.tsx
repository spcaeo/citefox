// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReportScheduleListItem } from '@shared/domain'
import { REPORT_ERROR_MESSAGES, type CiteFoxApi, type ProjectDetail } from '@shared/ipc'
import { createLiveSchedulesClient } from './schedulesClient'
import { createMockSchedulesClient } from './schedulesMock'
import { ReportsScreen } from './ReportsScreen'
import { buildSchedule, emptyDraft } from './scheduleModel'
import { menuItem, openTab } from './schedules.test-helper'

afterEach(() => {
  cleanup()
  window.location.hash = ''
  Reflect.deleteProperty(window, 'citefox')
})

describe('Scheduled reports screen', () => {
  it('previews the email without sample numbers, in dev and production alike', async () => {
    const view = render(
      <ReportsScreen client={createMockSchedulesClient()} timeZone="America/Chicago" />
    )
    fireEvent.click(view.getByRole('button', { name: 'New schedule' }))
    const preview = await view.findByRole('region', { name: 'Email preview' })
    expect(preview.textContent).toContain(
      'The summary is written from the latest check when CiteFox sends this report.'
    )
    expect(preview.textContent).not.toContain('Visibility score 50')
    expect(preview.textContent).not.toContain('TextBolt')
    expect(preview.textContent).not.toContain('**')
  })

  it('shows the schedules the client returns', async () => {
    const view = render(
      <ReportsScreen client={createMockSchedulesClient()} timeZone="America/Chicago" />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getAllByText('TextBolt weekly summary').length).toBeGreaterThan(0)
    })
    expect(body.getByRole('heading', { level: 1, name: 'Reports' })).toBeTruthy()
    expect(body.getAllByText('Acme monthly client report').length).toBeGreaterThan(0)
    expect(body.getAllByText('Lost-citation alert').length).toBeGreaterThan(0)
    expect(
      within(body.getByRole('region', { name: 'Schedules' })).getByText('On change')
    ).toBeTruthy()
    expect(body.getByText('Paused with project')).toBeTruthy()
    expect(body.getByText('Oct 26, 08:00')).toBeTruthy()
    expect(body.getByRole('switch', { name: 'Send TextBolt weekly summary' })).toBeTruthy()
    fireEvent.change(body.getByPlaceholderText('Search name, project or recipient'), {
      target: { value: 'no-such-schedule' }
    })
    expect(body.getByText('No schedules match “no-such-schedule”')).toBeTruthy()
    expect(view.container.textContent).not.toContain('No schedules yet.')
    fireEvent.click(body.getByRole('button', { name: 'Clear search' }))
    expect(body.getAllByText('TextBolt weekly summary').length).toBeGreaterThan(0)
    openTab(body, 'Delivery history')
    fireEvent.click(body.getByRole('button', { name: 'By day' }))
    expect(body.getAllByRole('button', { expanded: true }).length).toBeGreaterThan(0)
    expect(menuItem(body, /^Actions for FieldPro after each check/, 'Retry')).toBeTruthy()
  })

  it('shows the failed delivery and the email-setup link', async () => {
    const view = render(
      <ReportsScreen client={createMockSchedulesClient()} timeZone="America/Chicago" />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getByText(/^Failed Oct 7, \d+:\d\d/)).toBeTruthy()
    })
    expect(body.getAllByRole('link', { name: 'Fix in Email setup' }).length).toBeGreaterThan(0)
    openTab(body, 'Delivery history')
    expect(menuItem(body, /^Actions for FieldPro after each check/, 'Retry')).toBeTruthy()
  })

  it('renders no mock names when production calls fail', async () => {
    installBridge({
      'reports:list': () =>
        Promise.reject(
          new Error("Error invoking remote method 'reports:list': Error: The engine is busy.")
        ),
      'deliveries:list': () =>
        Promise.reject(
          new Error("Error invoking remote method 'deliveries:list': Error: The engine is busy.")
        )
    })
    const view = render(
      <ReportsScreen client={createLiveSchedulesClient()} timeZone="America/Toronto" />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getByRole('alert').textContent).toContain('The engine is busy.')
    })
    expect(body.getByText('Could not load your scheduled reports.')).toBeTruthy()
    expect(body.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(view.container.textContent).not.toContain('No schedules yet.')
    openTab(body, 'Delivery history')
    expect(view.container.textContent).not.toContain('No deliveries yet.')
    expect(view.container.textContent).not.toContain('match this filter')
    expect(view.container.textContent).not.toContain('Clear search')
    fireEvent.click(body.getByRole('button', { name: 'New schedule' }))
    expect(view.container.textContent).toContain('No markets yet.')
    expect(view.container.textContent).toContain('Default sender')
    expectNoMockNames(view.container.textContent ?? '')
    expect(view.container.textContent).not.toContain('Error invoking remote method')
    expect(view.container.textContent).not.toContain('Built from the Oct 19')
  })

  it('loads again on Try again and asks for a project when there is none', async () => {
    let lists = 0
    installBridge({
      'reports:list': () => {
        lists += 1
        return lists === 1 ? Promise.reject(new Error('The engine is busy.')) : Promise.resolve([])
      },
      'deliveries:list': () => Promise.resolve([]),
      'email:getSettings': () => Promise.resolve({ mode: 'smtp', accounts: [] })
    })
    const view = render(
      <ReportsScreen client={createLiveSchedulesClient()} timeZone="America/Toronto" />
    )
    const body = within(view.container)
    expect(await body.findByText('Create a project first.')).toBeTruthy()
    expect(body.getByRole('link', { name: 'New project' }).getAttribute('href')).toBe(
      '#/projects/new'
    )
    fireEvent.click(await body.findByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(view.container.textContent).toContain('No schedules yet.')
    })
    expect(body.queryByRole('alert')).toBeNull()
    expect(lists).toBe(2)
  })

  it('says when the email accounts cannot be loaded', async () => {
    installBridge({
      'reports:list': () => Promise.resolve([]),
      'deliveries:list': () => Promise.resolve([])
    })
    const view = render(
      <ReportsScreen client={createLiveSchedulesClient()} timeZone="America/Toronto" />
    )
    const alert = await within(view.container).findByRole('alert')
    expect(alert.textContent).toContain('Could not load your email accounts.')
    expect(view.container.textContent).toContain('No schedules yet.')
  })

  it('shows an empty list and a real next send in the user zone', async () => {
    installBridge({
      'reports:list': () => Promise.resolve([harborRow()]),
      'deliveries:list': () => Promise.resolve([]),
      'email:getSettings': () => Promise.resolve({ mode: 'smtp', accounts: [] })
    })
    const view = render(
      <ReportsScreen
        client={createLiveSchedulesClient()}
        timeZone="America/Toronto"
        projects={[harborProject()]}
      />
    )
    await waitFor(() => {
      expect(view.container.textContent).toContain('Harbor weekly')
    })
    expect(view.container.textContent).toContain('Oct 26, 09:00')
    expect(view.container.textContent).toContain('Harbor')
    expect(view.container.textContent).not.toContain('The engine is busy.')
    expectNoMockNames(view.container.textContent ?? '')
  })

  it('shows the catalog empty state when nothing is scheduled and nothing is filtered', async () => {
    installBridge({
      'reports:list': () => Promise.resolve([]),
      'deliveries:list': () => Promise.resolve([]),
      'email:getSettings': () => Promise.resolve({ mode: 'smtp', accounts: [] })
    })
    const view = render(
      <ReportsScreen client={createLiveSchedulesClient()} timeZone="America/Toronto" />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(view.container.textContent).toContain('No schedules yet.')
    })
    expect(view.container.textContent).not.toContain('match this filter')
    expect(view.container.textContent).not.toContain('Clear search')
    openTab(body, 'Delivery history')
    expect(view.container.textContent).toContain('No deliveries yet.')
    expect(view.container.textContent).not.toContain('match this filter')
    expectNoMockNames(view.container.textContent ?? '')
  })

  it('keeps the filtered empty state when schedules exist but search hides them', async () => {
    const view = render(
      <ReportsScreen client={createMockSchedulesClient()} timeZone="America/Chicago" />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getAllByText('TextBolt weekly summary').length).toBeGreaterThan(0)
    })
    expect(view.container.textContent).not.toContain('No schedules yet.')
    fireEvent.change(body.getByPlaceholderText('Search name, project or recipient'), {
      target: { value: 'no-such-schedule' }
    })
    expect(body.getByText('No schedules match “no-such-schedule”')).toBeTruthy()
    expect(body.getAllByRole('button', { name: 'Clear search' }).length).toBeGreaterThan(0)
    expect(view.container.textContent).not.toContain('No schedules yet.')
  })

  it('loads the row into the form and saves that same schedule', async () => {
    const view = render(
      <ReportsScreen client={createMockSchedulesClient()} timeZone="America/Chicago" />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getAllByText('TextBolt weekly summary').length).toBeGreaterThan(0)
    })
    fireEvent.click(menuItem(body, 'Actions for TextBolt weekly summary', 'Edit'))
    const form = body.getByRole('dialog', { name: 'Edit schedule' })
    expect((within(form).getByLabelText('Name') as HTMLInputElement).value).toBe(
      'TextBolt weekly summary'
    )
    fireEvent.click(within(form).getByRole('radio', { name: 'When something changes' }))
    fireEvent.click(
      within(form).getByRole('checkbox', { name: 'A tracked page gained a citation' })
    )
    fireEvent.click(within(form).getByRole('button', { name: 'Save schedule' }))
    await waitFor(() => {
      expect(body.queryByRole('dialog')).toBeNull()
      expect(view.container.textContent).toContain('A tracked page gained a citation')
      expect(body.getAllByText('TextBolt weekly summary').length).toBeGreaterThan(0)
    })
    fireEvent.click(body.getByRole('button', { name: 'New schedule' }))
    expect(body.getByRole('dialog', { name: 'New schedule' })).toBeTruthy()
  })

  it('confirms delete, drops the row, updates the count, and keeps deliveries', async () => {
    const view = render(
      <ReportsScreen client={createMockSchedulesClient()} timeZone="America/Chicago" />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getAllByText('TextBolt weekly summary').length).toBeGreaterThan(0)
    })
    const schedules = body.getByRole('grid', { name: 'Schedules' })
    expect(schedules.querySelectorAll('[data-row]')).toHaveLength(4)
    expect(schedules.getAttribute('aria-rowcount')).toBe('5')

    const actions = 'Actions for TextBolt weekly summary'
    fireEvent.click(menuItem(body, actions, 'Delete'))
    const dialog = body.getByRole('alertdialog', { name: 'Delete this schedule?' })
    expect(dialog.textContent).toContain(
      'TextBolt weekly summary will leave this list. It will not send again. Past deliveries stay in history.'
    )
    await waitFor(() => {
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    })
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Cancel' }), { key: 'Escape' })
    await waitFor(() => {
      expect(body.queryByRole('alertdialog')).toBeNull()
      expect(document.activeElement).toBe(body.getByRole('button', { name: actions }))
    })

    fireEvent.click(menuItem(body, actions, 'Delete'))
    fireEvent.click(within(body.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(body.queryByRole('button', { name: actions })).toBeNull()
      expect(body.getByText('Showing 3 of 3 schedules')).toBeTruthy()
      expect(body.getByText(/3 of 3 on/)).toBeTruthy()
      expect(schedules.querySelectorAll('[data-row]')).toHaveLength(3)
      expect(schedules.getAttribute('aria-rowcount')).toBe('4')
      expect(schedules.contains(document.activeElement)).toBe(true)
    })
    openTab(body, 'Delivery history')
    const history = body.getByRole('grid', { name: 'Delivery history' })
    expect(history.querySelectorAll('[data-row]')).toHaveLength(6)
    expect(within(history).getAllByText('ops@textbolt.com').length).toBeGreaterThan(0)
  })

  it('shows not_found and refreshes the list', async () => {
    let lists = 0
    installBridge({
      'reports:list': () => {
        lists += 1
        return Promise.resolve([harborRow()])
      },
      'deliveries:list': () => Promise.resolve([]),
      'email:getSettings': () => Promise.resolve({ mode: 'smtp', accounts: [] }),
      'reports:delete': () =>
        Promise.resolve({
          channel: 'reports:delete',
          code: 'not_found',
          message: REPORT_ERROR_MESSAGES.not_found
        })
    })
    const view = render(
      <ReportsScreen client={createLiveSchedulesClient()} timeZone="America/Toronto" />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(view.container.textContent).toContain('Harbor weekly')
    })
    const listsAfterLoad = lists
    fireEvent.click(menuItem(body, 'Actions for Harbor weekly', 'Delete'))
    fireEvent.click(within(body.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(body.getByRole('alert').textContent).toContain(REPORT_ERROR_MESSAGES.not_found)
      expect(lists).toBeGreaterThan(listsAfterLoad)
      expect(view.container.textContent).toContain('Harbor weekly')
      expect(document.activeElement).toBe(body.getByRole('alert'))
    })
  })
})

function expectNoMockNames(text: string): void {
  expect(text).not.toContain('TextBolt')
  expect(text).not.toContain('Acme')
  expect(text).not.toContain('FieldPro')
  expect(text).not.toContain('you@textbolt.com')
  expect(text).not.toContain('ops@textbolt.com')
  expect(text).not.toContain('marketing@acmeclinics')
  expect(text).not.toContain('Verizon')
  expect(text).not.toContain('Austin')
}

function harborRow(): ReportScheduleListItem {
  const draft = emptyDraft('America/Chicago')
  draft.name = 'Harbor weekly'
  draft.projectId = 'harbor'
  draft.recipients = ['ada@harbor.example']
  return {
    ...buildSchedule(draft, 'harbor-weekly', '2026-10-01T00:00:00.000Z'),
    nextSendAt: '2026-10-26T13:00:00.000Z'
  }
}

function harborProject(): ProjectDetail {
  return {
    id: 'harbor',
    name: 'Harbor',
    slug: 'harbor',
    domain: 'harbor.example',
    dbPath: 'projects/harbor.sqlite',
    clientName: null,
    status: 'active',
    includeSubdomains: false,
    brandNames: ['Harbor'],
    competitors: [],
    defaultMarket: {
      id: 'ca-en',
      country: 'CA',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    },
    foundPageCount: 0,
    trackedPageCount: 0
  }
}

function installBridge(api: Partial<CiteFoxApi>): void {
  Object.defineProperty(window, 'citefox', {
    configurable: true,
    value: {
      'reports:list': () => Promise.reject(new Error('The engine is busy.')),
      'reports:save': () => Promise.reject(new Error('The engine is busy.')),
      'reports:setStatus': () => Promise.reject(new Error('The engine is busy.')),
      'reports:sendTest': () => Promise.reject(new Error('The engine is busy.')),
      'deliveries:list': () => Promise.reject(new Error('The engine is busy.')),
      'deliveries:resend': () => Promise.reject(new Error('The engine is busy.')),
      'email:getSettings': () => Promise.reject(new Error('The engine is busy.')),
      ...api
    } satisfies Partial<CiteFoxApi>
  })
}
