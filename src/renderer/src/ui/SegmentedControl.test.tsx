// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import axe from 'axe-core'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

const OPTIONS = [
  { value: 'quick', label: 'Quick' },
  { value: 'standard', label: 'Standard', count: 30 },
  { value: 'deep', label: 'Deep' }
] as const

type Depth = (typeof OPTIONS)[number]['value']

function Harness({ onChange }: { onChange?: (value: Depth) => void }): JSX.Element {
  const [value, setValue] = useState<Depth>('standard')
  return (
    <SegmentedControl
      label="How deep"
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

afterEach(cleanup)

describe('SegmentedControl', () => {
  it('is a named group of pressed toggles with one Tab stop', async () => {
    const view = render(<Harness />)
    const group = view.getByRole('group', { name: 'How deep' })
    const buttons = view.getAllByRole('button')
    expect(group).toBeTruthy()
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false'
    ])
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1)
    expect(view.getByRole('button', { name: 'Standard 30' })).toBeTruthy()
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
  })

  it('picks on click', () => {
    const onChange = vi.fn()
    const view = render(<Harness onChange={onChange} />)
    fireEvent.click(view.getByRole('button', { name: 'Deep' }))
    expect(onChange).toHaveBeenCalledWith('deep')
    expect(view.getByRole('button', { name: 'Deep' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('moves and picks with arrows, Home and End, wrapping at the ends', () => {
    const onChange = vi.fn()
    const view = render(<Harness onChange={onChange} />)
    const standard = view.getByRole('button', { name: 'Standard 30' })
    fireEvent.keyDown(standard, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('deep')
    expect(document.activeElement?.textContent).toBe('Deep')
    fireEvent.keyDown(view.getByRole('button', { name: 'Deep' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('quick')
    fireEvent.keyDown(view.getByRole('button', { name: 'Quick' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('deep')
    fireEvent.keyDown(view.getByRole('button', { name: 'Deep' }), { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('quick')
    fireEvent.keyDown(view.getByRole('button', { name: 'Quick' }), { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('deep')
  })
})
