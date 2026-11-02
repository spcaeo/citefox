// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from './axe.test-helper'
import { Dropdown, type DropdownProps } from './Dropdown'

afterEach(cleanup)

const MARKETS = [
  { value: 'us', label: 'United States · EN', icon: <span>🇺🇸</span> },
  { value: 'gb', label: 'United Kingdom · EN' },
  { value: 'de', label: 'Germany · DE' }
]

function Harness(
  props: Partial<DropdownProps> & { onPick?: (value: string) => void }
): JSX.Element {
  const [value, setValue] = useState(props.value ?? 'us')
  return (
    <Dropdown
      aria-label="Market"
      options={MARKETS}
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next)
        props.onPick?.(next)
      }}
    />
  )
}

function button(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Market' })
}

describe('Dropdown', () => {
  it('shows the choice with its icon and opens a list with a tick on it', () => {
    render(<Harness />)
    expect(button().textContent).toContain('United States · EN')
    expect(button().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button())
    const list = screen.getByRole('listbox', { name: 'Market' })
    expect(button().getAttribute('aria-expanded')).toBe('true')
    const chosen = within(list).getByRole('option', { name: /United States/ })
    expect(chosen.getAttribute('aria-selected')).toBe('true')
    expect(chosen.querySelector('.ui-dd-tick')).toBeTruthy()
    expect(within(list).getAllByRole('option')).toHaveLength(3)
  })

  it('works from the keyboard: open, move, pick, and Escape returns focus', () => {
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    button().focus()
    fireEvent.keyDown(button(), { key: 'ArrowDown' })
    const list = screen.getByRole('listbox')
    expect(list.getAttribute('aria-activedescendant')).toBe(
      within(list).getByRole('option', { name: /United States/ }).id
    )
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(list.getAttribute('aria-activedescendant')).toBe(
      within(list).getByRole('option', { name: /Germany/ }).id
    )
    fireEvent.keyDown(list, { key: 'Home' })
    fireEvent.keyDown(list, { key: 'End' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('de')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(button())

    fireEvent.keyDown(button(), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(button())
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('jumps to a choice by its first letter when there is no search box', () => {
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    fireEvent.click(button())
    const list = screen.getByRole('listbox')
    fireEvent.keyDown(list, { key: 'g' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('de')
  })

  it('adds a search box on long lists that narrows the choices', () => {
    const many = Array.from({ length: 10 }, (_, at) => ({ value: `t${at}`, label: `Topic ${at}` }))
    const onPick = vi.fn()
    render(<Harness options={many} value="t0" onPick={onPick} />)
    fireEvent.click(button())
    const search = screen.getByRole('combobox', { name: 'Search Market' })
    expect(document.activeElement).toBe(search)
    fireEvent.change(search, { target: { value: '7' } })
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('t7')

    fireEvent.click(button())
    fireEvent.change(screen.getByRole('combobox', { name: 'Search Market' }), {
      target: { value: 'zzz' }
    })
    expect(screen.getByText('Nothing matches “zzz”')).toBeTruthy()
  })

  it('keeps PickerSelect’s placeholder, groups and "+ New …"', () => {
    const onCreate = vi.fn()
    const onPick = vi.fn()
    render(
      <Harness
        value=""
        placeholder="Pick a topic"
        options={[
          { label: 'Topics', options: [{ value: 't1', label: 'Alerts' }] },
          { value: 'p1', label: 'Pricing page' }
        ]}
        createLabel="+ New topic…"
        onCreate={onCreate}
        onPick={onPick}
      />
    )
    expect(button().textContent).toContain('Pick a topic')
    fireEvent.click(button())
    const list = screen.getByRole('listbox')
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Pick a topic', 'Alerts', 'Pricing page', '+ New topic…'])
    expect(within(list).getByText('Topics').getAttribute('role')).toBe('presentation')
    fireEvent.click(within(list).getByRole('option', { name: '+ New topic…' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('closes on a press outside and has no axe violations', async () => {
    const view = render(<Harness />)
    expect(await axeViolations(view.container)).toEqual([])
    fireEvent.click(button())
    expect(await axeViolations(view.container)).toEqual([])
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
