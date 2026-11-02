// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYGROUND_SAVE_PARTS, type PlaygroundSavePart } from '@shared/ipc'
import { DrawerLevel } from '../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../shell/drawers'
import { SaveDrawer } from './SaveDrawer'

beforeEach(() => {
  window.location.hash = '#/playground'
})
afterEach(() => {
  cleanup()
})

const LABELS = Object.fromEntries(PLAYGROUND_SAVE_PARTS.map((part) => [part, part])) as Record<
  PlaygroundSavePart,
  string
>

/** PlaygroundScreen's wiring: the drawer follows `drawer=playground-save&pgs.run=<id>`. */
function Harness({
  known = ['run-1'],
  onConfirm = () => undefined
}: {
  known?: readonly string[]
  onConfirm?: () => void
}): JSX.Element {
  const api = useDrawerEntry('playground-save')
  const runId = api?.entry.params['pgs.run'] ?? null
  return (
    <>
      <button type="button" onClick={() => openDrawer('playground-save', { 'pgs.run': 'run-1' })}>
        Open save
      </button>
      {api ? (
        <DrawerLevel depth={api.depth}>
          <SaveDrawer
            labels={LABELS}
            found={runId !== null && known.includes(runId)}
            parts={['pageRead', 'prompts']}
            onTogglePart={() => undefined}
            projectId="p1"
            onProject={() => undefined}
            targets={[]}
            busy={false}
            error={null}
            onClose={() => api.close()}
            onConfirm={onConfirm}
          />
        </DrawerLevel>
      ) : null}
    </>
  )
}

describe('SaveDrawer', () => {
  it('opens on the URL, focuses the first part, closes on Escape and returns focus', async () => {
    const onConfirm = vi.fn()
    const view = render(<Harness onConfirm={onConfirm} />)
    const opener = view.getByRole('button', { name: 'Open save' })
    opener.focus()
    fireEvent.click(opener)
    await waitFor(() =>
      expect(window.location.hash).toBe('#/playground?drawer=playground-save&pgs.run=run-1')
    )
    const dialog = await view.findByRole('dialog', { name: 'Save to project' })
    await waitFor(() =>
      expect(document.activeElement).toBe(dialog.querySelector('input[type="checkbox"]'))
    )
    expect(within(dialog).getByRole('status').textContent).toBe('2 parts selected')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save to project' }))
    expect(onConfirm).toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).toBe('#/playground'))
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('closes on Back', async () => {
    const view = render(<Harness />)
    fireEvent.click(view.getByRole('button', { name: 'Open save' }))
    expect(await view.findByRole('dialog', { name: 'Save to project' })).toBeTruthy()
    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('#/playground')
  })

  it('says so when a pasted link names a run that is gone, and closes with ✕', async () => {
    window.location.hash = '#/playground?drawer=playground-save&pgs.run=old-run'
    const view = render(<Harness />)
    const dialog = await view.findByRole('dialog', { name: 'Save to project' })
    expect(within(dialog).getByRole('alert').textContent).toContain('not in memory any more')
    expect(within(dialog).queryByRole('button', { name: 'Save to project' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Save to project' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).toBe('#/playground'))
  })
})
