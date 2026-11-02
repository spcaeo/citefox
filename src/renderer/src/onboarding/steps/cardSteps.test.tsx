// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect, useLayoutEffect, useRef, type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetupDraft } from '@shared/ipc'
import { fakeSectionClient, item, row, textboltDraft } from '../sections/fakeClient.test-helper'
import { StepHarness } from '../sections/StepHarness.test-helper'
import { BrandStep } from './BrandStep'
import { BuyersStep } from './BuyersStep'
import { CompetitorsStep } from './CompetitorsStep'
import { QuestionsStep } from './QuestionsStep'
import type { SetupStepProps } from './types'
import { usePromptWriter } from './usePromptWriter'

/** Step 9 as OnboardingApp shows it: the writer starts when the prompts are empty. */
function Questions(props: SetupStepProps): JSX.Element {
  const ref = useRef(props.draft)
  useLayoutEffect(() => {
    ref.current = props.draft
  })
  const writer = usePromptWriter({
    sections: props.sections,
    draftRef: ref,
    onDraft: props.onDraft,
    announce: props.announce
  })
  const { write } = writer
  useEffect(() => {
    const draft = ref.current
    if (draft.lists.questions.length === 0) write(draft.questionsMix ?? draft.mix)
  }, [write])
  return <QuestionsStep {...props} writer={writer} />
}

afterEach(cleanup)

beforeEach(() => {
  window.location.hash = '#/setup/brand'
})

function primary(name: RegExp | string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

function footNote(): string {
  return screen.getByRole('status').textContent ?? ''
}

describe('BrandStep (step 4)', () => {
  it('shows the frame from the mock-up and needs a summary and a kept brand', () => {
    const onContinue = vi.fn()
    render(
      <StepHarness
        Step={BrandStep}
        initial={textboltDraft({
          brands: [item('TextBolt'), item('Text Bolt')],
          products: [item('Email-to-SMS gateway', { url: '/email-to-text/' }), item('SMS API')]
        })}
        client={fakeSectionClient()}
        onContinue={onContinue}
      />
    )
    expect(screen.getByText('Step 4 of 9')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Is this right about TextBolt?'
    )
    expect(screen.getByRole('heading', { name: 'What TextBolt does' })).toBeTruthy()
    expect(footNote()).toBe('2 products · 2 names')
    const go = primary(/Looks right, continue/)
    expect(go.disabled).toBe(false)
    fireEvent.click(go)
    expect(onContinue).toHaveBeenCalledTimes(1)
    // The product's page shows with Copy and Open (UrlText).
    expect(
      within(screen.getByTestId('section-products')).getByRole('link', {
        name: /Open \/email-to-text\/ in a new tab/
      })
    ).toBeTruthy()
  })

  it('names the brand by its own name, not a new or host-like one, and shows / as homepage', () => {
    render(
      <StepHarness
        Step={BrandStep}
        initial={textboltDraft(
          {
            brands: [
              item('TextBolt.com', { fresh: true }),
              item('Text Bolt SMS'),
              item('TextBolt')
            ],
            products: [item('Email to SMS', { url: '/' })]
          },
          { site: { ...textboltDraft().site, projectName: '' } }
        )}
        client={fakeSectionClient()}
      />
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Is this right about TextBolt?'
    )
    expect(within(screen.getByTestId('section-products')).getByText('homepage')).toBeTruthy()
  })

  it('stays off with no summary or no kept brand, and says why', () => {
    const { unmount } = render(
      <StepHarness
        Step={BrandStep}
        initial={textboltDraft({ brands: [item('TextBolt')] }, { summary: '' })}
        client={fakeSectionClient()}
      />
    )
    expect(primary(/Looks right, continue/).disabled).toBe(true)
    expect(footNote()).toBe('Add what TextBolt does to continue')
    unmount()
    render(<StepHarness Step={BrandStep} initial={textboltDraft()} client={fakeSectionClient()} />)
    expect(primary(/Looks right, continue/).disabled).toBe(true)
    expect(footNote()).toBe('Keep at least one brand name to continue')
  })

  it('saves a summary typed with ✎ Edit as the user’s own', async () => {
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={BrandStep}
        initial={textboltDraft({ brands: [item('TextBolt')] }, { summary: '' })}
        client={fakeSectionClient()}
        onDraftSeen={(draft) => (seen = draft)}
      />
    )
    const summary = screen.getByTestId('section-summary')
    fireEvent.click(within(summary).getByRole('button', { name: 'Edit' }))
    const box = await within(summary).findByLabelText('What TextBolt does')
    fireEvent.change(box, { target: { value: 'Texts from email.' } })
    fireEvent.click(within(summary).getByRole('button', { name: 'Save' }))
    expect(seen!.summary).toBe('Texts from email.')
    expect(seen!.summaryOrigin).toBe('user')
    expect(primary(/Looks right, continue/).disabled).toBe(false)
  })

  it('busy shows on the primary and blocks it', () => {
    render(
      <StepHarness
        Step={BrandStep}
        initial={textboltDraft({ brands: [item('TextBolt')] })}
        client={fakeSectionClient()}
        busy
      />
    )
    expect(primary(/Looks right, continue/).disabled).toBe(true)
  })
})

