// @vitest-environment happy-dom
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { textboltCatalog } from '../mocks/m2/catalog'
import { memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockPlaygroundClient } from '../playground/client'
import { createMockShellClient } from '../projects/mockClient'
import { createMockTemplatesClient } from '../templates/client'
import { AppShell } from './AppShell'
import { parseHash } from './routes'
import { hueForLocation, type SectionHue } from './sidebarNav'

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

/** The header the band styles (theme.css): main's first child, or that child's first child. */
function bandHeader(main: HTMLElement): Element | null {
  const isHeader = (node: Element | null | undefined): boolean =>
    Boolean(node && ['screen-header', 'ov-head', 'tr-head'].some((c) => node.classList.contains(c)))
  // A Pages or Settings tab: the hub's tab bar comes first, the screen's header after it.
  const first = main.firstElementChild?.classList.contains('hub-tabs')
    ? main.firstElementChild.nextElementSibling
    : main.firstElementChild
  if (isHeader(first)) return first
  const inner = first?.firstElementChild
  return isHeader(inner) ? (inner ?? null) : null
}

describe('section hue (Tints.dc.html)', () => {
  it('maps every kind of route to its sidebar group hue', () => {
    const cases: readonly (readonly [string, SectionHue | null])[] = [
      ['#/overview', 'visibility'],
      ['#/questions', 'visibility'],
      ['#/topics', 'visibility'],
      ['#/topics/t1', 'visibility'],
      ['#/competitors', 'visibility'],
      ['#/citations', 'visibility'],
      ['#/fixes', 'visibility'],
      ['#/history', 'tracking'],
      ['#/reports', 'tracking'],
      ['#/alerts', 'tracking'],
      ['#/export', 'tracking'],
      ['#/pages', 'site'],
      ['#/pages?view=tree&part=clusters', 'site'],
      ['#/youtube', 'site'],
      ['#/communities', 'site'],
      ['#/pages/p1/results', 'site'],
      ['#/pages/p1/prompt/q1', 'site'],
      ['#/project-settings', 'setup'],
      ['#/connections', 'setup'],
      ['#/settings', 'setup'],
      ['#/templates', 'setup'],
      ['#/ask', null],
      ['#/unavailable', null]
    ]
    for (const [hash, hue] of cases) {
      expect(hueForLocation(parseHash(hash)), hash).toBe(hue)
    }
  })

  it('puts the header of a screen in each group on its band, and marks the sidebar group', async () => {
    for (const [hash, hue, heading, item] of [
      ['#/overview', 'visibility', 'Summary', 'Summary'],
      ['#/history', 'tracking', 'Check history', 'Check history'],
      ['#/pages', 'site', /.+/, 'Pages'],
      // Playground runs on its mock client (Project settings needs the preload bridge).
      ['#/playground', 'setup', 'Playground', 'Settings']
    ] as const) {
      const view = renderAt(hash)
      const main = await view.findByRole('main')
      const h1 = await within(main).findByRole('heading', { level: 1, name: heading })
      expect(main.dataset.hue, hash).toBe(hue)
      const header = bandHeader(main)
      expect(header, hash).not.toBeNull()
      expect(header?.contains(h1), hash).toBe(true)

      const nav = view.getByRole('navigation', { name: 'CiteFox' })
      const current = within(nav).getByRole('link', { name: new RegExp(`^${item}`) })
      expect(current.getAttribute('aria-current'), hash).toBe('page')
      expect(current.closest('.side-group')?.getAttribute('data-hue'), hash).toBe(hue)
      cleanup()
    }
  })

  it('gives every sidebar group its hue; Pinned lists pages, so it is the Pages hue', async () => {
    const view = renderAt('#/overview')
    await view.findByRole('main')
    const nav = view.getByRole('navigation', { name: 'CiteFox' })
    // In order: AI visibility, Tracking, Pinned, then the Pages and Settings items.
    const hues = [...nav.querySelectorAll('.side-group')].map((group) =>
      group.getAttribute('data-hue')
    )
    expect(hues).toEqual(['visibility', 'tracking', 'site', 'site', 'setup'])
  })
})
