// @vitest-environment happy-dom
import { useState, type JSX } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LIST_SEPARATORS, addChips } from './chipList'
import { ChipInput } from './ChipInput'

afterEach(cleanup)

function Harness(): JSX.Element {
  const [items, setItems] = useState<string[]>(['TextBolt'])
  const [draft, setDraft] = useState('')
  return (
    <>
      <label htmlFor="brands">Brand names</label>
      <ChipInput id="brands" items={items} onItems={setItems} draft={draft} onDraft={setDraft} />
      <output>{items.join('|')}</output>
    </>
  )
}

describe('ChipInput', () => {
  it('adds names once, in any case', () => {
    expect(addChips(['TextBolt'], 'textbolt, Text Bolt ,')).toEqual(['TextBolt', 'Text Bolt'])
  })

  it('adds on Enter and comma, removes on Backspace and with each chip button', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Brand names')
    fireEvent.change(input, { target: { value: 'Text Bolt' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('status').textContent).toBe('TextBolt|Text Bolt')
    fireEvent.change(input, { target: { value: 'TB, Bolt,' } })
    expect(screen.getByRole('status').textContent).toBe('TextBolt|Text Bolt|TB|Bolt')
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(screen.getByRole('status').textContent).toBe('TextBolt|Text Bolt|TB')
    fireEvent.click(screen.getByRole('button', { name: 'Remove TextBolt' }))
    expect(screen.getByRole('status').textContent).toBe('Text Bolt|TB')
  })

  it('keeps typed text on blur as a chip', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Brand names')
    fireEvent.change(input, { target: { value: 'Harbor' } })
    fireEvent.blur(input)
    expect(screen.getByRole('status').textContent).toBe('TextBolt|Harbor')
  })

  it('splits a list on commas, semicolons and new lines', () => {
    expect(addChips([], 'a@x.com; b@x.com\nc@x.com,\td@x.com', LIST_SEPARATORS)).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
      'd@x.com'
    ])
  })

  it('turns a pasted list into chips and marks the invalid ones', () => {
    function Emails(): JSX.Element {
      const [items, setItems] = useState<string[]>([])
      const [draft, setDraft] = useState('')
      return (
        <>
          <label htmlFor="to">Recipients</label>
          <ChipInput
            id="to"
            items={items}
            onItems={setItems}
            draft={draft}
            onDraft={setDraft}
            separators={LIST_SEPARATORS}
            invalid={(item) => (item.includes('@') ? null : 'Not an email address')}
          />
          <output>{items.join('|')}</output>
        </>
      )
    }
    render(<Emails />)
    const input = screen.getByLabelText('Recipients')
    fireEvent.paste(input, {
      clipboardData: { getData: () => 'ana@acme.com\nbob@acme.com; nobody' }
    })
    expect(screen.getByRole('status').textContent).toBe('ana@acme.com|bob@acme.com|nobody')
    const bad = document.querySelectorAll('[data-invalid="true"]')
    expect(bad).toHaveLength(1)
    expect(bad[0]?.textContent).toContain('nobody (Not an email address)')
    fireEvent.change(input, { target: { value: 'cy@acme.com' } })
    fireEvent.keyDown(input, { key: ';' })
    expect(screen.getByRole('status').textContent).toBe(
      'ana@acme.com|bob@acme.com|nobody|cy@acme.com'
    )
  })

  it('draws domain chips with the site icon, Copy and Open', () => {
    render(
      <ChipInput
        id="comp"
        items={['twilio.com']}
        onItems={() => undefined}
        draft=""
        onDraft={() => undefined}
        domains
      />
    )
    expect(document.querySelector('[data-url-text="domain"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy twilio.com' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open twilio.com in a new tab' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove twilio.com' })).toBeTruthy()
  })
})
