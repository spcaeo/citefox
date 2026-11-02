// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PICKER_NEW_VALUE, PickerSelect } from './PickerSelect'

afterEach(cleanup)

describe('PickerSelect', () => {
  it('picks an item, and "+ New …" calls onCreate without changing the value', () => {
    const onChange = vi.fn()
    const onCreate = vi.fn()
    render(
      <PickerSelect
        aria-label="Topic"
        value="t1"
        onChange={onChange}
        placeholder="Pick a topic"
        options={[
          { label: 'Topics', options: [{ value: 't1', label: 'Alerts' }] },
          { value: 'p1', label: 'Pricing page' }
        ]}
        createLabel="+ New topic…"
        onCreate={onCreate}
      />
    )
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Topic' })
    expect(Array.from(select.options).map((option) => option.text)).toEqual([
      'Pick a topic',
      'Alerts',
      'Pricing page',
      '+ New topic…'
    ])
    fireEvent.change(select, { target: { value: 'p1' } })
    expect(onChange).toHaveBeenCalledWith('p1')
    fireEvent.change(select, { target: { value: PICKER_NEW_VALUE } })
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('leaves "+ New …" out without onCreate', () => {
    render(
      <PickerSelect
        aria-label="Market"
        value=""
        onChange={() => undefined}
        options={[{ value: 'm1', label: 'US · EN' }]}
        createLabel="+ New market…"
      />
    )
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Market' })
    expect(select.options).toHaveLength(1)
  })
})
