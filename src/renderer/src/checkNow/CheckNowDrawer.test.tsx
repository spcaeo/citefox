// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuildToolsContext, ipcBuildClient } from '../buildMenu/buildClient'
import { DrawerHost } from '../shell/DrawerHost'
import { DrawerTrailContext, type RouteCrumb } from '../shell/drawerCrumbs'
import { resetDrawersForTests } from '../shell/drawers'
import { CheckNowPanel } from './CheckNowPanel'
import { fakeSource, job, OPTIONS, projectCheck, type FakeSource } from './fixtures.test-helper'

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
        'Nothing is due. Next check: Nov 2 (2 pages). Choose “Everything again” to run all 18 questions now.'
      )
    )
    expect(within(dialog).getByRole('button', { name: 'Check now' })).toHaveProperty(
      'disabled',
      true
    )
    // The way out is one press: run everything again (in the market that was picked).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run all 18 questions again' }))
    await settle()
    expect(query().get('check.scope')).toBe('all')
    await waitFor(() =>
      expect(within(dialog).getByTestId('check-now-cost').textContent).toBe(
        '1 page · 1 topic · 1 market · 10 questions · About 10–20 searches · 500 left this month'
      )
    )
    expect(within(dialog).getByRole('button', { name: 'Check now' })).toHaveProperty(
      'disabled',
      false
    )
  })

  it('offers to pick pages when there is no question to run again', async () => {
    window.location.hash = '#/pages?drawer=check-now&check.scope=due'
    source = fakeSource({ ...OPTIONS, pages: [], topics: [] })
    ;(window as unknown as { citefox: unknown }).citefox = source
    render(<Shell />)
    const dialog = await screen.findByRole('dialog', { name: 'Check now' })
    await waitFor(() =>
      expect(within(dialog).getByTestId('check-now-reason').textContent).toBe(
        'Nothing is due and nothing is scheduled.'
      )
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pick pages instead' }))
    await settle()
    expect(query().get('check.scope')).toBe('pages')
    expect(within(dialog).getByTestId('check-now-reason').textContent).toBe(
      'Pick at least one page to check.'
    )
  })

  it('opens on the first scope with something to check when the link has none', async () => {
    window.location.hash = '#/pages?drawer=check-now'
    source = fakeSource({
      ...OPTIONS,
      pages: OPTIONS.pages.map((page) => ({ ...page, nextCheckAt: null }))
    })
    ;(window as unknown as { citefox: unknown }).citefox = source
    render(<Shell />)
    const dialog = await screen.findByRole('dialog', { name: 'Check now' })
    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: /Every tracked page/ })).toHaveProperty(
        'checked',
        true
      )
    )
    expect(within(dialog).getByRole('button', { name: 'Check now' })).toHaveProperty(
      'disabled',
      false
    )
  })

  it('retries only the questions that failed last time', async () => {
    window.location.hash = '#/pages?drawer=check-now&check.scope=tracked&check.only=failed'
    source = fakeSource(OPTIONS, undefined, [
      projectCheck({ failedPromptIds: ['q1', 'q2'] }),
      projectCheck({ runId: 'b', pageId: 'b', failedPromptIds: [] })
    ])
    ;(window as unknown as { citefox: unknown }).citefox = source
    render(<Shell />)
    const dialog = await screen.findByRole('dialog', { name: 'Check now' })
    await waitFor(() =>
      expect(within(dialog).getByTestId('check-now-cost').textContent).toBe(
        '1 page · 1 market · 2 questions · About 2–4 searches · 500 left this month'
      )
    )
    expect(within(dialog).getByText('2 questions had no result in their last check.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check now' }))
    await settle()
    expect(source['checks:start']).toHaveBeenCalledWith({
      projectId: 'p1',
      pageIds: ['a'],
      marketIds: ['mkt-us'],
      promptIds: ['q1', 'q2']
    })
  })

  it('switches the failed choice off when nothing failed', async () => {
    window.location.hash = '#/pages?drawer=check-now&check.scope=tracked'
    render(<Shell />)
    const dialog = await screen.findByRole('dialog', { name: 'Check now' })
    await waitFor(() =>
      expect(
        within(dialog).getByRole('radio', { name: /Only the ones that failed last time/ })
      ).toHaveProperty('disabled', true)
    )
    expect(within(dialog).getByText('Nothing failed last time.')).toBeTruthy()
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

  describe('when nothing is due and the project has one topic', () => {
    // The tester's project: no tracked pages, one topic of 8 questions.
    const topicOnly = {
      ...OPTIONS,
      pages: [],
      topics: [{ id: 't1', name: '10DLC', kind: 'topic' as const, count: 0, questions: 8 }]
    }

    function renderPanel(): void {
      render(
        <BuildToolsContext.Provider value={{ client: ipcBuildClient, notify }}>
          <CheckNowPanel projectId="p1" source={source} />
        </BuildToolsContext.Provider>
      )
    }

    beforeEach(() => {
      source = fakeSource(topicOnly, undefined, [
        projectCheck({ pageId: 't1', failedPromptIds: ['q1', 'q2', 'q3'] })
      ])
    })

    it('opens with the topic chosen and Check now on', async () => {
      window.location.hash = '#/check'
      renderPanel()
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: /A topic/ })).toHaveProperty('checked', true)
      )
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Check now' })).toHaveProperty('disabled', false)
      )
      expect(screen.getByTestId('check-now-panel-summary').textContent).toBe(
        '1 topic · every market · About 16–32 searches · 500 left this month'
      )
    })

    it('runs everything again, and keeps that choice on the URL', async () => {
      window.location.hash = '#/check'
      renderPanel()
      fireEvent.click(await screen.findByRole('radio', { name: /Everything again/ }))
      await settle()
      expect(window.location.hash).toBe('#/check?check.scope=all')
      await waitFor(() =>
        expect(screen.getByTestId('check-now-panel-summary').textContent).toBe(
          '1 topic · every market · 8 questions · About 16–32 searches · 500 left this month'
        )
      )
      fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
      await settle()
      expect(source['checks:start']).toHaveBeenCalledWith({
        projectId: 'p1',
        pageIds: ['t1'],
        marketIds: null,
        promptIds: null
      })
    })

    it('retries only the failed questions, and keeps that choice on the URL', async () => {
      window.location.hash = '#/check'
      renderPanel()
      fireEvent.click(await screen.findByRole('radio', { name: /Only the ones that failed/ }))
      await settle()
      expect(window.location.hash).toBe('#/check?check.only=failed')
      await waitFor(() =>
        expect(screen.getByTestId('check-now-panel-summary').textContent).toBe(
          '1 topic · 1 market · 3 questions · About 3–6 searches · 500 left this month'
        )
      )
      fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
      await settle()
      expect(source['checks:start']).toHaveBeenCalledWith({
        projectId: 'p1',
        pageIds: ['t1'],
        marketIds: ['mkt-us'],
        promptIds: ['q1', 'q2', 'q3']
      })
    })

    it('says why Check now is off on "Everything due" and offers the way out', async () => {
      window.location.hash = '#/check?check.scope=due'
      renderPanel()
      await waitFor(() =>
        expect(screen.getByTestId('check-now-panel-summary').textContent).toBe(
          'Nothing is due and nothing is scheduled. Choose “Everything again” to run all 8 questions now.'
        )
      )
      expect(screen.getByRole('button', { name: 'Check now' })).toHaveProperty('disabled', true)
      fireEvent.click(screen.getByRole('button', { name: 'Run all 8 questions again' }))
      await settle()
      expect(window.location.hash).toBe('#/check?check.scope=all')
      expect(screen.getByRole('button', { name: 'Check now' })).toHaveProperty('disabled', false)
    })

    it('links to the schedule', async () => {
      window.location.hash = '#/check'
      renderPanel()
      const link = await screen.findByRole('link', { name: /Run this automatically/ })
      expect(link.getAttribute('href')).toBe('#/project-settings?tab=schedule')
    })
  })
})
