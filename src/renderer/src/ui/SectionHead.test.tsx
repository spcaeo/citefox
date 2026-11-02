// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { axeViolations } from './axe.test-helper'
import { Button } from './Button'
import { SectionHead } from './SectionHead'

afterEach(cleanup)

describe('SectionHead', () => {
  it('shows the title with its count, the helper line, the actions and the AI slot', async () => {
    const view = render(
      <SectionHead
        title="Who gets cited"
        count={12}
        description="Sites the AI Overviews link to instead of you."
        actions={<Button size="sm">Export</Button>}
        ai={<button type="button">AI</button>}
        id="cited-head"
      />
    )
    const heading = view.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('Who gets cited12')
    expect(heading.id).toBe('cited-head')
    expect(heading.querySelector('.ui-sechead-count')?.textContent).toBe('12')
    expect(view.getByText(/instead of you/).className).toBe('ui-sechead-desc')
    const actions = view.container.querySelector('.ui-sechead-actions')
    expect([...(actions?.children ?? [])].map((node) => node.textContent)).toEqual(['Export', 'AI'])
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('leaves out what is not given and takes a heading level', () => {
    const view = render(<SectionHead title="Checks" level={3} className="x" />)
    expect(view.getByRole('heading', { level: 3 }).textContent).toBe('Checks')
    expect(view.container.querySelector('.ui-sechead-count')).toBeNull()
    expect(view.container.querySelector('.ui-sechead-actions')).toBeNull()
    expect(view.container.firstElementChild?.className).toBe('ui-sechead x')
  })
})
