// @vitest-environment happy-dom
import type { JSX } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartEdit, StartEditRecord, StartEditResult, StartRival } from '@shared/ipc'
import { axeViolations } from '../../ui/axe.test-helper'
import { activitySnapshot, resetActivityFeed } from '../activity'
import { fakeStartClient } from '../fakeStartClient.test-helper'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../../shell/drawers'
import { BuyerProfileDrawer } from './BuyerProfileDrawer'
import { EditableChips } from './EditableChips'
import { EditableRows } from './EditableRows'
import { RivalsEditor } from './RivalsEditor'
import { useStartEdits } from './useStartEdits'

afterEach(cleanup)
beforeEach(() => resetActivityFeed())

function openMenu(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

function pick(name: string | RegExp): void {
  fireEvent.click(within(document.body).getByRole('menuitem', { name }))
}

function type(label: string, value: string, key = 'Enter'): void {
  const box = screen.getByRole('textbox', { name: label })
  fireEvent.change(box, { target: { value } })
  fireEvent.keyDown(box, { key })
}

describe('EditableChips', () => {
  it('rename, remove and add send the change; Escape cancels', async () => {
    const onRename = vi.fn()
    const onRemove = vi.fn()
    const onAdd = vi.fn()
    const view = render(
      <EditableChips
        label="Segments"
        noun="segment"
        items={['Clinics', 'MSPs']}
        onRename={onRename}
        onRemove={onRemove}
        onAdd={onAdd}
      />
    )
    expect(await axeViolations(view.container)).toEqual([])
    openMenu('Edit segment Clinics')
    pick('Rename')
    type('Rename segment Clinics', 'Dental clinics')
    expect(onRename).toHaveBeenCalledWith('Clinics', 'Dental clinics')

    openMenu('Edit segment MSPs')
    pick('Remove')
    expect(onRemove).toHaveBeenCalledWith('MSPs')

    fireEvent.click(screen.getByRole('button', { name: 'Add a segment to Segments' }))
    type('Add a segment', 'Schools', 'Escape')
    expect(onAdd).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add a segment to Segments' }))
    type('Add a segment', 'Schools')
    expect(onAdd).toHaveBeenCalledWith('Schools')
  })
})

describe('RivalsEditor', () => {
  const rivals: StartRival[] = [
    { name: 'SimpleTexting', domain: 'simpletexting.com', kind: 'competitor', reason: '' },
    { name: 'AT&T gateway', domain: null, kind: 'switch_from', reason: '' },
    { name: 'WIN-911', domain: null, kind: 'partner', reason: '' }
  ]

  it('sends rival edits: move between groups, rename, remove, add', () => {
    const sent: StartEdit[] = []
    render(<RivalsEditor rivals={rivals} onSend={(edit) => sent.push(edit)} />)
    openMenu('Edit partner WIN-911')
    pick('Move to Competitors')
    openMenu('Edit competitor SimpleTexting')
    pick('Rename')
    type('Rename competitor SimpleTexting', 'Simple Texting')
    openMenu('Edit option buyers switch from AT&T gateway')
    pick('Remove')
    fireEvent.click(screen.getByRole('button', { name: 'Add a competitor to Competitors' }))
    type('Add a competitor', 'Textline')
    expect(sent).toEqual([
      { kind: 'rival', op: 'move', name: 'WIN-911', rivalKind: 'competitor' },
      { kind: 'rival', op: 'rename', name: 'SimpleTexting', to: 'Simple Texting' },
      { kind: 'rival', op: 'remove', name: 'AT&T gateway' },
      { kind: 'rival', op: 'add', name: 'Textline', rivalKind: 'competitor' }
    ])
  })
})

describe('EditableRows', () => {
  it('edits and removes a row and adds one', () => {
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    const onAdd = vi.fn()
    render(
      <EditableRows
        label="Questions"
        noun="question"
        rows={[{ id: 'q1', text: 'How do I text my staff?', lead: 'Q1' }]}
        onEdit={onEdit}
        onRemove={onRemove}
        onAdd={onAdd}
      />
    )
    openMenu('Edit question: How do I text my staff?')
    pick('Edit')
    type('Edit question', 'How do I text my whole team?')
    expect(onEdit).toHaveBeenCalledWith('q1', 'How do I text my whole team?')
    openMenu('Edit question: How do I text my staff?')
    pick('Remove')
    expect(onRemove).toHaveBeenCalledWith('q1')
    fireEvent.click(screen.getByRole('button', { name: 'Add a question' }))
    type('Add a question', 'Is it HIPAA safe?')
    expect(onAdd).toHaveBeenCalledWith('Is it HIPAA safe?')
  })
})

const BUYERS = { who: 'Office managers', segments: ['Clinics'], triggers: ['Gateway stopped'] }

/** FoundScreen's wiring: the drawer is on the URL as `drawer=start-buyers`. */
function BuyersHost({ onSend }: { onSend: (edit: StartEdit) => void }): JSX.Element | null {
  const api = useDrawerEntry('start-buyers')
  if (api === null) return null
  return (
    <DrawerLevel depth={api.depth}>
      <BuyerProfileDrawer buyers={BUYERS} onSend={onSend} onClose={() => api.close()} />
    </DrawerLevel>
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
}

describe('BuyerProfileDrawer', () => {
  beforeEach(() => {
    window.location.hash = '#/start'
  })

  it('is a drawer that sends segment and trigger edits at once and who buys on save', async () => {
    const sent: StartEdit[] = []
    const onClose = vi.fn()
    const view = render(
      <BuyerProfileDrawer buyers={BUYERS} onSend={(edit) => sent.push(edit)} onClose={onClose} />
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit the buyer profile' })
    expect(dialog.getAttribute('data-drawer')).toBe('start-buyers')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Who buys')))
    openMenu('Edit trigger: Gateway stopped')
    pick('Remove')
    fireEvent.click(screen.getByRole('button', { name: 'Add a segment to Segments' }))
    type('Add a segment', 'Schools')
    fireEvent.change(screen.getByLabelText('Who buys'), {
      target: { value: 'Ops leads at small teams' }
    })
    expect(within(dialog).getByText('Who buys is not saved yet')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and close' }))
    expect(sent).toEqual([
      { kind: 'trigger', op: 'remove', text: 'Gateway stopped' },
      { kind: 'segment', op: 'add', text: 'Schools' },
      { kind: 'who', op: 'set', text: 'Ops leads at small teams' }
    ])
    expect(onClose).toHaveBeenCalled()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('opens from the URL and closes on Escape, and the URL loses it', async () => {
    window.location.hash = '#/start?drawer=start-buyers'
    render(<BuyersHost onSend={() => undefined} />)
    const dialog = await screen.findByRole('dialog', { name: 'Edit the buyer profile' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).toBe('#/start'))
  })

  it('asks before throwing away a typed who buys on ✕ and on Back', async () => {
    render(<BuyersHost onSend={() => undefined} />)
    act(() => openDrawer('start-buyers'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the buyer profile' })
    fireEvent.change(screen.getByLabelText('Who buys'), { target: { value: 'Clinic owners' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Edit the buyer profile' }))
    const ask = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('dialog', { name: 'Edit the buyer profile' })).toBeTruthy()
    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    await settle()
    const again = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
    expect(screen.getByLabelText<HTMLTextAreaElement>('Who buys').value).toBe('Clinic owners')
    fireEvent.click(within(again).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).toBe('#/start'))
  })
})

function record(id: string, summary: string): StartEditRecord {
  return {
    id,
    edit: { kind: 'rival', op: 'remove', name: 'PagerDuty' },
    summary,
    at: '2026-10-22T10:00:00.000Z',
    undoneAt: null,
    parentId: null,
    system: false
  }
}

function Harness({ client }: { client: ReturnType<typeof fakeStartClient> }): JSX.Element {
  const edits = useStartEdits({ client, projectId: 'p1' })
  return (
    <div>
      <button
        type="button"
        onClick={() => void edits.send({ kind: 'rival', op: 'remove', name: 'PagerDuty' })}
      >
        Remove PagerDuty
      </button>
      {edits.error ? <p role="alert">{edits.error}</p> : null}
      {edits.toast}
    </div>
  )
}

describe('useStartEdits', () => {
  it('shows the toast with the effect, undoes, and records both in Activity', async () => {
    const result = (summary: string, effect: string | null): StartEditResult => ({
      record: record('e1', summary),
      effect,
      plan: null,
      progress: null
    })
    const undo = vi.fn(() => Promise.resolve(result('Removed competitor PagerDuty', null)))
    const client = fakeStartClient({
      overrides: {
        edit: () =>
          Promise.resolve(
            result('Removed competitor PagerDuty', 'Rewrote 2 questions with your change')
          ),
        undo
      }
    })
    render(<Harness client={client} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove PagerDuty' }))
    const toast = await screen.findByRole('status')
    expect(toast.textContent).toContain('Removed competitor PagerDuty')
    expect(toast.textContent).toContain('Rewrote 2 questions with your change')
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undo).toHaveBeenCalledWith({ projectId: 'p1', editId: 'e1' }))
    expect(await screen.findByText('Undid: Removed competitor PagerDuty')).toBeTruthy()
    const texts = activitySnapshot().map((entry) => entry.text)
    expect(texts).toContain('Removed competitor PagerDuty · Rewrote 2 questions with your change')
    expect(texts).toContain('Undid: Removed competitor PagerDuty')
  })

  it('surfaces a failed edit and hides the toast after six seconds', async () => {
    vi.useFakeTimers()
    try {
      const client = fakeStartClient({
        overrides: {
          edit: () =>
            Promise.resolve({
              record: record('e2', 'Removed competitor PagerDuty'),
              effect: null,
              plan: null,
              progress: null
            })
        }
      })
      render(<Harness client={client} />)
      fireEvent.click(screen.getByRole('button', { name: 'Remove PagerDuty' }))
      await act(async () => Promise.resolve())
      expect(screen.getByRole('status')).toBeTruthy()
      act(() => vi.advanceTimersByTime(6100))
      expect(screen.queryByRole('status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
    cleanup()
    const failing = fakeStartClient({
      overrides: {
        edit: () => Promise.reject(new Error('start:edit: That page is not on your site.'))
      }
    })
    render(<Harness client={failing} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove PagerDuty' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/not on your site/u)
  })
})
