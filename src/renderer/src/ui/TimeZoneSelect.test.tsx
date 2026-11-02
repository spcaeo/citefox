// @vitest-environment happy-dom
import { useState, type JSX } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeZoneSelect } from './TimeZoneSelect'

afterEach(cleanup)

const ZONES = ['UTC', 'Europe/London', 'Asia/Kolkata', 'America/New_York']
const JULY = new Date('2026-07-01T12:00:00Z')

function Harness({ onEscape }: { onEscape?: () => void }): JSX.Element {
  const [zone, setZone] = useState('Europe/London')
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape') onEscape?.()
      }}
    >
      <label htmlFor="tz">Time zone</label>
      <TimeZoneSelect id="tz" value={zone} onChange={setZone} zones={ZONES} at={JULY} />
      <output>{zone}</output>
    </div>
  )
}

describe('TimeZoneSelect', () => {
  it('shows the zone with its offset now', () => {
    render(<Harness />)
    const box = screen.getByRole('combobox', { name: 'Time zone' }) as HTMLInputElement
    expect(box.value).toBe('Europe/London · UTC+1')
    expect(box.getAttribute('aria-expanded')).toBe('false')
  })

  it('filters by city or offset and picks with Enter or a click', () => {
    render(<Harness />)
    const box = screen.getByRole('combobox', { name: 'Time zone' })
    fireEvent.change(box, { target: { value: 'kolk' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByRole('status').textContent).toBe('Asia/Kolkata')
    fireEvent.change(box, { target: { value: 'utc-4' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: /New York/ }))
    expect(screen.getByRole('status').textContent).toBe('America/New_York')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('says when nothing matches', () => {
    render(<Harness />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Time zone' }), {
      target: { value: 'atlantis' }
    })
    expect(screen.getByText(/No time zone matches/)).toBeTruthy()
  })

  it('closes only its list on Escape', () => {
    const onEscape = vi.fn()
    render(<Harness onEscape={onEscape} />)
    const box = screen.getByRole('combobox', { name: 'Time zone' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox', { name: 'Time zones' })).toBeTruthy()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onEscape).not.toHaveBeenCalled()
  })
})
