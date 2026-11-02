// @vitest-environment happy-dom
import { useState, type JSX } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StartUrlSuggestions } from '@shared/ipc'
import { axeViolations } from '../ui/axe.test-helper'
import { addressOf } from './addPageModel'
import { UrlCombobox } from './UrlCombobox'

afterEach(cleanup)

const ROWS: StartUrlSuggestions = {
  suggestions: [
    {
      url: 'https://textbolt.com/pricing/',
      path: '/pricing/',
      title: 'Pricing',
      section: 'Top-level pages',
      alreadyTracked: false
    },
    {
      url: 'https://textbolt.com/compare/textbolt-vs-twilio/',
      path: '/compare/textbolt-vs-twilio/',
      title: 'TextBolt vs Twilio',
      section: 'Compare',
      alreadyTracked: true
    }
  ],
  total: 42
}

function Harness({
  suggest
}: {
  suggest?: (query: string) => Promise<StartUrlSuggestions>
}): JSX.Element {
  const [value, setValue] = useState('')
  return (
    <form aria-label="Test">
      <label htmlFor="url">Page URL</label>
      <UrlCombobox id="url" value={value} onChange={setValue} {...(suggest ? { suggest } : {})} />
    </form>
  )
}

async function openList(): Promise<HTMLElement> {
  const box = screen.getByRole('combobox', { name: 'Page URL' })
  fireEvent.focus(box)
  await screen.findByRole('option', { name: /\/pricing\// })
  return box
}

describe('UrlCombobox', () => {
  it('lists sitemap pages on focus, with the section and a count of the rest', async () => {
    const suggest = vi.fn(() => Promise.resolve(ROWS))
    const view = render(<Harness suggest={suggest} />)
    const box = await openList()
    expect(box.getAttribute('aria-expanded')).toBe('true')
    expect(suggest).toHaveBeenCalledWith('')
    expect(screen.getByText('Compare · tracked')).toBeTruthy()
    expect(screen.getByText(/42 matching pages/)).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('searches what was typed', async () => {
    const suggest = vi.fn(() => Promise.resolve(ROWS))
    render(<Harness suggest={suggest} />)
    const box = await openList()
    fireEvent.change(box, { target: { value: '/compare' } })
    await waitFor(() => expect(suggest).toHaveBeenLastCalledWith('/compare'))
  })

  it('Arrow keys move, Enter picks the page, and the list closes', async () => {
    render(<Harness suggest={() => Promise.resolve(ROWS)} />)
    const box = await openList()
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    const second = screen.getByRole('option', { name: /textbolt-vs-twilio/ })
    expect(second.getAttribute('aria-selected')).toBe('true')
    expect(box.getAttribute('aria-activedescendant')).toBe(second.id)
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect((box as HTMLInputElement).value).toBe('https://textbolt.com/pricing/')
    expect(box.getAttribute('aria-expanded')).toBe('false')
  })

  it('Escape closes; a click picks', async () => {
    render(<Harness suggest={() => Promise.resolve(ROWS)} />)
    const box = await openList()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    await act(async () => Promise.resolve())
    fireEvent.click(await screen.findByRole('option', { name: /textbolt-vs-twilio/ }))
    expect((box as HTMLInputElement).value).toBe('https://textbolt.com/compare/textbolt-vs-twilio/')
  })

  it('without suggestions it is a plain address box', () => {
    render(<Harness />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByLabelText('Page URL')).toBeTruthy()
  })
})

describe('addressOf', () => {
  it('turns a typed path or bare host into the project address', () => {
    expect(addressOf('/pricing', 'textbolt.com')).toBe('https://textbolt.com/pricing')
    expect(addressOf(' textbolt.com/pricing/ ', 'textbolt.com')).toBe(
      'https://textbolt.com/pricing/'
    )
    expect(addressOf('https://other.com/x', 'textbolt.com')).toBe('https://other.com/x')
    expect(addressOf('pricing', 'textbolt.com')).toBe('pricing')
  })
})
