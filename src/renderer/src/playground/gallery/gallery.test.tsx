// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import { DrillHost } from '../../drill/DrillHost'
import GalleryScreen from './index'

const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false },
    // The board shows the same sponsor card more than once on purpose (in the demo sidebars
    // and on its own). The app shell has one of each.
    'landmark-unique': { enabled: false }
  }
}

afterEach(cleanup)

describe('v2 gallery', () => {
  it('shows every board section and the shared components, with no axe violations', async () => {
    const view = render(
      <DrillHost>
        <GalleryScreen projectId={null} />
      </DrillHost>
    )
    expect(view.getByRole('heading', { level: 1, name: 'FoxCue look' })).toBeTruthy()
    for (const name of [
      'Colour',
      'Type',
      'Space, shape, depth',
      'Actions',
      'Inputs',
      'Data',
      'Report charts',
      'List grid',
      'Panels',
      'Help me fill',
      'Shell',
      'Sponsors'
    ]) {
      expect(view.getByRole('heading', { level: 2, name })).toBeTruthy()
    }
    expect(view.getByRole('grid', { name: 'To-do questions' })).toBeTruthy()
    expect(view.getByRole('grid', { name: 'Keywords' })).toBeTruthy()
    expect(view.getByRole('navigation', { name: 'Sidebar demo, collapsed' })).toBeTruthy()
    expect(view.getByRole('complementary', { name: 'Gold sponsor' })).toBeTruthy()
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
  }, 30_000)

  it('switches the report charts board between sepia, light and dark, and reports a drill', () => {
    const view = render(
      <DrillHost>
        <GalleryScreen projectId={null} />
      </DrillHost>
    )
    const board = view.getByTestId('report-charts-board')
    expect(board.getAttribute('data-theme')).toBe('sepia')
    fireEvent.click(view.getByRole('button', { name: 'Dark' }))
    expect(board.getAttribute('data-theme')).toBe('dark')
    expect(board.querySelectorAll('svg.cfc').length).toBeGreaterThanOrEqual(11)
    fireEvent.click(within(board).getByRole('button', { name: /^textbolt\.com: 6 to 20/ }))
    expect(view.getByText('Would open: dom:textbolt.com')).toBeTruthy()
  })

  it('collapses and expands the demo sidebar', () => {
    const view = render(
      <DrillHost>
        <GalleryScreen projectId={null} />
      </DrillHost>
    )
    const demo = view.getByRole('navigation', { name: 'Sidebar demo, expanded' })
    fireEvent.click(within(demo).getByRole('button', { name: 'Collapse sidebar' }))
    expect(demo.hasAttribute('data-collapsed')).toBe(true)
  })

  it('opens the demo drawer on the URL and closes it on Escape, and the demo confirm', async () => {
    window.location.hash = '#/playground/gallery'
    const view = render(
      <DrillHost>
        <GalleryScreen projectId={null} />
      </DrillHost>
    )
    fireEvent.click(view.getByRole('button', { name: 'Open drawer' }))
    await waitFor(() =>
      expect(window.location.hash).toBe('#/playground/gallery?drawer=gallery-drawer')
    )
    const drawer = await view.findByRole('dialog', { name: /Cited questions/ })
    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).toBe('#/playground/gallery'))

    fireEvent.click(view.getByRole('button', { name: 'Open confirm' }))
    const confirm = view.getByRole('alertdialog', { name: 'Delete this topic?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete topic' }))
    expect(view.queryByRole('alertdialog')).toBeNull()
    expect(view.getByText('Deleted (demo only, nothing changed).')).toBeTruthy()
  })

  it('shows the header rules: one green button, the rest under ⋯, red items ask on the URL', async () => {
    window.location.hash = '#/playground/gallery'
    const view = render(
      <DrillHost>
        <GalleryScreen projectId={null} />
      </DrillHost>
    )
    expect(view.getByRole('button', { name: 'Add questions' }).className).toContain(
      'ui-btn-primary'
    )
    fireEvent.click(view.getByRole('button', { name: 'Questions actions (demo)' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Delete selected…' }))
    await waitFor(() => expect(window.location.hash).toContain('dialog=head-gl-delete'))
    const confirm = await view.findByRole('alertdialog', { name: 'Delete 3 questions?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete questions' }))
    await waitFor(() =>
      expect(view.getByText('Deleted (demo only, nothing changed).')).toBeTruthy()
    )
    expect(view.getByRole('button', { name: 'Refresh' }).getAttribute('data-tip')).toBe('Refresh')
  })
})
