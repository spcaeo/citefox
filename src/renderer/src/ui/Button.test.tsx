// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from './axe.test-helper'
import { Button, LinkButton } from './Button'
import { buttonClass } from './classes'

afterEach(cleanup)

describe('Button', () => {
  it('maps variant and size to classes and defaults to type=button', () => {
    const view = render(
      <>
        <Button variant="primary">Start check</Button>
        <Button>Secondary</Button>
        <Button variant="ghost" size="sm" icon="arrow-left">
          Back
        </Button>
        <Button variant="text">Text link</Button>
        <Button variant="danger">Remove</Button>
      </>
    )
    const primary = view.getByRole('button', { name: 'Start check' })
    expect(primary.className).toBe('ui-btn ui-btn-primary')
    expect(primary.getAttribute('type')).toBe('button')
    expect(view.getByRole('button', { name: 'Secondary' }).className).toBe(
      'ui-btn ui-btn-secondary'
    )
    const back = view.getByRole('button', { name: 'Back' })
    expect(back.className).toBe('ui-btn ui-btn-ghost ui-btn-sm')
    expect(back.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(view.getByRole('button', { name: 'Text link' }).className).toContain('ui-btn-text')
    expect(view.getByRole('button', { name: 'Remove' }).className).toContain('ui-btn-danger')
  })

  it('blocks clicks while busy and marks it for assistive tech', () => {
    const onClick = vi.fn()
    const view = render(
      <Button busy onClick={onClick}>
        Save
      </Button>
    )
    const button = view.getByRole('button', { name: 'Save' })
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(button.getAttribute('aria-busy')).toBe('true')
    view.rerender(<Button onClick={onClick}>Save</Button>)
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('shows a spinner and the busy label in place of the icons while busy', () => {
    const view = render(
      <Button icon="sparkle" iconEnd="arrow-right" busy busyLabel="Testing…">
        Test key
      </Button>
    )
    const button = view.getByRole('button', { name: 'Testing…' })
    expect(button.querySelector('.ui-btn-spin')?.getAttribute('aria-hidden')).toBe('true')
    expect(button.querySelector('svg')).toBeNull()
    expect(button.getAttribute('data-busy')).toBe('true')
    // It stays focusable while it works.
    expect(button.hasAttribute('disabled')).toBe(false)
    view.rerender(
      <Button icon="sparkle" busy={false} busyLabel="Testing…">
        Test key
      </Button>
    )
    const idle = view.getByRole('button', { name: 'Test key' })
    expect(idle.querySelector('.ui-btn-spin')).toBeNull()
    expect(idle.querySelector('svg')).not.toBeNull()
  })

  it('cannot be pressed twice: the second press while busy does nothing, a submit too', () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    function Form(): React.JSX.Element {
      const [busy, setBusy] = useState(false)
      const [runs, setRuns] = useState(0)
      return (
        <form onSubmit={onSubmit}>
          <Button
            type="submit"
            busy={busy}
            onClick={() => {
              setBusy(true)
              setRuns((count) => count + 1)
            }}
          >
            Finish
          </Button>
          <output>{runs}</output>
        </form>
      )
    }
    const view = render(<Form />)
    const button = view.getByRole('button', { name: 'Finish' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(view.container.querySelector('output')?.textContent).toBe('1')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('renders a link that looks like a button, external links open in the browser', () => {
    const view = render(
      <>
        <LinkButton href="#/pages" variant="ghost" icon="arrow-left">
          Back
        </LinkButton>
        <LinkButton href="https://1000aioverviews.com" external>
          Write with 1000AIOverviews
        </LinkButton>
      </>
    )
    const back = view.getByRole('link', { name: 'Back' })
    expect(back.getAttribute('href')).toBe('#/pages')
    expect(back.className).toBe('ui-btn ui-btn-ghost')
    const out = view.getByRole('link', { name: 'Write with 1000AIOverviews' })
    expect(out.getAttribute('target')).toBe('_blank')
    expect(out.getAttribute('rel')).toBe('noopener noreferrer')
    expect(buttonClass('primary', 'sm', 'extra')).toBe('ui-btn ui-btn-primary ui-btn-sm extra')
  })

  it('is axe clean', async () => {
    const view = render(
      <div>
        <Button variant="primary" iconEnd="arrow-right">
          Match pages
        </Button>
        <LinkButton href="#/x">Open</LinkButton>
      </div>
    )
    expect(await axeViolations(view.container)).toEqual([])
  })
})
