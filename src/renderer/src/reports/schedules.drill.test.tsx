// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReportScheduleListItem } from '@shared/domain'
import { ReportsScreen } from './ReportsScreen'
import { sampleSchedules } from './scheduleFixtures'
import { createMockSchedulesClient } from './schedulesMock'
import { upcomingSends } from './schedules/utils/occurrences'
import { nextDrill, recipientsDrill, sectionsDrill } from './schedules/utils/drills'
import { menuItem, openTab } from './schedules.test-helper'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

async function renderScreen(onOpenProject?: (projectId: string) => void): Promise<{
  body: ReturnType<typeof within>
  client: ReturnType<typeof createMockSchedulesClient>
}> {
  const client = createMockSchedulesClient()
  const view = render(
    <ReportsScreen
      client={client}
      timeZone="America/Chicago"
      exportCsv={null}
      onOpenProject={onOpenProject ?? null}
    />
  )
  const body = within(view.container)
  await waitFor(() => {
    expect(body.getAllByText('Acme monthly client report').length).toBeGreaterThan(0)
  })
  return { body, client }
}

function drawerRows(dialog: HTMLElement): Element[] {
  return [...dialog.querySelectorAll('[data-drill-row]')]
}

function schedule(id: string): ReportScheduleListItem {
  const found = sampleSchedules().find((item) => item.id === id)
  if (!found) throw new Error(`no fixture ${id}`)
  return found
}

describe('Scheduled reports drill-downs', () => {
  it('opens the recipients drawer with exactly the addresses in the cell', async () => {
    const { body } = await renderScreen()
    fireEvent.click(
      body.getByRole('button', { name: /: show the 2 recipients of Acme monthly client report$/ })
    )
    const dialog = await body.findByRole('dialog', { name: /Recipients of Acme/ })
    expect(dialog.getAttribute('data-drill')).toBe('schedule:acme:recipients')
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toContain('2 recipients')
    expect(drawerRows(dialog)).toHaveLength(2)
    expect(within(dialog).getByText('marketing@acmeclinics.example')).toBeTruthy()
  })

  it('opens what a schedule sends and its next sends', async () => {
    const { body } = await renderScreen()
    const what = body.getAllByRole('button', {
      name: /: show what Acme monthly client report sends$/
    })
    fireEvent.click(what[0] as HTMLElement)
    const sections = await body.findByRole('dialog', {
      name: /What Acme monthly client report sends/
    })
    expect(drawerRows(sections)).toHaveLength(sectionsDrill(schedule('acme')).items.length)
    fireEvent.keyDown(sections, { key: 'Escape' })
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull())

    fireEvent.click(body.getByRole('button', { name: /: show the next sends of Acme/ }))
    const next = await body.findByRole('dialog', { name: /Next sends of Acme/ })
    expect(drawerRows(next)).toHaveLength(3)
    expect(within(next).getByText('Sun, Nov 1')).toBeTruthy()
    expect(within(next).getByText('Tue, Dec 1')).toBeTruthy()
  })

  it('opens a schedule detail on Enter on its row and on the name', async () => {
    const { body } = await renderScreen()
    const name = body.getByRole('button', { name: 'Acme monthly client report: open details' })
    const row = name.closest('[data-row]') as HTMLElement
    row.focus()
    fireEvent.keyDown(row, { key: 'Enter' })
    const dialog = await body.findByRole('dialog', { name: 'Acme monthly client report' })
    expect(within(dialog).getByText('Next sends')).toBeTruthy()
    expect(within(dialog).getByTestId('sd-deliveries').textContent).toMatch(/Deliveries\s*1/)
    // A delivery in the schedule's list opens that delivery (Delivery history's drawer).
    fireEvent.click(within(dialog).getByRole('button', { name: /^Sent Oct 1, .*: open delivery$/ }))
    const delivery = await body.findByRole('dialog', { name: /Acme monthly client report · / })
    expect(within(delivery).getByText('marketing@acmeclinics.example')).toBeTruthy()
    fireEvent.click(within(delivery).getByRole('button', { name: 'Open schedule' }))
    await body.findByRole('dialog', { name: 'Acme monthly client report' })
    fireEvent.click(within(body.getByRole('dialog')).getByRole('button', { name: 'Edit schedule' }))
    await waitFor(() => expect(body.getByRole('heading', { name: 'Edit schedule' })).toBeTruthy())
  })

  it('opens the last delivery from Last result and resends it', async () => {
    const { body, client } = await renderScreen()
    const resend = vi.spyOn(client, 'resend')
    fireEvent.click(
      body.getByRole('button', { name: /: open the last delivery of FieldPro after each check$/ })
    )
    const dialog = await body.findByRole('dialog', { name: /FieldPro after each check · / })
    expect(within(dialog).getByText(/535 authentication failed/)).toBeTruthy()
    expect(within(dialog).getByText('Fix the sending account in Email setup.')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Fix in Email setup' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Retry FieldPro/ }))
    await waitFor(() => expect(resend).toHaveBeenCalledWith({ id: 'h4' }))
  })

  it('opens a delivery from its history row by Enter, and Retry in its menu resends only', async () => {
    const { body, client } = await renderScreen()
    const resend = vi.spyOn(client, 'resend')
    openTab(body, 'Delivery history')
    const history = body.getByRole('grid', { name: 'Delivery history' })
    const menu = within(history).getByRole('button', {
      name: /^Actions for FieldPro after each check/
    })
    const row = menu.closest('[data-row]') as HTMLElement
    fireEvent.click(menuItem(body, /^Actions for FieldPro after each check/, 'Retry'))
    await waitFor(() => expect(resend).toHaveBeenCalledTimes(1))
    expect(body.queryByRole('dialog')).toBeNull()
    row.focus()
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(await body.findByRole('dialog', { name: /FieldPro after each check · / })).toBeTruthy()
  })

  it('opens the schedule and the project from a history row', async () => {
    const opened: string[] = []
    const { body } = await renderScreen((id) => opened.push(id))
    openTab(body, 'Delivery history')
    const history = body.getByRole('grid', { name: 'Delivery history' })
    fireEvent.click(
      within(history).getAllByRole('button', {
        name: 'Acme monthly client report: open schedule'
      })[0] as HTMLElement
    )
    expect(await body.findByRole('dialog', { name: 'Acme monthly client report' })).toBeTruthy()
    fireEvent.click(
      within(body.getByRole('dialog')).getByRole('button', { name: /: open project$/ })
    )
    expect(opened).toEqual(['acme'])
  })

  it('shows only the schedules that send from "N of M on"', async () => {
    const { body } = await renderScreen()
    const on = body.getByRole('button', { name: /of 4 on: show only the schedules that send/ })
    const sending = Number(/^(\d+)/.exec(on.textContent ?? '')?.[1])
    fireEvent.click(on)
    await waitFor(() => {
      expect(body.getByText(new RegExp(`Showing ${sending} of 4 schedules`))).toBeTruthy()
    })
  })
})

