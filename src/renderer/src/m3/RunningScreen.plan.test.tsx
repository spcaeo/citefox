// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BuyerPrompt } from '@shared/domain'
import { TEXTBOLT_MARKETS, TEXTBOLT_PAGE_ID } from './fixtures'
import { checkStartCopy } from './checkPlan'
import { RunningScreen } from './RunningScreen'

afterEach(() => {
  cleanup()
})

function prompt(id: string, position: number, enabled: boolean): BuyerPrompt {
  return {
    id,
    position,
    label: `Question ${position}`,
    source: 'written_by_user',
    intentStage: 'problem',
    mappedElement: '',
    enabled,
    variants: [
      { marketId: 'us-en', language: 'en', text: `Question ${position}?`, originalText: null }
    ]
  }
}

describe('Running screen before a check starts', () => {
  it('says what the first check will run from the enabled questions', () => {
    const view = render(
      <RunningScreen
        pageId={TEXTBOLT_PAGE_ID}
        samples={2}
        markets={TEXTBOLT_MARKETS}
        job={null}
        promptCatalog={[prompt('a', 1, true), prompt('b', 2, true), prompt('c', 3, false)]}
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    )
    expect(view.getByText('No check is running.')).toBeTruthy()
    expect(view.getByText(/searches per question/).textContent).toBe(
      `Checking 2 questions in each market · 1–2 searches per question, market and sample: up to ${
        2 * TEXTBOLT_MARKETS.length * 2 * 2
      } searches`
    )
  })

  it('leaves the plan out when no question is enabled', () => {
    const view = render(
      <RunningScreen
        pageId={TEXTBOLT_PAGE_ID}
        samples={1}
        markets={TEXTBOLT_MARKETS}
        job={null}
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    )
    expect(view.queryByText(/searches per question/)).toBeNull()
  })
})

describe('Running screen after the page has been checked', () => {
  it('offers Check now instead of a first check', () => {
    const view = render(
      <RunningScreen
        pageId={TEXTBOLT_PAGE_ID}
        samples={1}
        markets={TEXTBOLT_MARKETS}
        job={null}
        checkedBefore
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    )
    expect(view.getByRole('heading', { level: 1, name: 'Check now' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Check now' })).toBeTruthy()
    expect(view.queryByText('First check')).toBeNull()
    expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()
    expect(view.getByRole('link', { name: /Check$/ }).getAttribute('aria-current')).toBe('step')
  })
})

describe('Running screen when the check has finished', () => {
  it('drops the "you can close this window" note', () => {
    const view = render(
      <RunningScreen
        pageId={TEXTBOLT_PAGE_ID}
        samples={1}
        markets={TEXTBOLT_MARKETS}
        job={null}
        finished
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    )
    expect(view.getByRole('link', { name: /View results/ })).toBeTruthy()
    expect(view.queryByText(/You can close this window/)).toBeNull()
  })
})

describe('checkStartCopy', () => {
  it('names the first check only before any check', () => {
    expect(checkStartCopy(false).button).toBe('Start first check')
    expect(checkStartCopy(true)).toEqual({
      heading: 'Check now',
      button: 'Check now',
      step: 'Check'
    })
  })
})
