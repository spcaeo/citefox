// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import axe from 'axe-core'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectSummary } from '@shared/domain'
import type { SidebarTopic } from '../shell/sidebarTopics'
import type { ShellLocation } from '../shell/routes'
import { Sidebar } from './Sidebar'

const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

const TOPICS: SidebarTopic[] = [
  {
    id: 't1',
    title: 'Text alerts for teams without a developer',
    goalPct: 42,
    href: '#/topics/t1'
  },
  { id: 't2', title: 'Carrier gateway replacement', goalPct: null, href: '#/topics/t2' }
]

const PROJECT: ProjectSummary = {
  id: 'textbolt',
  name: 'TextBolt',
  slug: 'textbolt',
  domain: 'textbolt.com',
  dbPath: '',
  clientName: null,
  status: 'active'
}

function Harness({
  start = false,
  location = { kind: 'section', section: 'overview' },
  active = null,
  topics = TOPICS
}: {
  start?: boolean
  location?: ShellLocation
  active?: ProjectSummary | null
  topics?: SidebarTopic[]
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(start)
  return (
    <Sidebar
      location={location}
      projects={active ? [active] : []}
      active={active}
      foundPageCount={358}
      pinned={[]}
      tray={null}
      onSelectProject={() => undefined}
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed((value) => !value)}
      topics={topics}
    />
  )
}

function groupButton(view: ReturnType<typeof render>, name: RegExp): HTMLElement {
  return view.getByRole('button', { name })
}

afterEach(() => {
  cleanup()
  window.location.hash = ''
  localStorage.clear()
})

