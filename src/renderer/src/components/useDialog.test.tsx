// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { textboltResults } from '../m3/fixtures'
import { DrillDrawer } from '../m3/DrillDrawer'
import { useDialog } from './useDialog'

afterEach(cleanup)

function Dialog({ onClose }: { onClose: () => void }): JSX.Element {
  const ref = useDialog<HTMLDivElement>({ onClose })
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Test">
      <button type="button" data-autofocus>
        First
      </button>
      <button type="button" disabled>
        Off
      </button>
      <a href="#x">Middle</a>
      <button type="button">Last</button>
    </div>
  )
}

function Host(): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open ? <Dialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function Stacked(): JSX.Element {
  const [outer, setOuter] = useState(true)
  const [inner, setInner] = useState(true)
  return (
    <>
      {outer ? <Dialog onClose={() => setOuter(false)} /> : null}
      {inner ? (
        <div role="note" aria-label="inner">
          <Dialog onClose={() => setInner(false)} />
        </div>
      ) : null}
    </>
  )
}

describe('useDialog', () => {
  it('lets only the newest of two open dialogs answer Escape', () => {
    const view = render(<Stacked />)
    expect(view.getAllByRole('dialog')).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.getAllByRole('dialog')).toHaveLength(1)
    expect(view.queryByRole('note')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('moves focus in, traps Tab, closes on Escape, and returns focus to the opener', () => {
    const view = render(<Host />)
    const opener = view.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)
    const first = view.getByRole('button', { name: 'First' })
    const last = view.getByRole('button', { name: 'Last' })
    expect(document.activeElement).toBe(first)
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('DrillDrawer focus', () => {
  it('keeps focus where it is when the parent re-renders with a new onClose', () => {
    const results = textboltResults()
    function Parent(): JSX.Element {
      const [ticks, setTicks] = useState(0)
      return (
        <>
          <button type="button" onClick={() => setTicks((value) => value + 1)}>
            Tick {ticks}
          </button>
          <DrillDrawer
            drill={{
              id: 'aio',
              title: 'AI Overview shown',
              description: 'Questions with an overview',
              omitCount: false,
              promptIds: results.prompts.map((row) => row.promptId)
            }}
            rows={results.prompts}
            brand="TextBolt"
            domain="textbolt.com"
            marketLabel="US · EN"
            checkDateLabel="Oct 19"
            onClose={() => setTicks(0)}
          />
        </>
      )
    }
    const view = render(<Parent />)
    const dialog = view.getByRole('dialog')
    const close = dialog.querySelector<HTMLElement>('.ui-drawer-close')
    expect(document.activeElement).toBe(close)
    const links = dialog.querySelectorAll<HTMLElement>('a[href]')
    const target = links[links.length - 1]
    if (!target) throw new Error('drawer has no links')
    target.focus()
    act(() => {
      fireEvent.click(view.getByRole('button', { name: /Tick/ }))
    })
    target.focus()
    act(() => {
      fireEvent.click(view.getByRole('button', { name: /Tick/ }))
    })
    expect(document.activeElement).not.toBe(close)
  })

  it('lets only the newest open dialog answer Escape (a drawer over a side panel)', () => {
    const closed: string[] = []
    function Named({ name }: { name: string }): JSX.Element {
      const ref = useDialog<HTMLDivElement>({ onClose: () => closed.push(name) })
      return (
        <div ref={ref} role="dialog" aria-label={name}>
          <button type="button">{`${name} button`}</button>
        </div>
      )
    }
    function Stack(): JSX.Element {
      const [drawer, setDrawer] = useState(false)
      return (
        <>
          <Named name="Panel" />
          <button type="button" onClick={() => setDrawer(true)}>
            Open drawer
          </button>
          {drawer ? <Named name="Drawer" /> : null}
        </>
      )
    }
    const view = render(<Stack />)
    fireEvent.click(view.getByRole('button', { name: 'Open drawer' }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(closed).toEqual(['Drawer'])
  })
})
