// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DrillHost } from '../../drill'
import { AskCounts, AskResults } from './AskResults'
import { positionText } from './format'
import { askMockQuestion } from './rows.fixtures.test-helper'

afterEach(cleanup)

describe('Ask CiteFox list answers', () => {
  it('counts the matched rows and lists them with their market and status', () => {
    const answer = askMockQuestion({
      projectId: 'proj-1',
      question: 'Where is my page not cited in the UK?'
    })
    expect(answer.rows.length).toBeGreaterThan(0)
    render(
      <DrillHost>
        <AskCounts rows={answer.rows} total={answer.total} projectId="proj-1" />
        <AskResults rows={answer.rows} total={answer.total} projectId="proj-1" />
      </DrillHost>
    )
    expect(document.querySelector('.ask-counts-line')?.textContent).toMatch(/question check/)
    const grid = screen.getByRole('grid', { name: 'Matching question checks' })
    const first = answer.rows[0]
    expect(first).toBeDefined()
    if (first) expect(within(grid).getAllByText(first.marketLabel).length).toBeGreaterThan(0)
  })

  it('writes positions as #n or a dash', () => {
    expect(positionText(2)).toBe('#2')
    expect(positionText(1.25)).toBe('#1.3')
    expect(positionText(null)).toBe('—')
  })
})