describe('BuyersStep (step 5)', () => {
  it('needs at least one kept buyer', () => {
    render(
      <StepHarness
        Step={BuyersStep}
        initial={textboltDraft({
          buyers: [item('IT sysadmin'), item('Clinic manager'), item('Librarian', { kept: false })]
        })}
        client={fakeSectionClient()}
      />
    )
    expect(footNote()).toBe('2 of 3 buyers kept')
    expect(primary(/^Continue/).disabled).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep IT sysadmin' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep Clinic manager' }))
    expect(primary(/^Continue/).disabled).toBe(true)
    expect(footNote()).toBe('Keep at least one buyer to continue')
  })
})

describe('CompetitorsStep (step 6)', () => {
  it('needs nothing, counts new rows, and shows domains with Copy and Open', () => {
    window.location.hash = '#/setup/competitors'
    render(
      <StepHarness
        Step={CompetitorsStep}
        initial={textboltDraft({
          competitors: [
            item('Notifyre', { url: 'notifyre.com', fresh: true }),
            item('Textmagic', { url: 'textmagic.com', tag: 'Email-to-SMS' }),
            item('Twilio', { url: 'twilio.com', tier: 'partial', kept: false })
          ],
          switchingFrom: [item('AT&T gateway')],
          integrations: [item('Gmail'), item('Outlook')]
        })}
        client={fakeSectionClient()}
      />
    )
    expect(footNote()).toBe('2 competitors · 1 new')
    expect(primary(/^Continue/).disabled).toBe(false)
    const card = screen.getByTestId('section-competitors')
    expect(within(card).getByText('Email-to-SMS')).toBeTruthy()
    expect(within(card).getByText('Partial overlap')).toBeTruthy()
    expect(within(card).getByRole('link', { name: /Open twilio\.com/ })).toBeTruthy()
    expect(screen.getByTestId('line-integrations').textContent).toContain('Gmail, Outlook')
  })

  it('adds a competitor from a domain and edits a "not rivals" line', async () => {
    window.location.hash = '#/setup/competitors'
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={CompetitorsStep}
        initial={textboltDraft({ switchingFrom: [item('AT&T gateway', { id: 's1' })] })}
        client={fakeSectionClient()}
        onDraftSeen={(draft) => (seen = draft)}
      />
    )
    const input = screen.getByLabelText('Add a competitor')
    fireEvent.change(input, { target: { value: 'https://www.notifyre.com/pricing' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(seen!.lists.competitors[0]).toMatchObject({
      name: 'Notifyre',
      url: 'notifyre.com',
      origin: 'user'
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit They switch from' }))
    const line = await screen.findByLabelText('They switch from')
    fireEvent.change(line, { target: { value: 'AT&T gateway, Verizon vtext' } })
    fireEvent.keyDown(line, { key: 'Enter' })
    expect(seen!.lists.switchingFrom.map((entry) => [entry.id, entry.name])).toEqual([
      ['s1', 'AT&T gateway'],
      [expect.any(String), 'Verizon vtext']
    ])
  })
})

describe('QuestionsStep (step 9)', () => {
  const questions = [
    item('Our Datadog alerts to the AT&T gateway stopped. What changed?', {
      tag: 'problem',
      url: '/email-to-text/'
    }),
    item('What does an email-to-text replacement cost?', { tag: 'decide', url: '/pricing/' })
  ]

  it('finishes with "Finish and run the first check" and shows footNote', () => {
    window.location.hash = '#/setup/questions'
    const onContinue = vi.fn()
    render(
      <StepHarness
        Step={Questions}
        initial={textboltDraft({ questions }, { topic: 'Replacing a carrier gateway' })}
        client={fakeSectionClient()}
        onContinue={onContinue}
        footNote="First check: 2 questions × 2 answers · 28 credits"
      />
    )
    expect(footNote()).toBe('First check: 2 questions × 2 answers · 28 credits')
    const go = primary('Finish and run the first check')
    expect(go.disabled).toBe(false)
    fireEvent.click(go)
    expect(onContinue).toHaveBeenCalledTimes(1)
    const card = screen.getByTestId('section-questions')
    expect(within(card).getByRole('button', { name: /Write more/ })).toBeTruthy()
    expect(within(card).getByText(/Problem/)).toBeTruthy()
  })

  it('needs a topic and a kept question', () => {
    window.location.hash = '#/setup/questions'
    const { unmount } = render(
      <StepHarness
        Step={Questions}
        initial={textboltDraft({ questions })}
        client={fakeSectionClient()}
      />
    )
    expect(primary('Finish and run the first check').disabled).toBe(true)
    expect(footNote()).toBe('Add a topic to finish')
    unmount()
    render(
      <StepHarness
        Step={Questions}
        initial={textboltDraft({}, { topic: 'A topic' })}
        client={fakeSectionClient()}
      />
    )
    expect(primary('Finish and run the first check').disabled).toBe(true)
    expect(footNote()).toBe('Keep at least one prompt to finish')
  })

  it('writes an empty topic on arrival, then the questions from that topic', async () => {
    window.location.hash = '#/setup/questions'
    const client = fakeSectionClient({
      text: 'Replacing a carrier email-to-text gateway',
      rows: { questions: [row('Why did my AT&T email-to-text stop?', { tag: 'problem' })] }
    })
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={Questions}
        initial={textboltDraft({ brands: [item('TextBolt')] })}
        client={client}
        onDraftSeen={(draft) => {
          seen = draft
        }}
      />
    )
    expect(await screen.findByText('Why did my AT&T email-to-text stop?')).toBeTruthy()
    const calls = client.sectionRun.mock.calls.map(([request]) => request)
    expect(calls.map((request) => request.section)).toEqual(['topic', 'questions'])
    expect(calls[1]?.context.topic).toBe('Replacing a carrier email-to-text gateway')
    expect(seen!.topic).toBe('Replacing a carrier email-to-text gateway')
    expect(seen!.lists.questions[0]).toMatchObject({ origin: 'ai', kept: true, fresh: false })
    expect(primary('Finish and run the first check').disabled).toBe(false)
  })

  it('writes nothing on arrival without CiteFox AI, or when both are there', async () => {
    window.location.hash = '#/setup/questions'
    const without = fakeSectionClient({ available: false, text: 'A topic' })
    const { unmount } = render(
      <StepHarness Step={Questions} initial={textboltDraft()} client={without} />
    )
    await vi.waitFor(() => expect(without.sectionEstimate).toHaveBeenCalled())
    expect(without.sectionRun).not.toHaveBeenCalled()
    unmount()
    const full = fakeSectionClient({ text: 'Other' })
    render(
      <StepHarness
        Step={Questions}
        initial={textboltDraft({ questions }, { topic: 'Mine' })}
        client={full}
      />
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(full.sectionRun).not.toHaveBeenCalled()
    expect(screen.getByText('Mine')).toBeTruthy()
  })
})

describe('step 9 prompt shapes', () => {
  it('tags each prompt with its shape and writes 3 more of one shape on top', async () => {
    window.location.hash = '#/setup/questions'
    const client = fakeSectionClient({
      rows: {
        questions: [
          row('Our alerts stopped last week. We are a small plant. What now?', {
            detail: 'situation'
          }),
          row('email to text', { detail: 'search' })
        ]
      }
    })
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={Questions}
        initial={textboltDraft(
          { questions: [item('sms gateway price', { detail: 'search', tag: 'decide' })] },
          { topic: 'Replacing a gateway' }
        )}
        client={client}
        onDraftSeen={(draft) => {
          seen = draft
        }}
      />
    )
    const card = screen.getByTestId('section-questions')
    expect(within(card).getByText('Short search')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '3 more situations' }))
    expect(
      await screen.findByText('Our alerts stopped last week. We are a small plant. What now?')
    ).toBeTruthy()
    const request = client.sectionRun.mock.calls[0]?.[0]
    expect(request).toMatchObject({
      section: 'questions',
      mode: 'more',
      context: { mix: { search: 0, question: 0, situation: 3 } }
    })
    // Only the situation came back on top; the search was not asked for.
    expect(seen!.lists.questions.map((entry) => entry.name)).toEqual([
      'Our alerts stopped last week. We are a small plant. What now?',
      'sms gateway price'
    ])
  })

  it('says when the first check needs more credits than the keys have', () => {
    window.location.hash = '#/setup/questions'
    render(
      <QuestionsStep
        draft={textboltDraft({ questions: [item('a prompt')] }, { topic: 'A topic' })}
        onDraft={() => undefined}
        sections={fakeSectionClient()}
        onBack={() => undefined}
        onContinue={() => undefined}
        busy={false}
        alert={null}
        announce={() => undefined}
        writer={{ writing: null, error: null, write: vi.fn(), more: vi.fn() }}
        creditWarning="Your cloro keys have 85 credits left, less than this first check needs."
      />
    )
    expect(screen.getByText(/85 credits left, less than this first check needs/)).toBeTruthy()
  })
})

describe('accessibility', () => {
  it('has no axe violations with the menu, a row editor and a panel open', async () => {
    const { axeViolations } = await import('../../ui/axe.test-helper')
    window.location.hash = '#/setup/buyers?open=buyers.menu&edit=r2'
    const draft = textboltDraft({
      buyers: [item('IT sysadmin', { id: 'r1' }), item('Clinic manager', { id: 'r2' })],
      triggers: [item('AT&T gateway shut down', { fresh: true })]
    })
    const view = render(
      <StepHarness Step={BuyersStep} initial={draft} client={fakeSectionClient()} />
    )
    await screen.findByRole('menu')
    expect(await axeViolations(view.container)).toEqual([])
    cleanup()
    window.location.hash = '#/setup/buyers?open=triggers.prompt'
    const again = render(
      <StepHarness Step={BuyersStep} initial={draft} client={fakeSectionClient()} />
    )
    await screen.findByTestId('prompt-editor')
    expect(await axeViolations(again.container)).toEqual([])
  })
})
