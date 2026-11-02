// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GroupHint } from './GroupHint'

afterEach(cleanup)

describe('GroupHint', () => {
  it('writes the result’s "What to do" line in a group row, with the full line as its tooltip', () => {
    const view = render(<GroupHint result="not_cited" />)
    const hint = view.container.querySelector('.ui-group-hint')
    expect(hint?.textContent).toBe('What to do: Improve the target page, highest win odds first.')
    expect(hint?.getAttribute('title')).toBe(
      'What to do: Improve the target page, highest win odds first.'
    )
  })

  it('names the next check for No AI Overview', () => {
    const view = render(<GroupHint result="no_overview" nextCheckAt="2026-10-30T10:27:00.000Z" />)
    expect(view.container.textContent).toMatch(/Nothing to do; checked again Oct 30/)
  })

  it('takes the screen’s own advice, boxed with the result colour on a drill page', () => {
    const view = render(
      <GroupHint result="not_cited" variant="block" text="Add a troubleshooting section." />
    )
    const block = view.container.querySelector<HTMLElement>('.ui-group-hint-block')
    expect(block?.textContent).toBe('What to do: Add a troubleshooting section.')
    expect(block?.style.getPropertyValue('--hint-colour')).toBe('var(--result-not-cited)')
    expect(block?.getAttribute('title')).toBeNull()
  })

  it('draws nothing with no result and no text', () => {
    const view = render(<GroupHint />)
    expect(view.container.innerHTML).toBe('')
  })
})
