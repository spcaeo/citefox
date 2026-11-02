// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { axeViolations } from './axe.test-helper'
import { Button } from './Button'
import { Panel, RightRail } from './Panel'

afterEach(cleanup)

describe('Panel and RightRail', () => {
  it('renders a titled panel with actions inside a labelled rail', () => {
    const view = render(
      <RightRail label="Topic context">
        <Panel title="Version 2" titleAs="h3" actions={<Button size="sm">Use version 1</Button>}>
          <p>Written just now</p>
        </Panel>
        <Panel label="Notes" tone="inset" padding={16}>
          <p>Plain</p>
        </Panel>
      </RightRail>
    )
    const rail = view.getByRole('complementary', { name: 'Topic context' })
    expect(rail.className).toBe('ui-rail')
    const panel = view.getByRole('region', { name: 'Version 2' })
    expect(panel.querySelector('h3')?.textContent).toBe('Version 2')
    expect(view.getByRole('button', { name: 'Use version 1' })).toBeTruthy()
    const inset = view.getByRole('region', { name: 'Notes' })
    expect(inset.className).toContain('ui-panel-inset')
    expect(inset.style.padding).toBe('16px')
  })

  it('is axe clean', async () => {
    const view = render(
      <div>
        <Panel title="Suggestion">
          <p>Body</p>
        </Panel>
      </div>
    )
    expect(await axeViolations(view.container)).toEqual([])
  })
})
