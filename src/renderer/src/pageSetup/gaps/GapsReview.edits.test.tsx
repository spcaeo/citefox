// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockAssistClient } from '../../assist/client'
import { textboltCatalog } from '../../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore, resetM2Memory } from '../../mocks/m2/memory'
import { createMockShellClient } from '../../projects/mockClient'
import { createMockTemplatesClient } from '../../templates/client'
import { UndoToastHost } from '../../ui'
import { GapsReview } from './GapsReview'

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

function renderReview(): ReturnType<typeof render> {
  const client = createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore()
  })
  const page = createProjectMemory(textboltCatalog()).getPage('textbolt', 'alerts')
  return render(
    <>
      <GapsReview
        client={client}
        templatesClient={createMockTemplatesClient()}
        projectId="textbolt"
        page={page}
        marketId="us"
        focus={null}
        assistClient={createMockAssistClient()}
        reloadKey={0}
        onWrite={() => undefined}
        writing={false}
      />
      <UndoToastHost />
    </>
  )
}

async function rowMenu(position: number): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: `Actions for question ${position}` }))
  return screen.getByRole('menu', { name: `Actions for question ${position}` })
}

function statusCell(position: number): string {
  const grid = screen.getByRole('grid', { name: 'Coverage matrix' })
  const row = within(grid)
    .getAllByRole('row')
    .find((item) => within(item).queryByText(String(position), { selector: '.gp-q' }))
  return row?.textContent ?? ''
}

beforeEach(() => {
  resetM2Memory()
  window.history.replaceState(null, '', '#/pages/alerts/gaps')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Content gaps edits', () => {
  it('marks a row published from its menu, and Undo reopens it', async () => {
    renderReview()
    const menu = await rowMenu(1)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mark published: question 1' }))
    await waitFor(() => expect(statusCell(1)).toContain('Published'))
    const toast = await screen.findByTestId('gap-status-toast')
    expect(toast.textContent).toContain('Published: 1 question.')
    await act(async () => {
      fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
      await settle()
    })
    await waitFor(() => expect(statusCell(1)).toContain('Open'))
  })

  it('ticks rows and marks them verified in bulk', async () => {
    renderReview()
    await screen.findByRole('grid', { name: 'Coverage matrix' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select question 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select question 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark verified' }))
    await waitFor(() => {
      expect(statusCell(1)).toContain('Verified')
      expect(statusCell(2)).toContain('Verified')
    })
  })

  it('edits the FAQ draft in a drawer on the URL, then resets to CiteFox AI’s draft', async () => {
    renderReview()
    const menu = await rowMenu(1)
    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit FAQ draft' }))
      await settle()
    })
    expect(window.location.hash).toMatch(/drawer=gap-draft&gap=/)
    const drawer = await screen.findByRole('dialog', { name: /Edit FAQ draft/ })
    const answer = within(drawer).getByRole('textbox', { name: 'Answer' })
    fireEvent.change(answer, {
      target: { value: 'Yes. TextBolt texts your crew from any email, no developer needed.' }
    })
    expect(within(drawer).getByText(/short of the 40–70 words/)).toBeTruthy()
    expect(within(drawer).getByText(/Names TextBolt/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(drawer).getByRole('button', { name: 'Save draft' }))
      await settle()
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Edit FAQ draft/ })).toBeNull())
    expect((await screen.findByTestId('gap-draft-toast')).textContent).toContain(
      'Saved the FAQ draft for question 1.'
    )

    const again = await rowMenu(1)
    await act(async () => {
      fireEvent.click(within(again).getByRole('menuitem', { name: 'Edit FAQ draft' }))
      await settle()
    })
    const reopened = await screen.findByRole('dialog', { name: /Edit FAQ draft/ })
    expect(
      (within(reopened).getByRole('textbox', { name: 'Answer' }) as HTMLTextAreaElement).value
    ).toContain('no developer needed')
    await act(async () => {
      fireEvent.click(within(reopened).getByRole('button', { name: 'Reset to CiteFox AI’s draft' }))
      await settle()
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Edit FAQ draft/ })).toBeNull())
    expect((await screen.findByTestId('gap-draft-toast')).textContent).toContain(
      'back to CiteFox AI’s draft'
    )
  })

  it('plans a row as a fix (the Fix drawer on the URL) and copies FAQPage JSON-LD', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderReview()
    const menu = await rowMenu(1)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy as FAQPage JSON-LD' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = JSON.parse(String((writeText.mock.calls[0] as unknown[])[0])) as {
      '@type': string
      mainEntity: { '@type': string; acceptedAnswer: { '@type': string } }[]
    }
    expect(copied['@type']).toBe('FAQPage')
    expect(copied.mainEntity[0]?.acceptedAnswer['@type']).toBe('Answer')
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Copied' })).toBeTruthy())
    fireEvent.keyDown(menu, { key: 'Escape' })

    const again = await rowMenu(1)
    await act(async () => {
      fireEvent.click(within(again).getByRole('menuitem', { name: 'Plan as a fix' }))
      await settle()
    })
    const params = new URLSearchParams(window.location.hash.split('?')[1])
    expect(params.get('drawer')).toBe('fix')
    expect(params.get('fix')).toBe('new')
    expect(params.get('fix.page')).toBe('alerts')
    expect(params.get('fix.prompts')).toBeTruthy()
  })
})
