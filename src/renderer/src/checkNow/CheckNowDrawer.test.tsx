// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuildToolsContext, ipcBuildClient } from '../buildMenu/buildClient'
import { DrawerHost } from '../shell/DrawerHost'
import { DrawerTrailContext, type RouteCrumb } from '../shell/drawerCrumbs'
import { resetDrawersForTests } from '../shell/drawers'
import { CheckNowPanel } from './CheckNowPanel'
import { fakeSource, job, OPTIONS, type FakeSource } from './fixtures.test-helper'

const ROUTE: RouteCrumb[] = [
  { label: 'TextBolt', href: '#/overview' },
  { label: 'All pages', href: '#/pages', screen: true }
]

let source: FakeSource
const notify = vi.fn()

function settle(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)))
}

function Shell(): JSX.Element {
  return (
    <BuildToolsContext.Provider value={{ client: ipcBuildClient, notify }}>
      <DrawerTrailContext.Provider value={ROUTE}>
        <DrawerHost projectId="p1" />
      </DrawerTrailContext.Provider>
    </BuildToolsContext.Provider>
  )
}

function query(): URLSearchParams {
  const hash = window.location.hash
  return new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'))
  source = fakeSource()
  ;(window as unknown as { citefox: unknown }).citefox = source
  notify.mockReset()
  resetDrawersForTests()
  window.history.replaceState(null, '', '#/start-of-test')
  window.location.hash = '#/pages'
  await settle()
})

afterEach(() => {
  cleanup()
  resetDrawersForTests()
  vi.useRealTimers()
  delete (window as unknown as { citefox?: unknown }).citefox
})

