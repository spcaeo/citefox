// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { questionRow } from '../questions.fixtures.test-helper'
import { ResultCell } from './cells'

afterEach(cleanup)

const notYet = {
  result: 'not_checked',
  status: null,
  checkedAt: null,
  runId: null
} as const

describe('ResultCell while a check runs', () => {
  it('says "Checking…" and "Waiting", never "Not checked" or a red mark', () => {
    for (const [live, words] of [
      ['checking', 'Checking…'],
      ['waiting', 'Waiting']
    ] as const) {
      const view = render(
        <ResultCell
          row={questionRow({ promptId: 'q1', sourceId: 'g1', text: 'q', ...notYet, live })}
        />
      )
      expect(view.container.textContent).toBe(words)
      expect(view.container.querySelector('.ui-chip')).toBeNull()
      cleanup()
    }
  })

  it('shows the saved answer once it is in, and "Not checked" when no check runs', () => {
    const answered = render(
      <ResultCell row={questionRow({ promptId: 'q1', sourceId: 'g1', text: 'q', live: null })} />
    )
    expect(answered.container.textContent).not.toMatch(/Waiting|Checking/u)
    cleanup()
    const idle = render(
      <ResultCell row={questionRow({ promptId: 'q1', sourceId: 'g1', text: 'q', ...notYet })} />
    )
    expect(idle.container.textContent).toBe('Not checked')
  })
})
