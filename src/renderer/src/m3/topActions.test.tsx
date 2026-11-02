// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEXTBOLT_PAGE, TEXTBOLT_PAGE_ID, textboltResults } from './fixtures'
import { PageResultsScreen } from './PageResultsScreen'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
})

function renderResults(nextFixNumber: number): ReturnType<typeof render> {
  const results = textboltResults()
  const view = render(
    <PageResultsScreen
      pageId={TEXTBOLT_PAGE_ID}
      projectName="Harbor"
      page={TEXTBOLT_PAGE}
      marketId="us"
      results={{ ...results, scope: { ...results.scope, nextFixNumber } }}
      chrome={false}
    />
  )
  const tablist = view.getByRole('tablist', { name: 'Results sections' })
  fireEvent.click(within(tablist).getByRole('tab', { name: /^Top actions/ }))
  return view
}

describe('Top actions this week', () => {
  it('numbers the plan link from the page’s logged fixes', () => {
    const view = renderResults(4)
    expect(view.getByRole('link', { name: 'Plan as Fix 4' })).toBeTruthy()
    expect(view.queryByRole('link', { name: 'Plan as Fix 2' })).toBeNull()
  })

  it('opens the Progress fix form with the actions and their questions (FR-14.5)', () => {
    const results = textboltResults()
    const view = renderResults(4)
    const href = view.getByRole('link', { name: 'Plan as Fix 4' }).getAttribute('href') ?? ''
    expect(
      href.startsWith(`#/pages/${TEXTBOLT_PAGE_ID}/progress?view=fixes&drawer=fix&fix=new`)
    ).toBe(true)
    const params = new URLSearchParams(href.split('?')[1])
    const expected = results.topActions.flatMap((action) =>
      action.promptId === null ? [] : [action.promptId]
    )
    expect(params.get('fix.prompts')).toBe([...new Set(expected)].join(','))
    expect(params.get('fix.text')?.split('\n')[0]).toBe(`1. ${results.topActions[0]?.text ?? ''}`)
  })

  it('copies every action to the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const view = renderResults(1)
    fireEvent.click(view.getByRole('button', { name: 'Copy top actions' }))
    await waitFor(() => {
      expect(view.getByRole('button', { name: 'Copied' })).toBeTruthy()
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    const text = String(writeText.mock.calls[0]?.[0 as never] ?? '')
    const first = textboltResults().topActions[0]
    if (!first) throw new Error('fixture has no actions')
    expect(text).toContain('Top actions this week')
    expect(text).toContain(`1. ${first.text}`)
    expect(text).toContain(first.reason)
  })

  it('falls back to a hidden text area when the clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    const view = renderResults(1)
    fireEvent.click(view.getByRole('button', { name: 'Copy top actions' }))
    await waitFor(() => {
      expect(view.getByRole('button', { name: 'Copied' })).toBeTruthy()
    })
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea[data-clipboard]')).toBeNull()
  })
})