describe('Check now drawer', () => {
  it('opens from its URL with the scope, markets and questions it holds', async () => {
    window.location.hash =
      '#/pages?drawer=check-now&check.scope=group&check.ids=g1&check.markets=mkt-us'
    render(<Shell />)
    const dialog = await screen.findByRole('dialog', { name: 'Check now' })
    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: /A group/ })).toHaveProperty('checked', true)
    )
    expect(within(dialog).getByRole('checkbox', { name: /Money pages/ })).toHaveProperty(
      'checked',
      true
    )
    expect(within(dialog).getByTestId('check-now-cost').textContent).toBe(
      '2 pages · 1 market · About 8–16 searches · 500 left this month'
    )

    fireEvent.click(within(dialog).getByRole('radio', { name: /Only questions not cited/ }))
    await settle()
    expect(query().get('check.only')).toBe('notcited')
    await waitFor(() =>
      expect(within(dialog).getByTestId('check-now-cost').textContent).toBe(
        '1 page · 1 market · 1 question · About 1–2 searches · 500 left this month'
      )
    )
    expect(source['checks:notCited']).toHaveBeenCalledWith({
      projectId: 'p1',
      pageIds: ['a', 'b'],
      marketIds: ['mkt-us']
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Check now' }))
    await settle()
    expect(source['checks:start']).toHaveBeenCalledWith({
      projectId: 'p1',
      pageIds: ['a'],
      marketIds: ['mkt-us'],
      promptIds: ['q2']
    })
    expect(notify).toHaveBeenCalledWith('Checking 1 page · About 1–2 searches', 'ok', {
      label: 'Open results',
      href: '#/pages/a/results'
    })
    expect(screen.queryByRole('dialog', { name: 'Check now' })).toBeNull()
    expect(notify).toHaveBeenLastCalledWith('Check finished for 1 page', 'ok', {
      label: 'Open results',
      href: '#/pages/a/results'
    })
  })

  it('keeps Check now off with the reason, and offers to pick pages when nothing is due', async () => {
    window.location.hash = '#/pages?drawer=check-now&check.scope=due&check.markets=mkt-uk'
    source = fakeSource({
      ...OPTIONS,
      pages: OPTIONS.pages.map((page) => ({
        ...page,
        nextCheckAt: page.tracked ? '2026-11-02T09:00:00.000Z' : null
      }))
    })
    ;(window as unknown as { citefox: unknown }).citefox = source
    render(<Shell />)
    const dialog = await screen.findByRole('dialog', { name: 'Check now' })
    await waitFor(() =>
      expect(within(dialog).getByTestId('check-now-reason').textContent).toBe(
        'Nothing is due. Next check: Nov 2 (2 pages).'
      )
    )
    expect(within(dialog).getByRole('button', { name: 'Check now' })).toHaveProperty(
      'disabled',
      true
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pick pages instead' }))
    await settle()
    expect(query().get('check.scope')).toBe('pages')
    expect(within(dialog).getByTestId('check-now-reason').textContent).toBe(
      'Pick at least one page to check.'
    )
  })

  it('picks questions of one page', async () => {
    window.location.hash =
      '#/pages?drawer=check-now&check.scope=pages&check.ids=b&check.only=picked'
    render(<Shell />)
    const dialog = await screen.findByRole('dialog', { name: 'Check now' })
    const pick = await within(dialog).findByRole('checkbox', { name: /Which plan has scheduled/ })
    fireEvent.click(pick)
    await settle()
    expect(query().get('check.prompts')).toBe('q2')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check now' }))
    await settle()
    expect(source['checks:start']).toHaveBeenCalledWith({
      projectId: 'p1',
      pageIds: ['b'],
      marketIds: null,
      promptIds: ['q2']
    })
  })

  it('opens on the rows ticked on Results: that page, that market, those questions', async () => {
    window.location.hash =
      '#/pages/a/results?sel=q1,q2&drawer=check-now&check.scope=pages&check.ids=a&check.markets=mkt-uk&check.only=picked&check.prompts=q1,q2'
    render(<Shell />)
    const dialog = await screen.findByRole('dialog', { name: 'Check now' })
    const picker = await within(dialog).findByTestId('check-now-question-picker')
    expect(within(picker).getAllByRole('checkbox', { checked: true })).toHaveLength(2)
    expect(within(dialog).getByTestId('check-now-cost').textContent).toContain('2 questions')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check now' }))
    await settle()
    expect(source['checks:start']).toHaveBeenCalledWith({
      projectId: 'p1',
      pageIds: ['a'],
      marketIds: ['mkt-uk'],
      promptIds: ['q1', 'q2']
    })
  })

  it('says a refused check in the toast', async () => {
    source['checks:start'] = vi.fn(async () =>
      job({ status: 'error', message: 'Add a search key.', nextStep: null })
    )
    window.location.hash = '#/pages?drawer=check-now&check.scope=tracked'
    render(<Shell />)
    const dialog = await screen.findByRole('dialog', { name: 'Check now' })
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Check now' })).toHaveProperty(
        'disabled',
        false
      )
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check now' }))
    await settle()
    expect(notify).toHaveBeenLastCalledWith('Add a search key.', 'bad', {
      label: 'See progress',
      href: '#/status'
    })
  })
})

describe('#/check picker', () => {
  it('keeps its choices on the screen URL', async () => {
    window.location.hash = '#/check?check.scope=cluster&check.ids=c1'
    render(
      <BuildToolsContext.Provider value={{ client: ipcBuildClient, notify }}>
        <CheckNowPanel projectId="p1" source={source} />
      </BuildToolsContext.Provider>
    )
    await waitFor(() =>
      expect(screen.getByTestId('check-now-panel-summary').textContent).toBe(
        '1 page · every market · About 8–16 searches · 500 left this month'
      )
    )
    fireEvent.click(screen.getByRole('radio', { name: /Every tracked page/ }))
    await settle()
    expect(window.location.hash).toBe('#/check?check.scope=tracked')
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    await settle()
    expect(source['checks:start']).toHaveBeenCalledWith({
      projectId: 'p1',
      pageIds: ['a', 'b', 'd'],
      marketIds: null,
      promptIds: null
    })
  })
})
