// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThemePreference } from '@shared/domain'
import { onGuideSignal } from '../guide/signals'
import { SEARCH_LABEL, SEARCH_TIP } from './search'
import type { SearchData } from './searchRank'
import { TopBarSearch } from './TopBarSearch'
import type { SearchDataSource } from './useSearchData'

const DATA: SearchData = {
  competitors: [{ id: 'c1', name: 'Twilio', domain: 'twilio.com' }],
  pageFixes: [{ id: 'pf1', title: '/twilio-alternative', kind: 'improve', topics: 'Text alerts' }],
  logged: [],
  reports: [{ id: 'r1', name: 'Twilio watch' }]
}

function Harness({
  source,
  onTheme
}: {
  source: SearchDataSource
  onTheme: (theme: ThemePreference) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  return (
    <>
      <button type="button">Elsewhere</button>
      <TopBarSearch
        projectId="p1"
        foundPageCount={10}
        query={query}
        onQuery={setQuery}
        pages={query ? [] : null}
        questions={query ? { hits: [], more: false, failed: false } : null}
        topics={[{ id: 't1', title: 'Twilio switchers', goalPct: null, href: '#/topics/t1' }]}
        onTheme={onTheme}
        dataSource={source}
      />
    </>
  )
}

function setup(): {
  view: ReturnType<typeof render>
  box: HTMLInputElement
  load: ReturnType<typeof vi.fn>
  onTheme: ReturnType<typeof vi.fn>
} {
  const load = vi.fn(() => Promise.resolve(DATA))
  const onTheme = vi.fn()
  const view = render(<Harness source={{ load }} onTheme={onTheme} />)
  const box = view.getByRole('combobox', { name: SEARCH_LABEL }) as HTMLInputElement
  return { view, box, load, onTheme }
}

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('Ctrl+K finds anything', () => {
  it('empty, it says what to try; opening the box reads the project data once', async () => {
    const { view, box, load } = setup()
    fireEvent.focus(box)
    expect(view.getByTestId('search-tips').textContent).toContain(SEARCH_TIP)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('p1')
    // Typing filters what was read: no more reads per key.
    fireEvent.change(box, { target: { value: 'tw' } })
    fireEvent.change(box, { target: { value: 'twil' } })
    expect(load).toHaveBeenCalledTimes(1)
    expect(view.queryByTestId('search-tips')).toBeNull()
  })

  it('groups results under headings, in order, with every kind of match', async () => {
    const { view, box } = setup()
    window.location.hash = '#/overview'
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'twilio' } })
    const list = await view.findByRole('listbox', { name: 'Search results' })
    await waitFor(() => expect(within(list).getAllByRole('group').length).toBeGreaterThan(3))
    const heads = within(list)
      .getAllByRole('group')
      .map((group) => group.querySelector('.topbar-group-head')?.textContent)
    expect(heads).toEqual(['Topics', 'Competitors', 'Fixes', 'Reports'])
    const rival = within(list).getByRole('option', { name: /Twilio twilio\.com/ })
    expect(rival.getAttribute('href')).toBe('#/overview?drawer=competitor&competitor=c1')
  })

  it('actions come first; "dark mode" switches the theme and the guide hears it', () => {
    const { view, box, onTheme } = setup()
    const heard: string[] = []
    const off = onGuideSignal((signal) => heard.push(signal))
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'dark mode' } })
    const list = view.getByRole('listbox', { name: 'Search results' })
    const heads = [...list.querySelectorAll('.topbar-group-head')].map((head) => head.textContent)
    expect(heads[0]).toBe('Actions')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(box.getAttribute('aria-activedescendant')).toBeTruthy()
    act(() => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    expect(onTheme).toHaveBeenCalledWith('dark')
    expect(heard).toContain('search-used')
    expect(box.value).toBe('')
    off()
  })

  it('a screen opens by its everyday name: "keys" goes to API keys', () => {
    const { view, box } = setup()
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'keys' } })
    const list = view.getByRole('listbox', { name: 'Search results' })
    const screens = [...list.querySelectorAll('[data-group="screens"] [role="option"]')]
    expect(screens[0]?.textContent).toContain('Connections · API keys')
    expect(screens[0]?.getAttribute('href')).toBe('#/connections')
  })

  it('help topics are their own group after the screens, each opening the help drawer', () => {
    const { view, box } = setup()
    window.location.hash = '#/reports'
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'agency logo' } })
    const list = view.getByRole('listbox', { name: 'Search results' })
    const heads = [...list.querySelectorAll('.topbar-group-head')].map((head) => head.textContent)
    expect(heads.slice(0, 2)).toEqual(['Screens & settings', 'Help'])
    const help = within(list).getByRole('option', { name: /Reports branding\s*Help/ })
    expect(help.getAttribute('href')).toBe('#/reports?drawer=help&help.id=reports-branding')
  })
})
