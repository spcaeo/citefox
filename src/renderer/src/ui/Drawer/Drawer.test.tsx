// @vitest-environment happy-dom
import { useState, type JSX } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../axe.test-helper'
import { Confirm } from '../Confirm'
import { DrawerLevelContext, type DrawerLevelValue } from './context'
import { Drawer } from './Drawer'
import { ExpertOptions } from './ExpertOptions'
import { DrawerField, DrawerFields, DrawerGrid, DrawerRail, DrawerSection } from './layout'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

function Opener({ dirty = false }: { dirty?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Edit buyer profile
      </button>
      {open ? (
        <Drawer
          id="edit-profile"
          title="Edit buyer profile"
          crumbs={[
            { label: 'TextBolt', href: '#/overview' },
            { label: 'Pages', href: '#/pages' }
          ]}
          subtitle="One line on what this does and what happens when you save."
          step={{ current: 2, total: 3 }}
          dirty={dirty}
          footer={{
            summary: <strong>What will happen</strong>,
            secondary: { label: 'Save draft', onClick: () => undefined },
            primary: { label: 'Save profile', onClick: () => undefined }
          }}
          onClose={() => setOpen(false)}
        >
          <DrawerGrid>
            <DrawerSection title="Who buys" span={8}>
              <DrawerFields columns={2}>
                <DrawerField label="Role" hint="As your buyers name it.">
                  {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} />}
                </DrawerField>
              </DrawerFields>
            </DrawerSection>
            <DrawerRail>
              <DrawerSection title="Where it goes">Rail</DrawerSection>
            </DrawerRail>
          </DrawerGrid>
        </Drawer>
      ) : null}
    </>
  )
}

