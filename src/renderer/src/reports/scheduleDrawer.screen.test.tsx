// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AlertSettings, AutoExport } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import type { ScopeSource } from '../scope'
import { ReportsScreen } from './ReportsScreen'
import { createMockSchedulesClient } from './schedulesMock'
import { menuItem, openTab } from './schedules.test-helper'
import type { SendsSource } from './sends/useProjectSends'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function project(id: string, name: string): ProjectDetail {
  return {
    id,
    name,
    slug: id,
    domain: `${id}.example`,
    dbPath: `projects/${id}.sqlite`,
    clientName: null,
    status: 'active',
    includeSubdomains: false,
    brandNames: [name],
    competitors: [],
    defaultMarket: null,
    foundPageCount: 0,
    trackedPageCount: 0
  }
}

const PROJECTS = [project('textbolt', 'TextBolt'), project('acme', 'Acme Clinics')]

const scopeSource: ScopeSource = {
  'allpages:list': () =>
    Promise.resolve({
      domain: 'textbolt.example',
      rows: [],
      markets: [],
      defaultMarketId: null,
      searchesLeft: null
    } as never),
  'structure:get': () =>
    Promise.resolve({
      groups: [{ id: 'g-money', name: 'Money pages', pageCount: 3 }],
      clusters: []
    } as never),
  'topics:list': () => Promise.resolve({ topics: [] } as never),
  'grid:listViews': () => Promise.resolve({ views: [] } as never)
}

const ALERTS: AlertSettings = {
  projectId: 'textbolt',
  desktop: true,
  emailAfterCheck: true,
  emailAccountId: null,
  emailTo: ['ops@textbolt.example'],
  slackEnabled: true,
  slackWebhookStored: true,
  monthlyClientPdf: false,
  monthlyPdfTo: null
}

const sendsSource: SendsSource = {
  'alerts:get': (request) => Promise.resolve({ ...ALERTS, projectId: request.projectId }),
  'exports:getAuto': (request) =>
    Promise.resolve({
      projectId: request.projectId,
      pageId: null,
      enabled: true,
      destination: 'folder',
      folder: '/Users/me/CiteFox exports',
      emailTo: null,
      spec: null,
      runs: []
    } as unknown as AutoExport)
}

async function renderScreen(): Promise<{
  body: ReturnType<typeof within>
  client: ReturnType<typeof createMockSchedulesClient>
}> {
  const client = createMockSchedulesClient()
  const view = render(
    <ReportsScreen
      client={client}
      projects={PROJECTS}
      currentProjectId="acme"
      timeZone="Europe/London"
      exportCsv={null}
      scopeSource={scopeSource}
      sendsSource={sendsSource}
    />
  )
  const body = within(view.container)
  await waitFor(() => {
    expect(body.getAllByText('Acme monthly client report').length).toBeGreaterThan(0)
  })
  return { body, client }
}

