// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuildToolsContext, ipcBuildClient } from '../buildMenu/buildClient'
import { resetDrawersForTests } from '../shell/drawers'
import { PageCheckButton } from './PageCheckButton'
import { fakeSource, UK, US, type FakeSource } from './fixtures.test-helper'

let source: FakeSource
const notify = vi.fn()

function settle(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)))
}

function button(marketId = 'mkt-uk'): JSX.Element {
  return (
    <BuildToolsContext.Provider value={{ client: ipcBuildClient, notify }}>
      <PageCheckButton
        projectId="p1"
        pageId="a"
        kind="page"
        marketId={marketId}
        markets={[US, UK]}
        samples={1}
        href="#/pages/a/running"
        primary
        source={source}
      />
    </BuildToolsContext.Provider>
  )
}

function renderButton(): ReturnType<typeof render> {
  return render(button())
}

beforeEach(async () => {
  source = fakeSource()
  notify.mockReset()
  resetDrawersForTests()
  window.history.replaceState(null, '', '#/start-of-test')
  window.location.hash = '#/pages/a/results'
  await settle()
})

afterEach(() => {
  cleanup()
  resetDrawersForTests()
})

describe('page Check now ▾', () => {
  it('keeps the button on the check screen and lists narrower checks with their cost', async () => {
    renderButton()
    expect(screen.getByRole('link', { name: 'Check now' }).getAttribute('href')).toBe(
      '#/pages/a/running'
    )
    fireEvent.click(screen.getByRole('button', { name: 'More ways to check this page' }))
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: /All markets/ }).textContent).toContain(
        'About 4–8 searches'
      )
    )
    expect(screen.getByRole('menuitem', { name: /This market \(/ }).textContent).toContain(
      'About 2–4 searches'
    )
    // Scoped to the header market (UK): one question there.
    expect(screen.getByRole('menuitem', { name: /Only not cited/ }).textContent).toContain(
      'About 1–2 searches'
    )
    expect(source['checks:notCited']).toHaveBeenCalledWith({
      projectId: 'p1',
      pageIds: ['a'],
      marketIds: ['mkt-uk']
    })

    fireEvent.click(screen.getByRole('menuitem', { name: /This market \(/ }))
    await settle()
    expect(source['checks:start']).toHaveBeenCalledWith({
      projectId: 'p1',
      pageIds: ['a'],
      marketIds: ['mkt-uk'],
      promptIds: null
    })
    expect(window.location.hash).toBe('#/pages/a/running')
  })

  it('checks only the questions not cited last time in the header market', async () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'More ways to check this page' }))
    const item = await screen.findByRole('menuitem', { name: /Only not cited/ })
    await waitFor(() => expect(item.getAttribute('aria-disabled')).not.toBe('true'))
    fireEvent.click(item)
    await settle()
    expect(source['checks:start']).toHaveBeenCalledWith({
      projectId: 'p1',
      pageIds: ['a'],
      marketIds: ['mkt-uk'],
      promptIds: ['q2']
    })
  })

  it('reads the not-cited questions again for another header market', async () => {
    const view = renderButton()
    const toggle = (): void => {
      fireEvent.click(screen.getByRole('button', { name: 'More ways to check this page' }))
    }
    toggle()
    await screen.findByRole('menuitem', { name: /Only not cited last time \(🇬🇧/ })
    toggle()
    view.rerender(button('mkt-us'))
    toggle()
    await screen.findByRole('menuitem', { name: /Only not cited last time \(🇺🇸/ })
    await waitFor(() =>
      expect(source['checks:notCited']).toHaveBeenLastCalledWith({
        projectId: 'p1',
        pageIds: ['a'],
        marketIds: ['mkt-us']
      })
    )
  })

  it('opens Check now on this page to pick questions, or to choose anything', async () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'More ways to check this page' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Only questions I pick/ }))
    await settle()
    expect(window.location.hash).toBe(
      '#/pages/a/results?drawer=check-now&check.scope=pages&check.ids=a&check.only=picked'
    )
    fireEvent.click(screen.getByRole('button', { name: 'More ways to check this page' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Choose what to check/ }))
    await settle()
    expect(window.location.hash).toBe(
      '#/pages/a/results?drawer=check-now&check.scope=pages&check.ids=a'
    )
  })
})

describe('page Check now with rows ticked on Results', () => {
  it('opens Check now on exactly the ticked questions in the header market', async () => {
    window.location.hash = '#/pages/a/results?sel=q1,q3'
    await settle()
    renderButton()
    const button = screen.getByTestId('page-check-selected')
    expect(button.textContent).toBe('Check 2 selected questions')
    expect(screen.queryByRole('link', { name: 'Check now' })).toBeNull()
    fireEvent.click(button)
    await settle()
    expect(window.location.hash).toBe(
      '#/pages/a/results?sel=q1%2Cq3&drawer=check-now&check.scope=pages&check.ids=a&check.markets=mkt-uk&check.only=picked&check.prompts=q1%2Cq3'
    )
    expect(source['checks:start']).not.toHaveBeenCalled()
  })

  it('lists the ticked questions first in the menu and falls back once they are cleared', async () => {
    window.location.hash = '#/pages/a/results?sel=q2'
    await settle()
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'More ways to check this page' }))
    const item = await screen.findByRole('menuitem', { name: /Only the 1 selected question/ })
    expect(item.textContent).toContain('In ')
    act(() => {
      window.location.hash = '#/pages/a/results'
    })
    await settle()
    expect(screen.getByRole('link', { name: 'Check now' })).toBeTruthy()
  })
})
