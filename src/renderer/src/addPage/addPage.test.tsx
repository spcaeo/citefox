// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuildToolsContext, ipcBuildClient } from '../buildMenu/buildClient'
import { fakeSource, type FakeSource } from '../checkNow/fixtures.test-helper'
import { DrawerHost } from '../shell/DrawerHost'
import { DrawerTrailContext, type RouteCrumb } from '../shell/drawerCrumbs'
import { resetDrawersForTests } from '../shell/drawers'
import {
  addPageParamsPatch,
  checkedAddress,
  otherSite,
  parseAddPageParams,
  pastedAddresses,
  trackedMatch,
  typedQuestions
} from './model'
import { addQuestionsWhenReady } from './pendingQuestions'
import { OPTIONS } from '../checkNow/fixtures.test-helper'

const ROUTE: RouteCrumb[] = [
  { label: 'TextBolt', href: '#/overview' },
  { label: 'All pages', href: '#/pages', screen: true }
]

let source: FakeSource
const notify = vi.fn()
const onPageAdded = vi.fn()

function settle(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)))
}

function Shell(): JSX.Element {
  return (
    <BuildToolsContext.Provider value={{ client: ipcBuildClient, notify }}>
      <DrawerTrailContext.Provider value={ROUTE}>
        <DrawerHost projectId="p1" onPageAdded={onPageAdded} />
      </DrawerTrailContext.Provider>
    </BuildToolsContext.Provider>
  )
}

function query(): URLSearchParams {
  const hash = window.location.hash
  return new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
}

beforeEach(async () => {
  source = fakeSource()
  ;(window as unknown as { citefox: unknown }).citefox = source
  notify.mockReset()
  onPageAdded.mockReset()
  resetDrawersForTests()
  window.history.replaceState(null, '', '#/start-of-test')
  window.location.hash = '#/pages'
  await settle()
})

afterEach(() => {
  cleanup()
  resetDrawersForTests()
  delete (window as unknown as { citefox?: unknown }).citefox
})

describe('Add a page model', () => {
  it('reads and writes addpage.* values', () => {
    const state = parseAddPageParams({
      'addpage.url': '/pricing',
      'addpage.group': 'g1',
      'addpage.questions': 'type',
      'addpage.count': '6'
    })
    expect(state).toEqual({
      url: '/pricing',
      label: '',
      groupId: 'g1',
      topicId: null,
      way: 'type',
      count: 6
    })
    expect(addPageParamsPatch({ way: 'claude', count: 10, label: '' })).toEqual({
      'addpage.questions': null,
      'addpage.count': null,
      'addpage.label': null
    })
    expect(parseAddPageParams({ 'addpage.count': '999' }).count).toBe(10)
  })

  it('checks the address, spots tracked pages, other sites and pasted lists', () => {
    expect(checkedAddress('/pricing', 'textbolt.com')).toEqual({
      url: 'https://textbolt.com/pricing',
      problem: null
    })
    expect(checkedAddress('ftp://x', 'textbolt.com').problem).toMatch(/http or https/)
    expect(trackedMatch('https://www.textbolt.com/blog/a', OPTIONS.pages)?.id).toBe('a')
    expect(trackedMatch('https://textbolt.com/blog/c/', OPTIONS.pages)).toBeNull()
    expect(otherSite('https://blog.textbolt.com/x', 'textbolt.com')).toBeNull()
    expect(otherSite('https://twilio.com/x', 'textbolt.com')).toBe('twilio.com')
    expect(pastedAddresses('https://a.com/1\nhttps://a.com/2, /three')).toHaveLength(3)
    expect(pastedAddresses('https://a.com/1')).toHaveLength(1)
    expect(typedQuestions(' One?\n\none?\nTwo? ')).toEqual(['One?', 'Two?'])
  })
})

describe('Add a page drawer', () => {
  it('opens from its URL, says when a page is already tracked or several were pasted', async () => {
    window.location.hash = `#/pages?drawer=add-page&addpage.url=${encodeURIComponent('https://textbolt.com/blog/a/')}`
    render(<Shell />)
    const dialog = await screen.findByRole('dialog', { name: 'Add a page' })
    expect(await within(dialog).findByTestId('add-page-tracked')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe(
      '#/pages/a/results'
    )
    expect(within(dialog).getByRole('button', { name: 'Add page' })).toHaveProperty(
      'disabled',
      true
    )

    fireEvent.change(within(dialog).getByLabelText('Page URL'), {
      target: { value: 'https://textbolt.com/x https://textbolt.com/y' }
    })
    await settle()
    const many = within(dialog).getByTestId('add-page-many')
    expect(
      within(many).getByRole('link', { name: 'Import 2 pages instead' }).getAttribute('href')
    ).toBe('#/import-pages')
  })

  it('adds the page with its label and group, then hands it to the shell', async () => {
    window.location.hash = '#/pages?drawer=add-page&addpage.group=g1'
    render(<Shell />)
    const dialog = await screen.findByRole('dialog', { name: 'Add a page' })
    const url = await within(dialog).findByLabelText('Page URL')
    fireEvent.change(url, { target: { value: '/pricing' } })
    await settle()
    expect(query().get('addpage.url')).toBe('/pricing')
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: 'Pricing' } })
    await settle()
    expect(query().get('addpage.label')).toBe('Pricing')
    expect(within(dialog).getByRole('combobox', { name: 'Add to group' })).toHaveProperty(
      'value',
      'g1'
    )
    expect(within(dialog).getByTestId('add-page-cost').textContent).toContain(
      'Checking uses about 10–20 searches · 500 left this month'
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and check now' }))
    await waitFor(() => expect(onPageAdded).toHaveBeenCalledWith('new-page'))
    expect(source['pages:add']).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        url: 'https://textbolt.com/pricing',
        promptCount: 10,
        checkWhenReady: true
      })
    )
    expect(source['pages:update']).toHaveBeenCalledWith({
      projectId: 'p1',
      pageId: 'new-page',
      label: 'Pricing'
    })
    expect(source['structure:setGroupPages']).toHaveBeenCalledWith({
      projectId: 'p1',
      groupId: 'g1',
      add: ['new-page'],
      remove: []
    })
    expect(notify.mock.calls[0]?.[0]).toMatch(
      /^Added Pricing\. CiteFox reads it, drafts its questions, then checks it/
    )
  })

  it('adds typed questions once the page has its drafted questions', async () => {
    source['prompts:addQuestions'] = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('Write the buyer profile for this page before adding questions.')
      )
      .mockResolvedValueOnce({ pageId: 'new-page', promptIds: ['n1', 'n2'] })
    const stop = addQuestionsWhenReady(source, notify, 'p1', 'new-page', ['One?', 'Two?'])
    await settle()
    expect(notify).not.toHaveBeenCalled()
    source.progress({
      projectId: 'p1',
      pageId: 'new-page',
      step: 'prompts',
      state: 'done',
      message: '',
      status: {} as never
    })
    await settle()
    expect(source['prompts:addQuestions']).toHaveBeenLastCalledWith({
      projectId: 'p1',
      pageId: 'new-page',
      questions: [{ text: 'One?' }, { text: 'Two?' }]
    })
    expect(notify).toHaveBeenCalledWith('Added 2 questions you typed', 'ok', {
      label: 'See questions',
      href: '#/pages/new-page/prompts'
    })
    stop()
  })
})