describe('Drawer', () => {
  it('leaves out a trail that would only repeat the title', () => {
    render(
      <Drawer id="guide" title="Guide" onClose={() => undefined}>
        Body
      </Drawer>
    )
    expect(screen.queryByRole('navigation', { name: 'Drawer breadcrumb' })).toBeNull()
    expect(screen.getAllByText('Guide')).toHaveLength(1)
  })

  it('has the standard header, body and footer', () => {
    render(<Opener />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit buyer profile' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit buyer profile' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('data-drawer')).toBe('edit-profile')
    expect(dialog.getAttribute('data-drawer-depth')).toBe('0')
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    const crumbs = within(screen.getByRole('navigation', { name: 'Drawer breadcrumb' }))
    expect(crumbs.getByRole('link', { name: 'TextBolt' }).getAttribute('href')).toBe('#/overview')
    expect(crumbs.getByRole('link', { name: 'Pages' })).toBeTruthy()
    // The title is not repeated in the trail.
    expect(crumbs.queryByText('Edit buyer profile')).toBeNull()
    expect(within(dialog).getByText('Step 2 of 3')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Close Edit buyer profile' })).toBeTruthy()
    const buttons = within(dialog.querySelector('.ui-drawer-foot') as HTMLElement)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(buttons).toEqual(['Cancel', 'Save draft', 'Save profile'])
    expect(within(dialog).getByRole('status').textContent).toBe('What will happen')
  })

  it('moves focus to the first field and back to the opener on close', () => {
    render(<Opener />)
    const opener = screen.getByRole('button', { name: 'Edit buyer profile' })
    opener.focus()
    fireEvent.click(opener)
    expect(document.activeElement).toBe(screen.getByLabelText('Role'))
    expect(screen.getByLabelText('Role').getAttribute('aria-describedby')).toContain('-hint')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('closes with ✕, Cancel and a press on the scrim', () => {
    render(<Opener />)
    const open = (): HTMLElement => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit buyer profile' }))
      return screen.getByRole('dialog')
    }
    fireEvent.click(within(open()).getByRole('button', { name: 'Close Edit buyer profile' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(open()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const dialog = open()
    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('traps Tab inside', () => {
    render(<Opener />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit buyer profile' }))
    const dialog = screen.getByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Save profile' })
    save.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(within(dialog).getByRole('link', { name: 'TextBolt' }))
  })

  it('asks "Discard changes?" before closing with changes, then keeps or discards', () => {
    render(<Opener dirty />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit buyer profile' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    const ask = screen.getByRole('alertdialog', { name: 'Discard changes?' })
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Keep editing' }))
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Edit buyer profile' })).toBeTruthy()
    // Escape inside the question answers it (keep editing), not the drawer.
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close Edit buyer profile' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('guards a crumb too, and follows it after Discard', () => {
    window.history.replaceState(null, '', '#/start')
    render(<Opener dirty />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit buyer profile' }))
    fireEvent.click(screen.getByRole('link', { name: 'Pages' }))
    expect(window.location.hash).toBe('#/start')
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(window.location.hash).toBe('#/pages')
  })

  it('takes its depth, crumbs and crumb navigation from the router', () => {
    const navigate = vi.fn()
    const registerGuard = vi.fn(() => () => undefined)
    const level: DrawerLevelValue = {
      depth: 1,
      crumbs: [
        { label: 'TextBolt', href: '#/overview' },
        { label: 'Add questions', onSelect: vi.fn() }
      ],
      navigate,
      registerGuard
    }
    render(
      <DrawerLevelContext.Provider value={level}>
        <Drawer
          id="new-topic"
          title="New topic"
          trail={[{ label: 'Draft' }]}
          onClose={() => undefined}
        >
          Body
        </Drawer>
      </DrawerLevelContext.Provider>
    )
    const dialog = screen.getByRole('dialog', { name: 'New topic' })
    expect(dialog.className).toContain('ui-drawer-depth-1')
    expect(dialog.parentElement?.className).toContain('ui-drawer-scrim-1')
    const nav = within(screen.getByRole('navigation'))
    expect(nav.getAllByRole('listitem').map((item) => item.textContent?.replace('›', ''))).toEqual([
      'TextBolt',
      'Add questions',
      'Draft'
    ])
    fireEvent.click(nav.getByRole('link', { name: 'TextBolt' }))
    expect(navigate).toHaveBeenCalledWith('#/overview')
    fireEvent.click(nav.getByRole('link', { name: 'Add questions' }))
    expect(level.crumbs[1]?.onSelect).toHaveBeenCalled()
    expect(registerGuard).toHaveBeenCalledWith(expect.objectContaining({ dirty: false }))
    // A read-only drawer still has a footer, with Close in the same place.
    expect(
      within(dialog.querySelector('.ui-drawer-foot') as HTMLElement).getByRole('button').textContent
    ).toBe('Close')
  })

  it('shows the greyed layout while loading and an error in place of the body', () => {
    const { rerender } = render(
      <Drawer id="x" title="Compare content" loading onClose={() => undefined}>
        Body
      </Drawer>
    )
    expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Loading Compare content…')).toBeTruthy()
    expect(screen.queryByText('Body')).toBeNull()
    const retry = vi.fn()
    rerender(
      <Drawer
        id="x"
        title="Compare content"
        error={{ message: 'Could not compare.', onRetry: retry }}
        onClose={() => undefined}
      >
        Body
      </Drawer>
    )
    expect(screen.getByRole('alert').textContent).toContain('Could not compare.')
    // An error message is a value someone may paste into a report: it has Copy.
    expect(screen.getByRole('button', { name: 'Copy Could not compare.' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalled()
  })

  it('keeps a failing section’s error inside that section', () => {
    const retry = vi.fn()
    render(
      <Drawer id="x" title="T" onClose={() => undefined}>
        <DrawerGrid>
          <DrawerSection title="Fine" span={6}>
            ok
          </DrawerSection>
          <DrawerSection title="Broken" span={6} error="Could not load the pages." onRetry={retry}>
            never
          </DrawerSection>
        </DrawerGrid>
      </Drawer>
    )
    const broken = screen.getByRole('region', { name: 'Broken' })
    expect(within(broken).getByRole('alert').textContent).toContain('Could not load the pages.')
    expect(screen.getByRole('region', { name: 'Fine' }).textContent).toContain('ok')
    expect(screen.queryByText('never')).toBeNull()
  })

  it('remembers Expert options per drawer', () => {
    const view = (): JSX.Element => (
      <Drawer id="markets-add" title="Add a market" onClose={() => undefined}>
        <ExpertOptions summary="Samples and language">
          <p>Inside</p>
        </ExpertOptions>
      </Drawer>
    )
    const { unmount } = render(view())
    const toggle = screen.getByRole('button', { name: /Expert options/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('Inside').closest('[hidden]')).not.toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    unmount()
    render(view())
    expect(
      screen.getByRole('button', { name: /Expert options/ }).getAttribute('aria-expanded')
    ).toBe('true')
  })

  it('passes axe', async () => {
    render(<Opener dirty />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit buyer profile' }))
    expect(await axeViolations(document.body)).toEqual([])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(await axeViolations(document.body)).toEqual([])
  })
})

describe('Confirm', () => {
  it('is a small alertdialog: focus on the safe button, Escape cancels', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <Confirm
        title="Delete this topic?"
        body="Its 14 questions stay tracked."
        confirmLabel="Delete topic"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this topic?' })
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Cancel')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete topic' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
