// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { axeViolations } from './axe.test-helper'
import { Badge, Chip } from './Chip'

afterEach(cleanup)

describe('Chip and Badge', () => {
  it('maps tone and size to classes and draws an optional dot', () => {
    const view = render(
      <>
        <Chip>Problem</Chip>
        <Chip tone="fox" dot>
          Cited · you
        </Chip>
        <Chip tone="ok" size="sm">
          High match
        </Chip>
      </>
    )
    expect(view.getByText('Problem').className).toBe('ui-chip ui-chip-neutral')
    const fox = view.getByText('Cited · you')
    expect(fox.className).toBe('ui-chip ui-chip-fox')
    expect(fox.querySelector('.ui-dot')?.getAttribute('aria-hidden')).toBe('true')
    expect(view.getByText('High match').className).toBe('ui-chip ui-chip-ok ui-chip-sm')
  })

  it('adds screen-reader words to a terse chip or a bare count', () => {
    const view = render(
      <>
        <Chip tone="warn" label="Win odds">
          High
        </Chip>
        <Badge label="6 keywords">6</Badge>
      </>
    )
    expect(view.getByText('High').textContent).toBe('Win odds: High')
    const badge = view.container.querySelector('.ui-badge')
    expect(badge?.textContent).toBe('66 keywords')
    expect(badge?.querySelector('[aria-hidden="true"]')?.textContent).toBe('6')
  })

  it('is axe clean in every tone', async () => {
    const view = render(
      <div>
        {(['neutral', 'fox', 'ok', 'warn', 'bad', 'info'] as const).map((tone) => (
          <Chip key={tone} tone={tone}>
            {tone}
          </Chip>
        ))}
        <Badge>8</Badge>
      </div>
    )
    expect(await axeViolations(view.container)).toEqual([])
  })
})
