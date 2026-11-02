// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMockAssistClient } from '../../assist/client'
import { textboltCatalog } from '../../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore, resetM2Memory } from '../../mocks/m2/memory'
import { createMockShellClient } from '../../projects/mockClient'
import { resetDrawersForTests } from '../../shell/drawers'
import { createMockTemplatesClient } from '../../templates/client'
import { UndoToastHost } from '../../ui'
import { axeViolations } from '../../ui/axe.test-helper'
import { AudienceScreen } from '../AudienceScreen'

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

function renderScreen(): ReturnType<typeof render> {
  const client = createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore()
  })
  const page = createProjectMemory(textboltCatalog()).getPage('textbolt', 'alerts')
  return render(
    <>
      <AudienceScreen
        assistClient={createMockAssistClient()}
        client={client}
        templatesClient={createMockTemplatesClient()}
        projectId="textbolt"
        page={page}
        pipelineSource={null}
      />
      <UndoToastHost />
    </>
  )
}

async function grid(): Promise<HTMLElement> {
  return screen.findByRole('grid', { name: 'Buyer profile points' })
}

/** The first trigger's wording, read from the grid. */
async function firstTrigger(): Promise<string> {
  const rows = within(await grid()).getAllByRole('row')
  const header = rows.findIndex((row) => row.textContent?.startsWith('Trigger events'))
  const trigger = rows
    .slice(header + 1)
    .map((row) => within(row).queryByRole('button', { name: /^Edit point: / }))
    .find((item) => item !== null)
  expect(trigger).toBeTruthy()
  return (trigger?.getAttribute('aria-label') ?? '').replace('Edit point: ', '')
}

beforeEach(() => {
  resetM2Memory()
  resetDrawersForTests()
  window.history.replaceState(null, '', '#/pages/alerts/audience')
})

afterEach(() => cleanup())

describe('Buyer profile edits', () => {
  it('edits a point in place: Enter saves, Esc cancels', async () => {
    renderScreen()
    const old = await firstTrigger()
    fireEvent.click(within(await grid()).getByRole('button', { name: `Edit point: ${old}` }))
    const box = within(await grid()).getByRole('textbox', { name: `Edit point: ${old}` })
    fireEvent.change(box, { target: { value: 'Typed then dropped' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(within(await grid()).queryByText('Typed then dropped')).toBeNull()

    fireEvent.click(within(await grid()).getByRole('button', { name: `Edit point: ${old}` }))
    const again = within(await grid()).getByRole('textbox', { name: `Edit point: ${old}` })
    fireEvent.change(again, { target: { value: 'A customer hears about the outage first' } })
    await act(async () => {
      fireEvent.keyDown(again, { key: 'Enter' })
      await settle()
    })
    await waitFor(() =>
      expect(
        within(screen.getByRole('grid', { name: 'Buyer profile points' })).getByText(
          'A customer hears about the outage first'
        )
      ).toBeTruthy()
    )
    expect(within(await grid()).queryByText(old)).toBeNull()
  })

  it('adds a trigger from its section header', async () => {
    renderScreen()
    fireEvent.click(within(await grid()).getByRole('button', { name: 'Add trigger' }))
    const box = within(await grid()).getByRole('textbox', { name: 'New point in Trigger events' })
    fireEvent.change(box, { target: { value: 'A weekend outage nobody saw' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
      await settle()
    })
    await waitFor(async () =>
      expect(within(await grid()).getByText('A weekend outage nobody saw')).toBeTruthy()
    )
  })

  it('removes a point with an Undo that puts it back', async () => {
    renderScreen()
    const old = await firstTrigger()
    fireEvent.click(within(await grid()).getByRole('button', { name: `Actions for ${old}` }))
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }))
      await settle()
    })
    await waitFor(async () => expect(within(await grid()).queryByText(old)).toBeNull())
    const toast = await screen.findByTestId('profile-remove-toast')
    expect(toast.textContent).toContain(`Removed “${old}”.`)
    await act(async () => {
      fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
      await settle()
    })
    await waitFor(async () => expect(within(await grid()).getByText(old)).toBeTruthy())
  })

  it('regenerates into a side-by-side review on the URL; Apply then Undo', async () => {
    renderScreen()
    const old = await firstTrigger()
    // Make the saved profile differ from what Claude writes, so there is a change to review.
    fireEvent.click(within(await grid()).getByRole('button', { name: `Edit point: ${old}` }))
    const box = within(await grid()).getByRole('textbox', { name: `Edit point: ${old}` })
    fireEvent.change(box, { target: { value: 'My own trigger' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
      await settle()
    })
    await waitFor(async () => expect(within(await grid()).getByText('My own trigger')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Profile settings' }))
    const settings = screen.getByRole('dialog', { name: 'Profile settings' })
    await act(async () => {
      fireEvent.click(within(settings).getByRole('button', { name: 'Regenerate' }))
      await settle()
    })
    expect(window.location.hash).toMatch(/drawer=profile-diff&pdiff=/)
    const drawer = await screen.findByRole('dialog', { name: /Review the new buyer profile/ })
    // Until Apply, the saved profile keeps the person's point.
    expect(within(await grid()).getByText('My own trigger')).toBeTruthy()
    const choice = within(drawer).getByRole('group', { name: 'Keep or replace: My own trigger' })
    expect(within(choice).getByRole('button', { name: 'Keep' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(await axeViolations(drawer)).toEqual([])
    fireEvent.click(within(drawer).getByRole('button', { name: 'Replace all' }))
    expect(
      within(choice).getByRole('button', { name: 'Replace' }).getAttribute('aria-pressed')
    ).toBe('true')
    await act(async () => {
      fireEvent.click(within(drawer).getByRole('button', { name: 'Apply' }))
      await settle()
    })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Review the new buyer profile/ })).toBeNull()
    )
    await waitFor(async () => expect(within(await grid()).queryByText('My own trigger')).toBeNull())
    expect(within(await grid()).getByText(old)).toBeTruthy()

    const toast = await screen.findByTestId('profile-diff-toast')
    await act(async () => {
      fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
      await settle()
    })
    await waitFor(async () => expect(within(await grid()).getByText('My own trigger')).toBeTruthy())
  })

  it('a review link with nothing to compare says so', async () => {
    window.history.replaceState(null, '', '#/pages/alerts/audience?drawer=profile-diff&pdiff=icp-x')
    renderScreen()
    const drawer = await screen.findByRole('dialog', { name: /Review the new buyer profile/ })
    expect(within(drawer).getByText('Nothing to compare')).toBeTruthy()
  })
})
