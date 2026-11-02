// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ReportsScreen } from './ReportsScreen'
import { createMockSchedulesClient } from './schedulesMock'
import { openTab } from './schedules.test-helper'

afterEach(cleanup)

/**
 * Delivery history is a v2 list grid, like Schedules (search, result filter, CSV),
 * and "By day" groups the same rows the table shows under one header per day.
 */
describe('Delivery history grid', () => {
  it('uses the list grid tools, and By day groups the rows the table shows', async () => {
    const view = render(
      <ReportsScreen
        client={createMockSchedulesClient()}
        timeZone="America/Chicago"
        exportCsv={async (request) => ({
          ok: true,
          rowCount: request.rows.length,
          columnCount: request.header.length,
          fileName: request.fileName
        })}
      />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getAllByText('TextBolt weekly summary').length).toBeGreaterThan(0)
    })
    openTab(body, 'Delivery history')
    const history = body.getByRole('region', { name: 'Delivery history' })
    const scope = within(history)
    expect(scope.getByRole('grid', { name: 'Delivery history' })).toBeTruthy()
    expect(scope.getByRole('group', { name: 'Result' })).toBeTruthy()
    fireEvent.click(scope.getByRole('button', { name: /Export CSV/ }))
    expect(await scope.findByText(/^Saved \d+ rows?\.$/)).toBeTruthy()

    fireEvent.change(scope.getByPlaceholderText('Search schedule, recipient or error'), {
      target: { value: 'FieldPro' }
    })
    fireEvent.click(scope.getByRole('button', { name: 'By day' }))
    const grid = scope.getByRole('grid', { name: 'Delivery history' })
    const days = within(grid).getAllByRole('button', { expanded: true })
    expect(days.length).toBeGreaterThan(0)
    for (const row of grid.querySelectorAll('[data-row]')) {
      expect(row.textContent).toContain('FieldPro')
    }

    fireEvent.click(scope.getByRole('button', { name: 'Table' }))
    expect(
      (scope.getByPlaceholderText('Search schedule, recipient or error') as HTMLInputElement).value
    ).toBe('FieldPro')
  })
})
