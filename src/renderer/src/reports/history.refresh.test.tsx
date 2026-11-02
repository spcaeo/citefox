// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DeliveryRecord } from '@shared/domain'
import { ReportsScreen } from './ReportsScreen'
import type { SchedulesClient } from './schedulesClient'
import { createMockSchedulesClient } from './schedulesMock'
import { openTab } from './schedules.test-helper'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

/**
 * Live check 2026-10-21: after "Send a test now" the test send was recorded, but Delivery
 * history showed it only after leaving the screen and coming back.
 */
describe('Delivery history after a test send', () => {
  it('shows the test send at once, labelled as a test', async () => {
    const base = createMockSchedulesClient()
    const recorded: DeliveryRecord[] = []
    const client: SchedulesClient = {
      ...base,
      async sendTest(request) {
        const result = await base.sendTest(request)
        recorded.push(testSend(request.scheduleId))
        return result
      },
      async listDeliveries(request) {
        const listed = await base.listDeliveries(request)
        return { ...listed, rows: [...recorded, ...listed.rows] }
      }
    }
    const view = render(<ReportsScreen client={client} timeZone="UTC" />)
    const body = within(view.container)
    await body.findAllByText('TextBolt weekly summary')

    fireEvent.click(body.getByRole('button', { name: 'New schedule' }))
    const form = within(body.getByRole('dialog', { name: 'New schedule' }))
    fireEvent.change(form.getByLabelText('Name'), { target: { value: 'Live test report' } })
    fireEvent.change(form.getByLabelText('Recipients'), {
      target: { value: 'me@example.com' }
    })
    fireEvent.click(form.getByRole('button', { name: 'Add' }))
    fireEvent.click(form.getByRole('button', { name: 'Send a test now' }))
    await waitFor(() => expect(recorded).toHaveLength(1))
    fireEvent.click(form.getByRole('button', { name: 'Close New schedule' }))
    openTab(body, 'Delivery history')

    const history = body.getByRole('region', { name: 'Delivery history' })
    await waitFor(() => {
      expect(within(history).getByText('Test send')).toBeTruthy()
    })
    expect(history.textContent).not.toContain('report_test')
    expect(history.textContent).not.toContain('account_test')
  })
})

function testSend(scheduleId: string): DeliveryRecord {
  return {
    id: 'del-live-test',
    scheduleId,
    at: '2026-10-21T08:16:11.000Z',
    trigger: 'report_test',
    projectId: null,
    recipients: ['me@example.com'],
    outcome: 'sent',
    ok: true,
    reason: null,
    nextStep: null,
    occurrenceKey: null
  }
}
