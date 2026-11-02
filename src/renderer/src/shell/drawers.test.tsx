// @vitest-environment happy-dom
import type { JSX } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeAllDrawers,
  closeDrawer,
  closeDrawersThen,
  currentDrawers,
  drawerHref,
  openDrawer,
  registerDrawerGuard,
  resetDrawersForTests,
  setDrawerParams,
  useDrawerEntry,
  useDrawerStack
} from './drawers'
import { navigateHash } from './routes'

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

async function goBack(): Promise<void> {
  window.history.back()
  await settle()
}

function ids(): string {
  return currentDrawers()
    .map((entry) => entry.id)
    .join(' > ')
}

beforeEach(async () => {
  resetDrawersForTests()
  window.history.replaceState(null, '', '#/start-of-test')
  navigateHash('#/topics?sort=name')
  await settle()
})

afterEach(() => {
  cleanup()
  resetDrawersForTests()
})

describe('drawer history', () => {
  it('opens as a new entry, and Back closes it', async () => {
    openDrawer('add-questions', { target: 't1' })
    await settle()
    expect(window.location.hash).toBe('#/topics?sort=name&drawer=add-questions&target=t1')
    expect(ids()).toBe('add-questions')
    await goBack()
    expect(window.location.hash).toBe('#/topics?sort=name')
    expect(ids()).toBe('')
  })

  it('closing goes back instead of adding an entry, so Back leaves the screen (no dead step)', async () => {
    openDrawer('add-questions')
    await settle()
    closeDrawer()
    await settle()
    expect(window.location.hash).toBe('#/topics?sort=name')
    await goBack()
    expect(window.location.hash).toBe('#/start-of-test')
  })

  it('closing after steps inside the drawer returns to the screen it opened over', async () => {
    openDrawer('new-topic')
    await settle()
    setDrawerParams(0, { step: 'questions' }, { push: true })
    await settle()
    setDrawerParams(0, { step: 'pages' }, { push: true })
    await settle()
    expect(window.location.hash).toBe('#/topics?sort=name&drawer=new-topic&step=pages')
    closeDrawer()
    await settle()
    expect(window.location.hash).toBe('#/topics?sort=name')
  })

  it('keeps the Back step when a render reads the URL before the hashchange lands', async () => {
    openDrawer('add-questions')
    // The opener's own state change renders at once, before the event.
    expect(ids()).toBe('add-questions')
    await settle()
    closeDrawer()
    await settle()
    expect(window.location.hash).toBe('#/topics?sort=name')
    await goBack()
    expect(window.location.hash).toBe('#/start-of-test')
  })

  it('a followed link read by a render before its event still closes through history', async () => {
    // A + Add link: the menu closes and renders before the hashchange arrives.
    // As in Chromium, the new entry's state starts empty.
    expect(ids()).toBe('')
    window.history.pushState(null, '', '#/topics?sort=name&drawer=add-questions')
    expect(ids()).toBe('add-questions')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await settle()
    closeDrawer()
    await settle()
    expect(window.location.hash).toBe('#/topics?sort=name')
    await goBack()
    expect(window.location.hash).toBe('#/start-of-test')
  })

  it('shows a close at once, before its history step lands', async () => {
    openDrawer('add-questions')
    await settle()
    closeDrawer()
    expect(ids()).toBe('')
    await settle()
    expect(window.location.hash).toBe('#/topics?sort=name')
  })

  it('an open during a close waits for the step, then becomes the new entry', async () => {
    openDrawer('add-questions', { target: 'a' })
    await settle()
    closeDrawer()
    openDrawer('compare', { 'read-from': 's1', 'read-to': 's2' })
    expect(ids()).toBe('compare')
    await settle()
    expect(window.location.hash).toBe('#/topics?sort=name&drawer=compare&read-from=s1&read-to=s2')
    await goBack()
    expect(window.location.hash).toBe('#/topics?sort=name')
    expect(ids()).toBe('')
  })

  it('a drawer opened during a close can be closed before it reaches history', async () => {
    openDrawer('add-questions')
    await settle()
    closeDrawer()
    openDrawer('compare', { 'read-from': 's1', 'read-to': 's2' })
    closeDrawer()
    expect(ids()).toBe('')
    await settle()
    expect(window.location.hash).toBe('#/topics?sort=name')
    await goBack()
    expect(window.location.hash).toBe('#/start-of-test')
  })

  it('a link to another screen with a drawer on it closes onto that screen', async () => {
    navigateHash('#/questions?drawer=add-questions')
    await settle()
    expect(ids()).toBe('add-questions')
    closeDrawer()
    await settle()
    expect(window.location.hash).toBe('#/questions')
    await goBack()
    expect(window.location.hash).toBe('#/topics?sort=name')
  })

  it('a drawer opened from a pasted link closes in place', async () => {
    resetDrawersForTests()
    window.history.replaceState(null, '', '#/overview?drawer=add-questions&target=p1')
    expect(ids()).toBe('add-questions')
    closeDrawer()
    await settle()
    expect(window.location.hash).toBe('#/overview')
  })

  it('stacks a second drawer; closing it returns to the first with a result', async () => {
    const onResult = vi.fn()
    openDrawer('add-questions', { target: 't1' })
    await settle()
    openDrawer('new-topic', {}, { onResult })
    await settle()
    expect(ids()).toBe('add-questions > new-topic')
    closeDrawer(1, 'topic-9')
    await settle()
    expect(ids()).toBe('add-questions')
    expect(onResult).toHaveBeenCalledWith('topic-9')
    expect(window.location.hash).toBe('#/topics?sort=name&drawer=add-questions&target=t1')
  })

  it('closes the whole stack in one go', async () => {
    openDrawer('add-questions')
    await settle()
    openDrawer('new-topic')
    await settle()
    closeAllDrawers()
    await settle()
    expect(window.location.hash).toBe('#/topics?sort=name')
    await goBack()
    expect(window.location.hash).toBe('#/start-of-test')
  })

  it('closes the drawers, then opens a breadcrumb as a new entry', async () => {
    openDrawer('compare', { 'read-from': 'a', 'read-to': 'b' })
    await settle()
    closeDrawersThen('#/overview')
    await settle()
    await settle()
    expect(window.location.hash).toBe('#/overview')
    await goBack()
    expect(window.location.hash).toBe('#/topics?sort=name')
  })

  it('puts a dirty drawer back on Back and asks first', async () => {
    openDrawer('add-questions')
    await settle()
    const ask = vi.fn()
    const unregister = registerDrawerGuard(0, { dirty: true, ask })
    await goBack()
    await settle()
    expect(ask).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('#/topics?sort=name&drawer=add-questions')
    expect(ids()).toBe('add-questions')
    // Discard: the drawer closes itself, and the guard does not ask again.
    unregister()
    closeDrawer()
    await settle()
    expect(window.location.hash).toBe('#/topics?sort=name')
  })

  it('rewrites old ?dialog= links to drawer= in place', async () => {
    expect(ids()).toBe('')
    navigateHash('#/overview?period=7d&dialog=add-questions&target=p1')
    await settle()
    expect(window.location.hash).toBe('#/overview?period=7d&drawer=add-questions&target=p1')
    closeDrawer()
    await settle()
    expect(window.location.hash).toBe('#/overview?period=7d')
  })

  it('builds links that open a drawer over the current screen', () => {
    expect(drawerHref('drill', { drill: 'kpi:aio' })).toBe(
      '#/topics?sort=name&drawer=drill&drill=kpi%3Aaio'
    )
  })
})