describe('schedule drill builders', () => {
  it('lists three weekly and monthly sends in the schedule time zone', () => {
    const weekly = upcomingSends(schedule('weekly'))
    expect(weekly.map((send) => send.day)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
    expect(weekly.every((send) => send.time === '08:00')).toBe(true)
    const last = upcomingSends({
      ...schedule('acme'),
      timing: { kind: 'monthly', when: 'last', time: '07:00' },
      nextSendAt: '2027-01-31T13:00:00.000Z'
    })
    expect(last.map((send) => send.day)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
  })

  it('has nothing coming for a paused schedule and lists triggers for a change alert', () => {
    expect(nextDrill({ ...schedule('weekly'), status: 'paused' })).toBeNull()
    const alert = nextDrill(schedule('lost'))
    expect(alert?.items.map((item) => item.primary)).toEqual([
      'When a tracked page loses a citation'
    ])
  })

  it('gives each recipient its last result, and the summary adds up', () => {
    const drill = recipientsDrill(
      schedule('field'),
      [
        {
          id: 'd1',
          scheduleId: 'field',
          at: '2026-10-07T19:31:00.000Z',
          trigger: 'after_check',
          projectId: 'fieldpro',
          recipients: ['you@textbolt.com'],
          outcome: 'failed',
          ok: false,
          reason: 'SMTP sign-in failed',
          nextStep: 'Fix it.',
          occurrenceKey: null
        }
      ],
      'America/Chicago'
    )
    const groups = drill.summary?.map(
      (part) => drill.items.filter((item) => item.group === part.group).length
    )
    expect(groups?.reduce((sum, value) => sum + value, 0)).toBe(drill.items.length)
    expect(drill.items.find((item) => item.primary === 'you@textbolt.com')?.detail).toBe(
      'SMTP sign-in failed Fix it.'
    )
  })
})