describe('Schedule drawer', () => {
  it('opens a new schedule on the URL, in the open project, with the preview beside the form', async () => {
    const { body, client } = await renderScreen()
    const save = vi.spyOn(client, 'saveSchedule')
    fireEvent.click(body.getByRole('button', { name: 'New schedule' }))
    const dialog = await body.findByRole('dialog', { name: 'New schedule' })
    expect(window.location.hash).toContain('drawer=schedule')
    expect(window.location.hash).toContain('schedule.id=new')
    const form = within(dialog)
    expect((form.getByLabelText('Project') as HTMLSelectElement).value).toBe('acme')
    expect(form.getByRole('option', { name: 'All my projects (one email each)' })).toBeTruthy()
    expect(dialog.querySelector('aside[aria-label="Email preview"] .rpt-mail')).toBeTruthy()
    expect(dialog.querySelector('.rpt-mail')?.getAttribute('data-theme')).toBe('light')
    expect(form.getByText(/Change or stop this report in CiteFox › Reports/)).toBeTruthy()
    expect((form.getByLabelText('Time zone') as HTMLInputElement).value).toMatch(
      /^Europe\/London · UTC/
    )
    expect(form.getByTestId('sd-next-send').textContent).toMatch(
      /^Next send .*, 08:00 \(Europe\/London\)$/
    )

    // The scope: a group of the project, picked in the form.
    fireEvent.click(await form.findByRole('radio', { name: /A group/ }))
    fireEvent.click(form.getByRole('checkbox', { name: /Money pages/ }))

    fireEvent.change(form.getByLabelText('Name'), { target: { value: 'Money pages weekly' } })
    fireEvent.paste(form.getByLabelText('Recipients'), {
      clipboardData: { getData: () => 'ana@acme.example\nbob@acme.example; nobody' }
    })
    expect(form.getByText(/1 address is not valid: nobody/)).toBeTruthy()
    expect(form.getByRole('button', { name: 'Save schedule' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(form.getByRole('button', { name: 'Remove nobody' }))
    fireEvent.click(form.getByRole('button', { name: 'Save schedule' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      name: 'Money pages weekly',
      projectId: 'acme',
      recipients: ['ana@acme.example', 'bob@acme.example'],
      scope: { kind: 'group', ids: ['g-money'] },
      timeZone: 'Europe/London'
    })
    await waitFor(() => expect(body.queryByRole('dialog', { name: 'New schedule' })).toBeNull())
    expect(body.getAllByText('Money pages weekly').length).toBeGreaterThan(0)
  })

  it('duplicates a schedule from its row menu as "Copy of …"', async () => {
    const { body } = await renderScreen()
    fireEvent.click(menuItem(body, /^Actions for Acme monthly client report/, 'Duplicate'))
    const dialog = await body.findByRole('dialog', { name: 'Duplicate schedule' })
    expect(window.location.hash).toContain('schedule.from=acme')
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Copy of Acme monthly client report'
    )
  })

  it('asks before Send now, lists the recipients, and records the send', async () => {
    const { body, client } = await renderScreen()
    const sendNow = vi.spyOn(client, 'sendNow')
    fireEvent.click(menuItem(body, /^Actions for Acme monthly client report/, 'Send now'))
    const confirm = await within(document.body).findByRole('alertdialog')
    expect(within(confirm).getByText('marketing@acmeclinics.example')).toBeTruthy()
    expect(sendNow).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(sendNow).toHaveBeenCalledWith({ scheduleId: 'acme' }))
    expect((await body.findByTestId('rpt-sendnow-note')).textContent).toMatch(
      /^Sent to 2 recipients/
    )
    openTab(body, 'Delivery history')
    expect(body.getAllByText('Sent now').length).toBeGreaterThan(0)
  })

  it('opens the details from the URL with Send now and Duplicate', async () => {
    window.location.hash = '#/reports?drawer=schedule&schedule.id=acme'
    const { body } = await renderScreen()
    const dialog = await body.findByRole('dialog', { name: 'Acme monthly client report' })
    expect(within(dialog).getByTestId('sd-send-now')).toBeTruthy()
    expect(within(dialog).getAllByRole('button', { name: 'Duplicate' }).length).toBeGreaterThan(0)
    expect(within(dialog).getByText('Whole project')).toBeTruthy()
  })
})

describe('Delivery detail', () => {
  it('opens on the shared drawer from ?delivery=', async () => {
    window.location.hash = '#/reports?view=history&delivery=h4'
    const { body } = await renderScreen()
    const dialog = await body.findByRole('dialog', { name: /FieldPro after each check · / })
    expect(dialog.getAttribute('data-drawer')).toBe('delivery')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Close / }))
    await waitFor(() => expect(window.location.hash).not.toContain('delivery='))
  })
})

describe('All sends', () => {
  it('lists every scheduled report, alert email, Slack message and automatic export', async () => {
    const { body } = await renderScreen()
    openTab(body, 'All sends')
    expect(window.location.hash).toContain('view=sends')
    const grid = await body.findByRole('grid', { name: 'All sends' })
    await waitFor(() => expect(within(grid).getAllByText('Email after each check')).toHaveLength(2))
    expect(within(grid).getAllByText('Slack message')).toHaveLength(2)
    expect(within(grid).getAllByText('Automatic export')).toHaveLength(2)
    expect(within(grid).getAllByText('/Users/me/CiteFox exports').length).toBe(2)
    const link = within(grid).getAllByRole('link', {
      name: /open Alerts & schedules › Notifications/
    })[0]
    expect(link?.getAttribute('href')).toContain('/alerts/notifications')
    expect(body.queryByTestId('rpt-elsewhere')).toBeNull()
  })
})
