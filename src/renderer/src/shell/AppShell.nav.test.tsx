// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { textboltCatalog } from '../mocks/m2/catalog'
import { memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockPlaygroundClient } from '../playground/client'
import { createMockShellClient } from '../projects/mockClient'
import { createMockTemplatesClient } from '../templates/client'
import { AppShell } from './AppShell'
import { parseHash } from './routes'

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '#/')
})

function renderAt(hash: string): ReturnType<typeof render> {
  window.history.replaceState(null, '', hash)
  return render(
    <AppShell
      location={parseHash(hash)}
      bridgeError={null}
      client={createMockShellClient({
        catalog: textboltCatalog(),
        activeStore: memoryActiveProjectStore('textbolt'),
        initialFinished: true
      })}
      templatesClient={createMockTemplatesClient()}
      playgroundClient={createMockPlaygroundClient()}
    />
  )
}

describe('nav redesign shell', () => {
  it('mounts each AI visibility section with exactly one header', async () => {
    for (const [hash, heading] of [
      ['#/overview', 'Summary'],
      ['#/questions', 'Questions'],
      ['#/competitors', 'Competitors'],
      ['#/fixes', 'Fixes'],
      ['#/history', 'Check history'],
      ['#/citations', 'Citations'],
      ['#/communities', 'Communities']
    ] as const) {
      const view = renderAt(hash)
      const main = await view.findByRole('main')
      await within(main).findByRole('heading', { level: 1, name: heading })
      expect(within(main).getAllByRole('heading', { level: 1 })).toHaveLength(1)
      cleanup()
    }
  })

  it('opens every old Your site and Setup address under its hub tab bar', async () => {
    for (const [hash, hub, tab] of [
      ['#/communities', 'Pages', 'Communities'],
      ['#/youtube', 'Pages', 'YouTube'],
      ['#/project-settings', 'Settings', 'Project settings'],
      ['#/playground', 'Settings', 'Playground']
    ] as const) {
      const view = renderAt(hash)
      const main = await view.findByRole('main')
      const bar = await within(main).findByRole('navigation', { name: hub })
      const current = within(bar).getByRole('tab', { name: tab })
      expect(current.getAttribute('aria-selected'), hash).toBe('true')
      expect(current.getAttribute('href'), hash).toBe(hash)
      cleanup()
    }
  })

  it('draws no in-page breadcrumb under the top bar', async () => {
    const view = renderAt('#/project-settings')
    const main = await view.findByRole('main')
    await within(main).findByRole('heading', { level: 1, name: 'Project settings' })
    expect(main.querySelector('.crumb')).toBeNull()
  })

  it('opens Add questions from the URL over the route, and Close leaves the route', async () => {
    const view = renderAt('#/overview?dialog=add-questions')
    const dialog = await view.findByRole('dialog', { name: 'Add questions' })
    expect(view.getByRole('heading', { level: 1, name: 'Summary' })).toBeTruthy()
    // An old ?dialog= link becomes the drawer's own URL in place.
    await waitFor(() => expect(window.location.hash).toBe('#/overview?drawer=add-questions'))
    const crumbs = within(within(dialog).getByRole('navigation', { name: 'Drawer breadcrumb' }))
    expect(crumbs.getByRole('link', { name: 'Summary' })).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close Add questions' }))
    })
    await waitFor(() => expect(window.location.hash).toBe('#/overview'))
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('puts the page, topic and question search in the top bar', async () => {
    const view = renderAt('#/overview')
    const banner = await view.findByRole('banner')
    expect(
      await within(banner).findByRole('combobox', { name: /pages, topics and questions/ })
    ).toBeTruthy()
    const nav = within(view.getByRole('navigation', { name: 'CiteFox' }))
    expect(nav.queryByRole('combobox')).toBe(null)
    expect(nav.queryByRole('searchbox')).toBe(null)
  })

  it('names a page in the breadcrumb as its heading does, not by its short label', async () => {
    const view = renderAt('#/pages/alerts/results')
    const main = await view.findByRole('main')
    const heading = await within(main).findByRole('heading', { level: 1 })
    const crumbs = within(view.getByRole('navigation', { name: 'Breadcrumb' }))
    await waitFor(() =>
      expect(
        crumbs.getByText(heading.textContent ?? '', { selector: '[aria-current="page"]' })
      ).toBeTruthy()
    )
  })
})
