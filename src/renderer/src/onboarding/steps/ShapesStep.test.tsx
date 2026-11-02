// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiKeyMetadata } from '@shared/domain'
import type { SetupDraft } from '@shared/ipc'
import { fakeSectionClient, item, textboltDraft } from '../sections/fakeClient.test-helper'
import { ShapesStep } from './ShapesStep'

afterEach(() => {
  cleanup()
  delete (window as { citefox?: unknown }).citefox
})

beforeEach(() => {
  window.location.hash = '#/setup/shapes'
})

function cloroKey(remaining: number): ApiKeyMetadata {
  return {
    id: 'k1',
    provider: 'cloro',
    name: 'cloro',
    on: true,
    state: 'ok',
    serpapiUsage: null,
    cloroCredits: { remaining, perCycle: null, resetsAt: null }
  } as ApiKeyMetadata
}

function Harness({
  initial,
  keys = [],
  onContinue = () => undefined,
  onDraftSeen,
  examplesError = null
}: {
  initial: SetupDraft
  keys?: readonly ApiKeyMetadata[]
  onContinue?: () => void
  onDraftSeen?: (draft: SetupDraft) => void
  examplesError?: string | null
}): JSX.Element {
  const [draft, setDraft] = useState(initial)
  onDraftSeen?.(draft)
  return (
    <ShapesStep
      draft={draft}
      onDraft={setDraft}
      sections={fakeSectionClient()}
      onBack={() => undefined}
      onContinue={onContinue}
      busy={false}
      alert={null}
      announce={() => undefined}
      keys={keys}
      engineOptions={[]}
      examples={{ busy: false, error: examplesError, retry: () => undefined }}
      claudeAvailable={true}
    />
  )
}

const examples = [
  item('email to text service', {
    tag: 'search',
    detail: 'See whether Google’s AI quotes your home page.'
  }),
  item('Our carrier shut down email-to-text. What should we use?', {
    tag: 'situation',
    detail: 'See whether ChatGPT names you to a buyer in a hurry.'
  })
]

describe('ShapesStep (step 8)', () => {
  it('shows the three shapes with this site’s examples and the outcome', () => {
    render(<Harness initial={textboltDraft({ examples, brands: [item('TextBolt')] })} />)
    expect(screen.getByText('Step 8 of 9')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('How do your buyers ask AI?')
    expect(screen.getByText('How often AI names TextBolt, engine by engine')).toBeTruthy()
    const search = screen.getByRole('region', { name: 'Short searches' })
    expect(within(search).getByText('email to text service')).toBeTruthy()
    expect(within(search).getByText('See whether Google’s AI quotes your home page.')).toBeTruthy()
    // No example for questions yet: the generic one shows.
    const question = screen.getByRole('region', { name: 'Questions' })
    expect(within(question).getByText('how do I send a text from Gmail?')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Keyword, question or prompt?' })).toBeTruthy()
  })

  it('warns when the first check needs more credits than the key has, and fits the mix', () => {
    let seen: SetupDraft | null = null
    // Two engines ticked on step 7 (new setups start with Google AI Overview only).
    const twoEngines = textboltDraft()
    render(
      <Harness
        initial={{
          ...twoEngines,
          search: { ...twoEngines.search, engines: ['google_aio', 'chatgpt'] }
        }}
        keys={[cloroKey(85)]}
        onDraftSeen={(draft) => {
          seen = draft
        }}
      />
    )
    expect(screen.getByText(/12 prompts × 2 answers · 168 credits/)).toBeTruthy()
    expect(screen.getByText(/have 85 credits left, enough for 6 prompts/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Fit to my credits' }))
    expect(seen!.mix).toEqual({ search: 2, question: 2, situation: 2 })
    expect(screen.getByText(/6 prompts × 2 answers · 84 credits/)).toBeTruthy()
    expect(screen.getByText(/so it fits/)).toBeTruthy()
  })

  it('changes a count with the stepper', () => {
    let seen: SetupDraft | null = null
    render(
      <Harness
        initial={textboltDraft()}
        onDraftSeen={(draft) => {
          seen = draft
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'More situations' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fewer short searches' }))
    expect(seen!.mix).toEqual({ search: 3, question: 4, situation: 5 })
  })

  it('takes a pasted list as the user’s own prompts, each with its shape', () => {
    let seen: SetupDraft | null = null
    const onContinue = vi.fn()
    render(
      <Harness
        initial={textboltDraft({}, { mix: { search: 0, question: 0, situation: 0 } })}
        onContinue={onContinue}
        onDraftSeen={(draft) => {
          seen = draft
        }}
      />
    )
    expect(
      (screen.getByRole('button', { name: 'Continue with my list' }) as HTMLButtonElement).disabled
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Paste prompts' }))
    fireEvent.change(screen.getByLabelText('Your own prompts, one per line'), {
      target: { value: '- sms api for clinics\nwhat is the best way to text patients?\n\n' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add to my prompts' }))
    expect(seen!.lists.questions.map((entry) => [entry.name, entry.detail, entry.origin])).toEqual([
      ['sms api for clinics', 'search', 'user'],
      ['what is the best way to text patients?', 'question', 'user']
    ])
    const go = screen.getByRole('button', { name: 'Continue with my list' }) as HTMLButtonElement
    expect(go.disabled).toBe(false)
    fireEvent.click(go)
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})

describe('ShapesStep while Claude Code waits out a usage limit', () => {
  it('shows when Claude is back in place of Try again, and the API key way goes to step 2', async () => {
    ;(window as { citefox?: unknown }).citefox = {
      'claudeCode:getPause': async () => ({
        until: '2026-11-01T11:02:00.000Z',
        resetsAt: '2026-11-01T11:00:00.000Z',
        kind: 'weekly',
        availableAgain: 'Sunday, Nov 1 at 7:00 AM',
        hasApiKey: false
      }),
      'claudeCode:pauseChanged': () => () => undefined
    }
    render(
      <Harness
        initial={textboltDraft({ examples })}
        examplesError="You've reached your weekly Claude usage limit. You can wait or add an Anthropic API key in Connections and keys."
      />
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    const wait = screen.getByRole('button', { name: 'Available again Sunday, Nov 1 at 7:00 AM' })
    expect((wait as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: 'Use an API key instead' }).getAttribute('href')).toBe(
      '#/setup/claude'
    )
    expect(screen.getByRole('link', { name: 'Connections and keys' }).getAttribute('href')).toBe(
      '#/setup/claude'
    )
  })

  it('keeps Try again when Claude is not paused', async () => {
    render(
      <Harness initial={textboltDraft({ examples })} examplesError="Claude is busy right now." />
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
