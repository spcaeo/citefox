// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HELP_TOPIC_IDS } from '@shared/help'
import { DrawerHost } from '../shell/DrawerHost'
import { currentDrawers, resetDrawersForTests } from '../shell/drawers'
import { searchGroups } from '../shell/search'
import { helpHref, helpSections, helpTopic, helpTopics, helpTopicsFor, openHelp } from '.'

describe('help topics', () => {
  it('loads every listed topic from Docs/help, in order', () => {
    expect(helpTopics().map((topic) => topic.id)).toEqual([...HELP_TOPIC_IDS])
    for (const id of HELP_TOPIC_IDS) {
      const topic = helpTopic(id)
      expect(topic?.title, id).toBeTruthy()
      expect(topic?.summary, id).toBeTruthy()
      expect(helpSections(id).length, id).toBeGreaterThan(0)
    }
    expect(helpTopic('nope')).toBeNull()
    expect(helpTopic(null)).toBeNull()
    expect(helpSections('nope')).toEqual([])
  })

  it('splits a topic by its ## headings', () => {
    const sections = helpSections('reports-branding')
    expect(sections.map((section) => section.heading)).toContain('Common questions')
    expect(sections.find((section) => section.slug === 'how-to-add-your-logo')?.body).toContain(
      'Add logo'
    )
    expect(helpTopic('reports-branding')?.questions).toContain('How do I add my agency logo?')
  })

  it('lists a screen’s topics, then the ones for every screen', () => {
    const ids = helpTopicsFor('reports').map((topic) => topic.id)
    expect(ids.slice(0, 2)).toEqual(['reports', 'reports-visibility'])
    expect(ids).toContain('reports-branding')
    expect(ids.slice(-2)).toEqual(['getting-started', 'glossary'])
    expect(ids).not.toContain('fixes')
  })
})

describe('openHelp', () => {
  beforeEach(() => {
    window.location.hash = '#/reports?report=impact'
    resetDrawersForTests()
  })
  afterEach(() => {
    cleanup()
    window.location.hash = ''
  })

  it('links and opens a topic over the screen open now', () => {
    expect(helpHref('glossary')).toBe('#/reports?report=impact&drawer=help&help.id=glossary')
    expect(helpHref('fixes', '#/overview')).toBe('#/overview?drawer=help&help.id=fixes')
    act(() => openHelp('reports-impact'))
    expect(window.location.hash).toBe('#/reports?report=impact&drawer=help&help.id=reports-impact')
    expect(currentDrawers()).toEqual([{ id: 'help', params: { 'help.id': 'reports-impact' } }])
  })

  it('shows the topic as rendered markdown, with no project open', async () => {
    window.location.hash = '#/projects?drawer=help&help.id=reports-branding'
    resetDrawersForTests()
    render(<DrawerHost projectId={null} />)
    const drawer = await screen.findByTestId('help-drawer')
    expect(within(drawer).getByRole('heading', { name: 'Reports branding' })).toBeTruthy()
    const body = drawer.querySelector('[data-help-topic="reports-branding"]')
    expect(body?.querySelector('h3')?.textContent).toBe('Who reports are from')
    expect(body?.querySelectorAll('li').length).toBeGreaterThan(2)
    expect(body?.querySelector('strong')?.textContent).toBe('Settings › App settings › Reports')
    expect(body?.textContent).not.toContain('##')
    expect(body?.textContent).not.toContain('**')
    // Another topic swaps in place; Back returns to this one.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Impact review' }))
    expect(window.location.hash).toContain('help.id=reports-impact')
    expect(await screen.findByRole('heading', { name: 'Impact review' })).toBeTruthy()
  })

  it('lists every topic when the id is missing or unknown', async () => {
    window.location.hash = '#/overview?drawer=help&help.id=nope'
    resetDrawersForTests()
    render(<DrawerHost projectId="p1" />)
    const drawer = await screen.findByTestId('help-drawer')
    expect(within(drawer).getByText('That help topic was not found.')).toBeTruthy()
    expect(within(drawer).getAllByRole('button', { name: /./ }).length).toBeGreaterThan(
      HELP_TOPIC_IDS.length
    )
  })
})

describe('Ctrl+K groups', () => {
  it('puts help after screens and before topics', () => {
    const option = { key: 'k', href: '#/', text: 'x', detail: null }
    const groups = searchGroups({
      actions: [option],
      screens: [{ ...option, key: 's' }],
      help: [{ ...option, key: 'h' }],
      topics: [{ id: 't1', title: 'T', goalPct: null, href: '#/topics/t1' }],
      pages: [],
      questions: []
    })
    expect(groups.map((group) => group.heading)).toEqual([
      'Actions',
      'Screens & settings',
      'Help',
      'Topics'
    ])
  })
})