describe('Sidebar collapse', () => {
  it('collapses to the rail and back with one labelled toggle', async () => {
    const view = render(<Harness />)
    const nav = view.getByRole('navigation', { name: 'CiteFox' })
    const toggle = within(nav).getByRole('button', { name: 'Collapse sidebar' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(toggle)
    expect(nav.hasAttribute('data-collapsed')).toBe(true)
    const expand = within(nav).getByRole('button', { name: 'Expand sidebar' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    // Links keep their names and get a tooltip in the rail; every group shows its items.
    const overview = within(nav).getByRole('link', { name: 'Summary' })
    expect(overview.getAttribute('data-tip')).toBe('Summary')
    expect(overview.getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('link', { name: 'Settings' })).toBeTruthy()
    expect(within(nav).getByRole('button', { name: 'Add' })).toBeTruthy()
    expect((await axe.run(view.container, RULES)).violations).toEqual([])

    fireEvent.click(expand)
    expect(nav.hasAttribute('data-collapsed')).toBe(false)
  })

  it('has no page search box: search moved to the top bar', () => {
    const view = render(<Harness />)
    expect(view.queryByRole('searchbox')).toBeNull()
  })

  it('keeps one Topics item with its count, no topic list under it, current inside a topic', () => {
    window.location.hash = '#/topics/t1'
    const view = render(<Harness location={{ kind: 'topic', pageId: 't1', tab: 'tree' }} />)
    const topics = view.getByRole('link', { name: /^Topics 2/ })
    expect(topics.getAttribute('href')).toBe('#/topics')
    expect(topics.getAttribute('aria-current')).toBe('page')
    expect(
      view.queryByRole('link', { name: /Text alerts for teams without a developer/ })
    ).toBeNull()
    expect(view.queryByRole('link', { name: /Carrier gateway replacement/ })).toBeNull()
  })

  it('links Topics to the Topics screen even when there is no topic yet', () => {
    const view = render(<Harness topics={[]} />)
    expect(view.getByRole('link', { name: /^Topics/ }).getAttribute('href')).toBe('#/topics')
  })

  it('shows the silver sponsor card, and only its mark in the rail', () => {
    const view = render(<Harness />)
    expect(view.getByRole('complementary', { name: 'Silver sponsor' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Collapse sidebar' }))
    expect(view.queryByRole('complementary', { name: 'Silver sponsor' })).toBeNull()
    expect(view.getByRole('link', { name: /FreshlyCited, silver sponsor/ })).toBeTruthy()
  })
})

describe('Sidebar groups', () => {
  it('orders the groups and their items, then one Pages and one Settings item', () => {
    const view = render(<Harness />)
    const heads = view
      .getAllByRole('button')
      .filter((button) => button.classList.contains('side-group-head'))
      .map((button) => button.querySelector('.side-group-label')?.textContent)
    // No pinned pages: no Pinned group. Pages and Settings are items, not groups.
    expect(heads).toEqual(['AI visibility', 'Tracking'])
    const links = view
      .getAllByRole('link')
      .map((link) => link.querySelector('.nav-text')?.textContent)
      .filter(Boolean)
    expect(links).toEqual([
      'Summary',
      'Questions',
      'Topics',
      'Competitors',
      'Citations',
      'Fixes',
      'Check history',
      'Reports',
      'Alerts & schedules',
      'Pages',
      'Settings'
    ])
    expect(view.getByRole('link', { name: 'Pages 358' }).getAttribute('href')).toBe('#/pages')
    expect(view.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe(
      '#/project-settings'
    )
    expect(view.queryByRole('link', { name: 'YouTube' })).toBeNull()
    expect(view.queryByRole('link', { name: 'Connections' })).toBeNull()
  })

  it('opens AI visibility and Tracking and hides an empty Pinned', () => {
    const view = render(<Harness />)
    expect(groupButton(view, /^AI visibility/).getAttribute('aria-expanded')).toBe('true')
    expect(groupButton(view, /^Tracking/).getAttribute('aria-expanded')).toBe('true')
    expect(view.queryByRole('button', { name: /^Pinned/ })).toBeNull()
  })

  it('folds and opens a group from its header and remembers it per project', () => {
    const first = render(<Harness active={PROJECT} />)
    fireEvent.click(groupButton(first, /^Tracking/))
    expect(first.queryByRole('link', { name: 'Reports' })).toBeNull()
    first.unmount()

    const again = render(<Harness active={PROJECT} />)
    expect(groupButton(again, /^Tracking/).getAttribute('aria-expanded')).toBe('false')
    again.unmount()

    // Another project keeps its own choice (the defaults here).
    const other = render(<Harness active={{ ...PROJECT, id: 'acme' }} />)
    expect(groupButton(other, /^Tracking/).getAttribute('aria-expanded')).toBe('true')
  })

  it('falls back to the defaults when storage holds something else', () => {
    localStorage.setItem('citefox.sidebarGroups.textbolt', 'not json')
    const view = render(<Harness active={PROJECT} />)
    expect(groupButton(view, /^Tracking/).getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps Settings current on every Settings tab, and Pages on every Pages tab', () => {
    for (const section of ['project-settings', 'connections', 'settings', 'permissions'] as const) {
      const view = render(<Harness active={PROJECT} location={{ kind: 'section', section }} />)
      expect(view.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBe('page')
      expect(view.getByRole('link', { name: 'Pages 358' }).getAttribute('aria-current')).toBeNull()
      view.unmount()
    }
    for (const section of ['pages', 'youtube', 'communities'] as const) {
      const view = render(<Harness active={PROJECT} location={{ kind: 'section', section }} />)
      expect(view.getByRole('link', { name: 'Pages 358' }).getAttribute('aria-current')).toBe(
        'page'
      )
      expect(view.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBeNull()
      view.unmount()
    }
  })
})

describe('+ Add menu', () => {
  it('opens four paths with their links and closes on Escape', () => {
    window.location.hash = '#/competitors?period=30d'
    const view = render(<Harness />)
    const button = view.getByRole('button', { name: /^Add$/ })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const menu = view.getByRole('list', { name: 'Add' })
    const entries = within(menu)
      .getAllByRole('link')
      .map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')])
    expect(entries).toEqual([
      ['Questions', '#/competitors?period=30d&drawer=add-questions'],
      ['Topic', '#/competitors?period=30d&drawer=new-topic'],
      ['Page to track', '#/competitors?period=30d&drawer=add-page'],
      ['Import: Excel or CSV file', '#/competitors?period=30d&drawer=add-questions&tab=import'],
      ['Import: Sitemap', '#/import-pages']
    ])
    // The two file entries sit under one Import heading; every entry has its own icon.
    expect(menu.textContent).toContain('Import')
    expect(menu.querySelectorAll('.side-add-heading')).toHaveLength(1)
    expect(menu.querySelectorAll('.side-add-item svg')).toHaveLength(5)
    expect(within(menu).getByRole('link', { name: 'Page to track' }).textContent).toContain(
      'Pick from your 358 pages or paste a URL'
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  })

  it('opens Add questions over the landing route from an empty hash', () => {
    const view = render(<Harness />)
    fireEvent.click(view.getByRole('button', { name: /^Add$/ }))
    const menu = view.getByRole('list', { name: 'Add' })
    expect(within(menu).getByRole('link', { name: 'Questions' }).getAttribute('href')).toBe(
      '#/?drawer=add-questions'
    )
  })
})