function Probe(): JSX.Element {
  const { stack } = useDrawerStack()
  return <p data-testid="stack">{stack.map((entry) => entry.id).join(',') || 'none'}</p>
}

describe('useDrawerStack', () => {
  it('follows the URL', async () => {
    render(<Probe />)
    expect(screen.getByTestId('stack').textContent).toBe('none')
    await act(async () => {
      openDrawer('drill', { drill: 'kpi:aio' })
      await settle()
    })
    expect(screen.getByTestId('stack').textContent).toBe('drill')
    await act(async () => {
      await goBack()
    })
    expect(screen.getByTestId('stack').textContent).toBe('none')
  })
})

function EntryProbe(): JSX.Element {
  const api = useDrawerEntry('fix')
  return (
    <p data-testid="entry">
      {api
        ? `${api.depth}:${api.entry.params.fix ?? ''}:${api.entry.params['fix.mode'] ?? ''}`
        : 'none'}
      {api ? (
        <>
          <button type="button" onClick={() => api.setParams({ 'fix.mode': 'edit' })}>
            edit
          </button>
          <button type="button" onClick={() => api.close()}>
            close
          </button>
        </>
      ) : null}
    </p>
  )
}

describe('useDrawerEntry', () => {
  it('finds one drawer kind in the stack, rewrites its values and closes it', async () => {
    render(<EntryProbe />)
    expect(screen.getByTestId('entry').textContent).toBe('none')
    await act(async () => {
      openDrawer('drill', { drill: 'kpi:aio' })
      await settle()
      openDrawer('fix', { fix: 'fix-1' })
      await settle()
    })
    expect(screen.getByTestId('entry').textContent).toContain('1:fix-1:')
    await act(async () => {
      screen.getByRole('button', { name: 'edit' }).click()
      await settle()
    })
    expect(screen.getByTestId('entry').textContent).toContain('1:fix-1:edit')
    await act(async () => {
      screen.getByRole('button', { name: 'close' }).click()
      await settle()
    })
    expect(screen.getByTestId('entry').textContent).toBe('none')
    expect(ids()).toBe('drill')
  })
})
