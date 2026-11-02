// @vitest-environment happy-dom
import type { JSX } from 'react'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AppEmailAccounts, ProjectRecheck } from './homes'
import { accountUsesDrill, duePagesDrill } from './drills'
import { createMockAlertsClient } from './mock'
import type { EmailAccountRow } from './model'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function scheduleScreen(): JSX.Element {
  return (
    <ProjectRecheck
      client={createMockAlertsClient()}
      projectId="textbolt"
      projectName="TextBolt"
      projectSchedules={[
        {
          projectId: 'harbor',
          name: 'Harbor Dental',
          intervalDays: 30,
          time: '06:00',
          paused: false
        }
      ]}
      timeZone="UTC"
      now={new Date('2026-10-20T08:00:00.000Z')}
    />
  )
}

function emailScreen(): JSX.Element {
  return (
    <AppEmailAccounts client={createMockAlertsClient()} activeProjectId="textbolt" timeZone="UTC" />
  )
}

describe('Schedule & alerts drill-downs', () => {
  it('the due count opens exactly the pages due, and a row opens its results by keyboard', async () => {
    const view = render(scheduleScreen())
    const body = within(view.container)
    const due = await body.findByRole('button', { name: /14 pages due at the next check/ })
    const figure = due.querySelector('[data-nfr-figure="due:next"]')
    expect(figure?.textContent).toBe('14')
    expect(due.tagName).toBe('BUTTON')
    fireEvent.click(due)
    const dialog = view.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe(
      'Pages due in TextBolt · 14 pages'
    )
    const rows = within(dialog).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(14)
    fireEvent.keyDown(rows[0] as HTMLElement, { key: 'Enter' })
    expect(window.location.hash).toBe('#/pages/page-1/results')
  })

  it('each project in the cadence note links to its settings', async () => {
    const view = render(scheduleScreen())
    const body = within(view.container)
    const own = await body.findByRole('link', { name: 'Open TextBolt Project settings › Schedule' })
    expect(own.getAttribute('href')).toBe('#/project-settings')
    const other = body.getByRole('link', {
      name: 'Switch to Harbor Dental and open its Project settings › Schedule'
    })
    expect(other.getAttribute('href')).toMatch(/^#\/p\/[^/]+\/project-settings$/)
    expect(other.textContent).toBe('Harbor Dental')
  })
})

describe('Sending account drill-downs', () => {
  it('Used for opens the schedules and projects behind its count', async () => {
    const view = render(emailScreen())
    const body = within(view.container)
    const uses = await body.findByRole('button', { name: /^1 use of reports@textbolt\.com/ })
    expect(uses.querySelector('[data-nfr-figure]')?.textContent).toBe('1')
    fireEvent.click(uses)
    const dialog = view.getByRole('dialog')
    const rows = within(dialog).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent).toContain('Acme Clinics client reports')
    fireEvent.keyDown(rows[0] as HTMLElement, { key: 'Enter' })
    expect(window.location.hash).toBe('#/reports')
  })

  it('a row click or Enter opens that account; Enter on Remove does not edit another row', async () => {
    const view = render(emailScreen())
    const body = within(view.container)
    const grid = await body.findByRole('grid', { name: 'Sending accounts' })
    const sesRow = within(grid)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('reports@textbolt.com'))
    if (!sesRow) throw new Error('no SES row')
    fireEvent.click(within(sesRow).getAllByRole('gridcell')[1] as HTMLElement)
    expect(body.getByText(/Editing .*reports@textbolt\.com/)).toBeTruthy()

    const gmailRow = within(grid)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('you@textbolt.com'))
    if (!gmailRow) throw new Error('no Gmail row')
    fireEvent.keyDown(
      within(gmailRow).getByRole('button', { name: 'Actions for you@textbolt.com' }),
      {
        key: 'Enter'
      }
    )
    expect(body.getByText(/Editing .*reports@textbolt\.com/)).toBeTruthy()
    fireEvent.keyDown(gmailRow, { key: 'Enter' })
    expect(body.getByText(/Editing your default account, Gmail · you@textbolt\.com/)).toBeTruthy()
  })

  it('the last-test badge opens the account at its test with the last result', async () => {
    const view = render(emailScreen())
    const body = within(view.container)
    const badge = await body.findByRole('button', { name: /Last test of reports@textbolt\.com/ })
    fireEvent.click(badge)
    await waitFor(() => expect(document.activeElement?.id).toBe('e-test'))
    expect(body.getByText(/Editing .*reports@textbolt\.com/)).toBeTruthy()
    expect(view.container.querySelector('#e-last-test')?.textContent).toMatch(/Works · Oct 1/)
  })

  it('the remove confirm is the shared ui/Confirm', async () => {
    const view = render(emailScreen())
    const body = within(view.container)
    fireEvent.click(await body.findByRole('button', { name: 'Actions for you@textbolt.com' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Remove Gmail account' }))
    const dialog = body.getByRole('alertdialog', { name: 'Remove this sending account?' })
    expect(dialog.className).toBe('ui-confirm')
  })
})

describe('alerts drill builders', () => {
  const row = {
    id: 'a',
    fromAddress: 'x@y.com',
    isDefault: true
  } as EmailAccountRow

  it('lists schedules and projects with a filter strip that adds up', () => {
    const drill = accountUsesDrill(
      row,
      [
        { projectId: 'p1', label: 'TextBolt' },
        { projectId: null, scheduleId: 's1', label: 'All projects weekly' }
      ],
      'p1'
    )
    expect(drill.items).toHaveLength(2)
    expect(drill.summary?.map((part) => part.group)).toEqual(['project', 'schedule'])
    expect(drill.items[0]?.target).toEqual({ kind: 'hash', hash: '#/project-settings' })
    expect(drill.items[1]?.secondary).toBe('Scheduled report · all projects')
  })

  it('due pages open their results', () => {
    const drill = duePagesDrill(
      {
        day: '2026-10-20',
        pages: [
          {
            projectId: 'p',
            pageId: 'pg',
            label: null,
            title: null,
            url: 'https://a.com/x',
            marketIds: [],
            dueAt: '2026-10-20T09:00:00.000Z',
            intervalDays: 14,
            reason: 'follow_up',
            promptIds: ['1']
          }
        ]
      },
      'P'
    )
    expect(drill.items[0]).toMatchObject({
      primary: 'https://a.com/x',
      target: { kind: 'page', pageId: 'pg', tab: 'results' },
      cells: { why: 'Follow-up after a fix' }
    })
  })
})
