// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMockAssistClient } from '../assist/client'
import { textboltCatalog } from '../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore, resetM2Memory } from '../mocks/m2/memory'
import { createMockShellClient } from '../projects/mockClient'
import { createMockTemplatesClient } from '../templates/client'
import { AudienceScreen } from './AudienceScreen'
import { GapsReview } from './gaps/GapsReview'

/** History steps and hashchange events are tasks: let them land. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
}

function client(): ReturnType<typeof createMockShellClient> {
  return createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore()
  })
}

const page = (): ReturnType<ReturnType<typeof createProjectMemory>['getPage']> =>
  createProjectMemory(textboltCatalog()).getPage('textbolt', 'alerts')

function audience(): ReturnType<typeof render> {
  return render(
    <AudienceScreen
      assistClient={createMockAssistClient()}
      client={client()}
      templatesClient={createMockTemplatesClient()}
      projectId="textbolt"
      page={page()}
      pipelineSource={null}
    />
  )
}

function gaps(): ReturnType<typeof render> {
  return render(
    <GapsReview
      client={client()}
      templatesClient={createMockTemplatesClient()}
      projectId="textbolt"
      page={page()}
      marketId="us"
      focus={null}
      assistClient={createMockAssistClient()}
      reloadKey={0}
      onWrite={() => undefined}
      writing={false}
    />
  )
}

beforeEach(() => {
  resetM2Memory()
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
  localStorage.clear()
})

describe('Buyer profile drawers', () => {
  it('Edit buyer profile opens from a link, asks before dropping changes, and Esc closes it', async () => {
    window.location.hash = '#/pages/alerts/audience?drawer=au-edit'
    const view = audience()
    const dialog = await view.findByRole('dialog', { name: 'Edit buyer profile' })
    const who = within(dialog).getByLabelText('Who they are')
    fireEvent.change(who, { target: { value: 'Owners of small field-service crews' } })
    expect(within(dialog).getByText(/1 part changed/)).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.getByRole('alertdialog', { name: 'Discard changes?' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Keep editing' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(view.getByRole('button', { name: 'Discard' }))
    expect(view.queryByRole('dialog', { name: 'Edit buyer profile' })).toBeNull()
    await settle()
    expect(window.location.hash).toBe('#/pages/alerts/audience')
  })

  it('Edit buyer profile saves every changed part in one change', async () => {
    window.location.hash = '#/pages/alerts/audience'
    const view = audience()
    await view.findByRole('grid', { name: 'Buyer profile points' })
    fireEvent.click(
      within(view.getByRole('region', { name: 'This version' })).getByRole('button', {
        name: 'Edit'
      })
    )
    expect(window.location.hash).toBe('#/pages/alerts/audience?drawer=au-edit')
    const dialog = await view.findByRole('dialog', { name: 'Edit buyer profile' })
    fireEvent.change(within(dialog).getByLabelText('Trigger events'), {
      target: { value: 'A no-show on a Monday job' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    const grid = view.getByRole('grid', { name: 'Buyer profile points' })
    await waitFor(() => expect(within(grid).getByText('A no-show on a Monday job')).toBeTruthy())
    await settle()
    expect(window.location.hash).toBe('#/pages/alerts/audience')
  })

  it('an old ?panel=settings link opens Profile settings, and Back closes it', async () => {
    window.location.hash = '#/pages/alerts/audience'
    const view = audience()
    await view.findByRole('grid', { name: 'Buyer profile points' })
    fireEvent.click(view.getByRole('button', { name: 'Profile settings' }))
    expect(await view.findByRole('dialog', { name: 'Profile settings' })).toBeTruthy()
    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(view.queryByRole('dialog', { name: 'Profile settings' })).toBeNull()
    expect(window.location.hash).toBe('#/pages/alerts/audience')
    cleanup()

    window.location.hash = '#/pages/alerts/audience?panel=settings'
    const again = audience()
    expect(await again.findByRole('dialog', { name: 'Profile settings' })).toBeTruthy()
    expect(window.location.hash).toBe('#/pages/alerts/audience?drawer=au-settings')
  })

  it('the points grid search is on the URL', async () => {
    window.location.hash = '#/pages/alerts/audience?au.q=nothing-matches-this'
    const view = audience()
    const search = await view.findByRole('searchbox')
    expect((search as HTMLInputElement).value).toBe('nothing-matches-this')
  })
})

describe('Content gaps settings drawer', () => {
  it('opens from the sliders and a link, closes on ✕ and Back, and keeps the template folded', async () => {
    window.location.hash = '#/pages/alerts/gaps'
    const view = gaps()
    fireEvent.click(await view.findByRole('button', { name: 'Content gaps settings' }))
    expect(window.location.hash).toBe('#/pages/alerts/gaps?drawer=gp-settings')
    const dialog = await view.findByRole('dialog', { name: 'Content gaps settings' })
    const expert = within(dialog).getByRole('button', { name: /Expert options/ })
    expect(expert.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(expert)
    expect(within(dialog).getByLabelText('Template')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Write content gaps again' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Content gaps settings' }))
    expect(view.queryByRole('dialog')).toBeNull()
    await settle()
    expect(window.location.hash).toBe('#/pages/alerts/gaps')

    fireEvent.click(view.getByRole('button', { name: 'Content gaps settings' }))
    await view.findByRole('dialog', { name: 'Content gaps settings' })
    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(window.location.hash).toBe('#/pages/alerts/gaps')
  })

  it('an old ?panel=settings link opens the drawer', async () => {
    window.location.hash = '#/pages/alerts/gaps?panel=settings'
    const view = gaps()
    expect(await view.findByRole('dialog', { name: 'Content gaps settings' })).toBeTruthy()
    expect(window.location.hash).toBe('#/pages/alerts/gaps?drawer=gp-settings')
  })

  it('matrix filters are on the URL; Back undoes one', async () => {
    window.location.hash = '#/pages/alerts/gaps?gf.cov=strong'
    const view = gaps()
    expect(await view.findByText(/^Showing \d+ of 10 questions$/)).toBeTruthy()
    const filter = view.getByRole('group', { name: 'Filter by coverage' })
    expect(
      within(filter)
        .getByRole('button', { name: /^Strong/ })
        .getAttribute('aria-pressed')
    ).toBe('true')
    fireEvent.click(within(filter).getByRole('button', { name: /^All/ }))
    expect(window.location.hash).toBe('#/pages/alerts/gaps')
    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(window.location.hash).toBe('#/pages/alerts/gaps?gf.cov=strong')
    expect(view.getByText(/^Showing \d+ of 10 questions$/)).toBeTruthy()
  })
})
