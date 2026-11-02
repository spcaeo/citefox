// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScreenHeader } from './Header'
import { headerConfirmId, withHeaderConfirm } from './headerConfirm'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

describe('ScreenHeader primary and more', () => {
  it('orders the right end: tool icons, then ⋯, then the main action last', () => {
    const onCsv = vi.fn()
    const view = render(
      <ScreenHeader
        title="Pages"
        tools={[
          { id: 'csv', kind: 'csv', onClick: onCsv },
          { id: 'refresh', kind: 'refresh' }
        ]}
        more={[{ id: 'import', label: 'Import', onSelect: vi.fn() }]}
        primary={{ label: 'Add', icon: 'plus', onClick: vi.fn() }}
      />
    )
    const names = Array.from(view.container.querySelectorAll('header button')).map(
      (button) => button.getAttribute('aria-label') ?? button.textContent
    )
    expect(names).toEqual(['Download CSV', 'Refresh', 'More actions', 'Add'])
    const csv = view.getByRole('button', { name: 'Download CSV' })
    expect(csv.textContent).toBe('')
    expect(csv.getAttribute('data-tip')).toBe('Download CSV')
    fireEvent.click(csv)
    expect(onCsv).toHaveBeenCalledTimes(1)
  })

  it('disables ⋯ while every item in it is disabled', () => {
    const view = render(
      <ScreenHeader
        title="Export a report"
        more={[{ id: 'schedule', label: 'Schedule this', disabled: true, onSelect: vi.fn() }]}
      />
    )
    const more = view.getByRole('button', { name: 'More actions' }) as HTMLButtonElement
    expect(more.disabled).toBe(true)
    view.rerender(
      <ScreenHeader
        title="Export a report"
        more={[{ id: 'schedule', label: 'Schedule this', onSelect: vi.fn() }]}
      />
    )
    expect(more.disabled).toBe(false)
  })

  it('puts ⋯ then the one green primary on the right, and runs plain items', async () => {
    const onAdd = vi.fn()
    const onExport = vi.fn()
    const view = render(
      <ScreenHeader
        title="Questions"
        subtitle={<p className="section-subtitle">Every question you track.</p>}
        primary={{ label: 'Add questions', icon: 'plus', onClick: onAdd }}
        more={[
          { id: 'import', label: 'Import from Excel or CSV', href: '#/questions?drawer=import' },
          { id: 'export', label: 'Export questions (CSV)', icon: 'download', onSelect: onExport }
        ]}
      />
    )
    const header = view.container.querySelector('header') as HTMLElement
    const buttons = within(header).getAllByRole('button')
    expect(
      buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent)
    ).toEqual(['More actions', 'Add questions'])
    expect(buttons[1]?.className).toContain('ui-btn-primary')
    fireEvent.click(buttons[1] as HTMLElement)
    expect(onAdd).toHaveBeenCalledOnce()

    fireEvent.click(within(header).getByRole('button', { name: 'More actions' }))
    const menu = view.getByRole('menu', { name: 'More actions' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Export questions (CSV)' }))
    expect(onExport).toHaveBeenCalledOnce()
    fireEvent.click(within(header).getByRole('button', { name: 'More actions' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Import from Excel or CSV' }))
    expect(window.location.hash).toBe('#/questions?drawer=import')
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
  })

  it('asks in Confirm on the URL before a red item runs; Cancel and Back leave it undone', async () => {
    window.location.hash = '#/questions'
    const onDelete = vi.fn()
    const view = render(
      <ScreenHeader
        title="Questions"
        more={[
          { id: 'export', label: 'Export questions (CSV)', onSelect: () => undefined },
          {
            id: 'delete',
            label: 'Delete selected…',
            onSelect: onDelete,
            danger: { title: 'Delete 3 questions?', confirmLabel: 'Delete questions' }
          }
        ]}
      />
    )
    fireEvent.click(view.getByRole('button', { name: 'More actions' }))
    const item = view.getByRole('menuitem', { name: 'Delete selected…' })
    expect(item.className).toContain('ui-menu-danger')
    fireEvent.click(item)
    await waitFor(() => expect(window.location.hash).toBe('#/questions?dialog=head-delete'))
    const dialog = await view.findByRole('alertdialog', { name: 'Delete 3 questions?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(view.queryByRole('alertdialog')).toBeNull())
    expect(window.location.hash).toBe('#/questions')
    expect(onDelete).not.toHaveBeenCalled()

    // A pasted link opens the same confirm; Delete runs the item and closes it.
    act(() => {
      window.location.hash = '#/questions?dialog=head-delete'
    })
    const again = await view.findByRole('alertdialog', { name: 'Delete 3 questions?' })
    fireEvent.click(within(again).getByRole('button', { name: 'Delete questions' }))
    expect(onDelete).toHaveBeenCalledOnce()
    await waitFor(() => expect(view.queryByRole('alertdialog')).toBeNull())
    expect(window.location.hash).toBe('#/questions')
  })

  it('keeps the older actions slot working, before ⋯ and the primary', () => {
    const view = render(
      <ScreenHeader
        title="Reports"
        actions={<button type="button">Legacy</button>}
        primary={<button type="button">Check now ▾</button>}
        more={[{ id: 'a', label: 'Something', onSelect: () => undefined }]}
      />
    )
    expect(
      within(view.container.querySelector('header') as HTMLElement)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent)
    ).toEqual(['Legacy', 'More actions', 'Check now ▾'])
  })
})

describe('header confirm hash', () => {
  it('sets and clears dialog=head-<id>, keeping the route and its values', () => {
    expect(withHeaderConfirm('#/questions?sort=stage', 'delete')).toBe(
      '#/questions?sort=stage&dialog=head-delete'
    )
    expect(withHeaderConfirm('#/questions?sort=stage&dialog=head-delete', null)).toBe(
      '#/questions?sort=stage'
    )
    expect(headerConfirmId('#/questions?dialog=head-delete')).toBe('delete')
    expect(headerConfirmId('#/questions?dialog=reset')).toBeNull()
  })
})
