// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { rollupPageFixes } from '@shared/page-fixes'
import { DrillHost } from '../../drill'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { useDrawerEntry } from '../../shell/drawers'
import { fakeLoopSource } from '../fixtures'
import { projectSearches } from '../searchFixtures'
import type { ProjectFixesSource } from '../source'
import { UndoToastHost } from '../../ui/UndoToast'
import { resetUndoToastForTests } from '../../ui/undoStore'
import { openPageFix } from './openPageFix'
import { PageFixHost } from './PageFixHost'

/** The story's fixes, as the rollup makes them (ids are opaque). */
const FIXES = rollupPageFixes(projectSearches().searches).fixes
const SCREEN = '#/topics/topic-nagios?view=grid'

/** What the shell's DrawerHost does for `drawer=page-fix`, over a screen. */
function Host({ source }: { source: ProjectFixesSource }): JSX.Element | null {
  const drawer = useDrawerEntry('page-fix')
  if (!drawer) return null
  return (
    <DrawerLevel depth={drawer.depth}>
      <PageFixHost entry={drawer.entry} depth={drawer.depth} projectId="proj-1" source={source} />
    </DrawerLevel>
  )
}

function show(source: ProjectFixesSource): ReturnType<typeof render> {
  return render(
    <DrillHost>
      <Host source={source} />
      <UndoToastHost />
    </DrillHost>
  )
}

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
  window.location.hash = ''
})

describe('the page fix drawer over any screen', () => {
  it('Get fix brief opens the fix over the screen and writes its brief at once', async () => {
    window.location.hash = SCREEN
    const { source, calls } = fakeLoopSource()
    const view = show(source)
    const improve = FIXES.find((fix) => fix.kind === 'improve')
    if (!improve) throw new Error('no improve fix')
    act(() => openPageFix([improve.id], { start: true }))
    const drawer = await view.findByRole('dialog', { name: /Improve a page/ })
    // The screen under it stays; only the drawer's values are added.
    expect(window.location.hash).toBe(`${SCREEN}&drawer=page-fix&pfx.id=${improve.id}`)
    await waitFor(() =>
      expect(calls.briefs.filter((call) => call.channel === 'topics:draftFix')).toHaveLength(1)
    )
    // One fix: no stepping.
    expect(within(drawer).queryByRole('button', { name: 'Next page fix' })).toBeNull()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).toBe(SCREEN))
  })

  it('a brief over several fixes opens the first and steps through the rest', async () => {
    window.location.hash = SCREEN
    const { source, calls } = fakeLoopSource()
    const view = show(source)
    const ids = FIXES.slice(0, 2).map((fix) => fix.id)
    act(() => openPageFix(ids))
    expect(await view.findByText('Fix 1 of 2')).toBeTruthy()
    const drawer = view.getByRole('dialog')
    expect(
      (within(drawer).getByRole('button', { name: 'Previous page fix' }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Next page fix' }))
    await waitFor(() => expect(view.getByText('Fix 2 of 2')).toBeTruthy())
    expect(window.location.hash).toContain(`pfx.id=${ids[1]}`)
    // Opened without a press: nothing was written.
    expect(calls.briefs.filter((call) => call.channel !== 'fixes:saveBrief')).toHaveLength(0)
  })

  it('a fix that is gone says so', async () => {
    window.location.hash = `${SCREEN}&drawer=page-fix&pfx.id=pf-gone`
    const { source } = fakeLoopSource()
    const view = show(source)
    const drawer = await view.findByRole('dialog', { name: 'Page fix' })
    expect(await within(drawer).findByText('That fix is done or no longer needed.')).toBeTruthy()
  })

  it('I published this logs the fix live today with every search, offers Undo, then says Live since', async () => {
    window.location.hash = SCREEN
    const { source, calls } = fakeLoopSource()
    const view = show(source)
    const improve = FIXES.find((fix) => fix.kind === 'improve')
    if (!improve) throw new Error('no improve fix')
    act(() => openPageFix([improve.id]))
    const drawer = await view.findByRole('dialog', { name: /Improve a page/ })
    const button = within(drawer).getByRole('button', { name: 'I published this' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)
    await waitFor(() => expect(calls.creates).toHaveLength(1))
    expect(calls.creates[0]).toMatchObject({
      pageId: 'page-nagios',
      pageFixId: improve.id,
      kind: 'fix',
      promptIds: improve.searches.map((search) => search.promptId),
      marketIds: ['mkt-us']
    })
    // The drawer now says when it went live and how long until the verdict.
    expect(
      await within(drawer).findByRole('heading', {
        name: /^Live since .* · measuring, 14 days left$/
      })
    ).toBeTruthy()
    expect(within(drawer).queryByRole('button', { name: 'I published this' })).toBeNull()
    expect(view.getByText('Logged Fix 1 as live today.')).toBeTruthy()
    // Undo takes it back: the button returns.
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    expect(await within(drawer).findByRole('button', { name: 'I published this' })).toBeTruthy()
    // Still over the same screen.
    expect(window.location.hash).toContain(SCREEN)
  })

  it('Pick another date opens Log a fix with the fix’s page, topic questions and address', async () => {
    window.location.hash = SCREEN
    const { source } = fakeLoopSource()
    const view = show(source)
    const improve = FIXES.find((fix) => fix.kind === 'improve')
    if (!improve) throw new Error('no improve fix')
    act(() => openPageFix([improve.id]))
    const drawer = await view.findByRole('dialog', { name: /Improve a page/ })
    const button = within(drawer).getByRole('button', { name: 'I published this' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Pick another date' }))
    await waitFor(() => expect(window.location.hash).toContain('drawer=fix'))
    const params = new URLSearchParams(
      window.location.hash.slice(window.location.hash.indexOf('?'))
    )
    expect(params.get('fix.page')).toBe('page-nagios')
    expect(params.get('fix.also')).toBe('topic-nagios')
    expect(params.get('fix.pf')).toBe(improve.id)
    expect(params.get('fix.prompts')?.split(',')).toEqual(
      improve.searches.map((search) => search.promptId)
    )
  })
})
