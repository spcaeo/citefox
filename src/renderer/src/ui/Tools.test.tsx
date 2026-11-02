// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExportMenu, FilterBar, SearchBox, ToolButton, ToolGroup } from './Tools'
import { TOOL_KINDS } from './toolKinds'

afterEach(cleanup)

describe('standard tools', () => {
  it('a tool button is an icon whose name is the kind’s standard name', () => {
    const onClick = vi.fn()
    const view = render(
      <ToolGroup>
        <ToolButton kind="print" onClick={onClick} />
        <ToolButton kind="csv" label="Download questions CSV" onClick={() => undefined} />
      </ToolGroup>
    )
    const print = view.getByRole('button', { name: TOOL_KINDS.print.label })
    expect(print.textContent).toBe('')
    expect(print.getAttribute('data-tip')).toBe('Print / PDF')
    fireEvent.click(print)
    expect(onClick).toHaveBeenCalledOnce()
    expect(view.getByRole('button', { name: 'Download questions CSV' })).toBeTruthy()
  })

  it('the export menu is only the download icon until it opens', () => {
    const view = render(
      <ExportMenu items={[{ id: 'pdf', label: 'PDF', onSelect: () => undefined }]} />
    )
    const trigger = view.getByRole('button', { name: 'Download' })
    expect(trigger.textContent).toBe('')
  })

  it('search names what it searches; the filter bar keeps search on the right', () => {
    const onChange = vi.fn()
    const view = render(
      <FilterBar end={<SearchBox label="Search questions" value="" onChange={onChange} />}>
        <span>Scope</span>
      </FilterBar>
    )
    const box = view.getByRole('searchbox', { name: 'Search questions' })
    fireEvent.change(box, { target: { value: 'sms' } })
    expect(onChange).toHaveBeenCalledWith('sms')
    expect(box.closest('.ui-filterbar-end')).not.toBeNull()
  })
})
