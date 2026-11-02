// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PromptQuestion } from './PromptQuestion'
import { promptQuestionName, questionText } from './promptText'

afterEach(() => cleanup())

describe('PromptQuestion', () => {
  it('shows the full question first and the label after it', () => {
    const view = render(
      <PromptQuestion text="How do I alert the crew without a developer?" label="Crew alerts" />
    )
    expect(view.container.textContent).toBe(
      'How do I alert the crew without a developer? · Crew alerts'
    )
  })

  it('leaves the label out when it is the question, and falls back to it with no text', () => {
    expect(
      render(<PromptQuestion text="sms pricing" label="SMS pricing" />).container.textContent
    ).toBe('sms pricing')
    cleanup()
    expect(render(<PromptQuestion text="" label="Crew alerts" />).container.textContent).toBe(
      'Crew alerts'
    )
    expect(questionText({ text: 'How do I **alert** the crew?', label: 'Crew' })).toBe(
      'How do I alert the crew?'
    )
  })

  it('gives links an accessible name with the words it shows', () => {
    const prompt = { text: 'How do I **alert** the crew?', label: 'Crew alerts' }
    const shown = render(<PromptQuestion {...prompt} />).container.textContent
    expect(promptQuestionName(prompt)).toBe(shown)
    expect(promptQuestionName({ text: 'sms pricing', label: 'SMS pricing' })).toBe('sms pricing')
    expect(promptQuestionName({ text: '', label: 'Crew alerts' })).toBe('Crew alerts')
  })
})
