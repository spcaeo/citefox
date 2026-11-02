// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistResult } from '@shared/ipc'
import { emitLocalAssistProgress } from '../assist/progress'
import { axeViolations } from './axe.test-helper'
import { SuggestionCard } from './SuggestionCard'
import { suggestionFootnote, suggestionItems } from './useAiSuggestion'

afterEach(cleanup)

const ITEMS = [
  { id: 'a', label: 'Who they are', text: 'MSP owners routing client alerts' },
  { id: 'b', label: 'Triggers', text: 'Told they need 10DLC just to text their own staff' }
]

describe('SuggestionCard', () => {
  it('applies only the ticked items and then offers Undo', () => {
    const onApply = vi.fn()
    const onUndo = vi.fn()
    const view = render(
      <SuggestionCard
        title="Fill gaps from your site"
        meta="7 additions across 5 sections · 2 shown"
        items={ITEMS}
        recheckCount={4}
        footnote="30 s · no searches"
        onApply={onApply}
        applyLabel="Review all 7"
        onUndo={onUndo}
        onClose={() => {}}
      />
    )
    const card = view.getByRole('region', { name: 'Fill gaps from your site' })
    // An AI suggestion is a card on the AI tint (theme.css .ui-tint).
    expect(card.classList.contains('ui-tint')).toBe(true)
    expect(card.getAttribute('data-tint')).toBe('ai')
    const boxes = view.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map((box) => box.checked)).toEqual([true, true])
    fireEvent.click(view.getByRole('checkbox', { name: /10DLC/ }))
    fireEvent.click(view.getByRole('button', { name: 'Review all 7' }))
    expect(onApply).toHaveBeenCalledWith(['a'])
    expect(view.queryByRole('button', { name: 'Review all 7' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(view.getByRole('button', { name: 'Review all 7' })).toBeTruthy()
  })

  it('shows the re-check row, disables Apply with nothing ticked, and closes', () => {
    const onClose = vi.fn()
    const view = render(
      <SuggestionCard
        title="Suggestion"
        items={ITEMS}
        selected={[]}
        recheckCount={1}
        onApply={() => {}}
        onClose={onClose}
      />
    )
    expect(view.getByText('1 fact to re-check before you rely on it')).toBeTruthy()
    expect((view.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'Dismiss suggestion' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reruns with the typed instruction from Try again or Enter', () => {
    const onRetry = vi.fn()
    const view = render(
      <SuggestionCard title="Suggestion" body="3 pairs" onRetry={onRetry} onClose={() => {}} />
    )
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenLastCalledWith(undefined)
    const box = view.getByPlaceholderText('Tell CiteFox AI what to change…')
    fireEvent.change(box, { target: { value: 'Shorter, please' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onRetry).toHaveBeenLastCalledWith('Shorter, please')
  })

  it('shows running and error states', () => {
    const view = render(
      <SuggestionCard title="Suggestion" status="running" onRetry={() => {}} onClose={() => {}} />
    )
    // The live panel replaces the old one-line status (owner feedback #1).
    expect(view.getByRole('region', { name: 'What CiteFox AI is doing' })).toBeTruthy()
    expect(view.getByRole('status').textContent).toBe('CiteFox AI is starting…')
    expect(view.queryByRole('button', { name: 'Try again' })).toBeNull()
    view.rerender(
      <SuggestionCard title="Suggestion" status="error" error="No answer" onClose={() => {}} />
    )
    expect(view.getByRole('alert').textContent).toBe('No answer')
  })

  it('follows the live steps of a run that starts while it is running', () => {
    const view = render(<SuggestionCard title="Suggestion" status="running" onClose={() => {}} />)
    const base = {
      runId: 'run-follow',
      channel: 'assist:run',
      scope: 'page.promises',
      stepId: 's1',
      kind: 'claude' as const,
      label: 'Asking CiteFox AI to list what the page promises',
      detail: null,
      startedAt: Date.now(),
      claude: {
        connection: 'claude-code' as const,
        connectionText: 'CiteFox AI · on your plan',
        model: 'claude-sonnet-4-5'
      }
    }
    act(() => emitLocalAssistProgress({ ...base, state: 'running', endedAt: null }))
    expect(view.getByRole('status').textContent).toBe(
      'Asking CiteFox AI to list what the page promises…'
    )
    expect(view.container.textContent).toContain('CiteFox AI · on your plan')
    act(() => emitLocalAssistProgress({ ...base, state: 'done', endedAt: Date.now() + 3000 }))
    view.rerender(<SuggestionCard title="Suggestion" items={ITEMS} onClose={() => {}} />)
    expect(view.getByRole('button', { name: /^1 step · / })).toBeTruthy()
  })

  it('maps an assist result to items and a footnote', () => {
    const result: AssistResult = {
      runId: 'r1',
      assistId: 'x',
      title: 'Fill gaps',
      summary: null,
      items: [
        { id: 'i1', text: 'A', detail: 'why', tag: 'Triggers', verify: null, sign: null },
        { id: 'i2', text: 'B', detail: null, tag: null, verify: 'Price $9', sign: null }
      ],
      caution: null,
      label: {
        connection: 'claude-code',
        connectionText: 'CiteFox AI · on your plan',
        expectedSeconds: 20,
        text: 'CiteFox AI · on your plan · about 20 s'
      },
      savedDataOnly: true,
      searchesUsed: 0,
      durationMs: 19_600,
      model: null
    }
    expect(suggestionFootnote(result)).toBe('CiteFox AI · about 20 s · no searches')
    expect(suggestionItems(result)).toEqual([
      { id: 'i1', text: 'A', label: 'Triggers', detail: 'why' },
      { id: 'i2', text: 'B', detail: '[Re-check] Price $9' }
    ])
  })

  it('is axe clean', async () => {
    const view = render(
      <SuggestionCard
        title="Fill gaps from your site"
        items={ITEMS}
        recheckCount={4}
        onApply={() => {}}
        onRetry={() => {}}
        onClose={() => {}}
      />
    )
    expect(await axeViolations(view.container)).toEqual([])
  })
})
