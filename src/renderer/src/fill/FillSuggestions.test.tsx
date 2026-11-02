// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { IDLE_PROGRESS, type AssistProgressView } from '../ui'
import { FillSuggestions } from './FillSuggestions'
import type { FillState } from './useFillFromWebsite'

afterEach(cleanup)

function state(message: string, nextStep: string | null, live = IDLE_PROGRESS): FillState {
  return {
    result: {
      domain: 'textbolt.com',
      pagesRead: [],
      brands: [],
      competitors: [],
      switchingFrom: [],
      integrations: [],
      suggestedMarket: null,
      message,
      nextStep
    },
    error: null,
    filling: false,
    progress: null,
    live,
    origin: 'website',
    run: () => Promise.resolve(null),
    adopt: () => undefined
  }
}

const noop = (): void => undefined

const STEPS: AssistProgressView['steps'] = [
  {
    key: 'r:s1',
    kind: 'read',
    label: 'Reading textbolt.com',
    state: 'done',
    detail: 'Read directly · 812 words',
    startedAt: 1_000,
    endedAt: 2_000
  },
  {
    key: 'r:s2',
    kind: 'claude',
    label: 'Asking CiteFox AI to find brand names and competitors',
    state: 'running',
    detail: 'Using 3 of 4 pages · no searches',
    startedAt: 2_000,
    endedAt: null
  }
]

describe('FillSuggestions', () => {
  it('says a schema mismatch in plain words, with "Try again" once', () => {
    const view = render(
      <FillSuggestions
        state={state('The reply did not match the schema.', 'Try again.')}
        onAddBrand={noop}
        onAddCompetitor={noop}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
        onUseMarket={noop}
      />
    )
    const text = view.container.textContent ?? ''
    expect(text).toContain('The AI’s reply was not in the shape CiteFox needs.')
    expect(text).not.toContain('schema')
    expect(text.match(/Try again/g)).toHaveLength(1)
  })

  it('opens with what the business does and says it searches the web (batch 2 row 5)', () => {
    const base = state('Suggestions are ready. Nothing was saved.', null)
    const withSummary: FillState = {
      ...base,
      result: base.result && {
        ...base.result,
        summary: 'TextBolt turns emails into texts for US businesses.'
      }
    }
    const view = render(
      <FillSuggestions
        state={withSummary}
        onAddBrand={noop}
        onAddCompetitor={noop}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
        onUseMarket={noop}
      />
    )
    const summary = view.container.querySelector('.fill-summary')
    expect(summary?.textContent).toBe(
      'What textbolt.com doesTextBolt turns emails into texts for US businesses.'
    )
    expect(view.container.textContent).toContain('searches the web for competitors')
  })

  it('keeps an engine message and its next step as they are', () => {
    const view = render(
      <FillSuggestions
        state={state('Found 2 brands.', 'Pick the ones to add.')}
        onAddBrand={noop}
        onAddCompetitor={noop}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
        onUseMarket={noop}
      />
    )
    expect(view.container.textContent).toContain('Found 2 brands.Pick the ones to add.')
  })

  it('shows each step live while the site is read', () => {
    const running: FillState = {
      ...state('', null),
      result: null,
      filling: true,
      live: { steps: STEPS, running: true, startedAt: 1_000, endedAt: null, claude: null }
    }
    const view = render(
      <FillSuggestions
        state={running}
        onAddBrand={noop}
        onAddCompetitor={noop}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
        onUseMarket={noop}
      />
    )
    const panel = view.getByRole('region', { name: 'What CiteFox AI is doing' })
    expect(panel.textContent).toContain('Reading your website')
    expect(panel.textContent).toContain('Reading textbolt.com')
    expect(panel.textContent).toContain('Asking CiteFox AI to find brand names and competitors')
    expect(view.getByRole('status').textContent).toBe(
      'Asking CiteFox AI to find brand names and competitors…'
    )
  })

  it('folds the steps above the suggestions when the read is done', () => {
    const done: FillState = state('Suggestions are ready. Nothing was saved.', null, {
      steps: STEPS.map((step) => ({ ...step, state: 'done', endedAt: step.endedAt ?? 14_000 })),
      running: false,
      startedAt: 1_000,
      endedAt: 14_000,
      claude: null
    })
    const view = render(
      <FillSuggestions
        state={done}
        onAddBrand={noop}
        onAddCompetitor={noop}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
        onUseMarket={noop}
      />
    )
    const toggle = view.getByRole('button', { name: /2 steps · 13 s · CiteFox AI 12 s/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.textContent).toContain('Read directly · 812 words')
  })
})

describe('FillSuggestions tabs (owner feedback: "same and flat")', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  function full(): FillState {
    const base = state('Suggestions are ready. Nothing was saved.', null)
    return {
      ...base,
      result: base.result && {
        ...base.result,
        products: [
          {
            id: 'p1',
            name: 'Email-to-SMS gateway',
            job: 'Send monitoring alerts to on-call phones as texts.',
            buyer: 'IT and ops teams.',
            evidence: { path: '/grafana', quote: 'Grafana alerts' },
            searchNote: null
          },
          {
            id: 'p2',
            name: 'Alarm texts',
            job: 'Keep alarm texts working.',
            buyer: 'IT and ops teams',
            evidence: null,
            searchNote: null
          }
        ],
        brands: [{ id: 'b1', name: 'TextBolt', reason: 'The logo says so.' }],
        competitors: [
          {
            id: 'c1',
            name: 'Twilio',
            domain: 'twilio.com',
            domainSource: 'search',
            reason: 'SMS API.',
            evidence: null,
            checkDomain: false,
            product: 'p1',
            tier: 'partial',
            startingPrice: '$0.0083/text',
            sources: []
          }
        ],
        switchingFrom: [
          {
            id: 's1',
            name: 'AT&T gateway',
            domain: null,
            domainSource: null,
            reason: 'Shutting down.',
            evidence: { path: '/att', quote: 'AT&T' },
            checkDomain: false
          }
        ],
        suggestedMarket: { country: 'US', language: 'en', location: null, reason: 'US prices.' }
      }
    }
  }

  function renderFull(): ReturnType<typeof render> {
    return render(
      <FillSuggestions
        state={full()}
        onAddBrand={noop}
        onAddCompetitor={noop}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
        onUseMarket={noop}
      />
    )
  }

  it('splits the suggestions into five tabs with counts, Competitors first', () => {
    const view = renderFull()
    const tabs = view.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Competitors1',
      'Buyers1',
      'Switching from1',
      'Integrations0',
      'Brand & market2'
    ])
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(view.getByRole('heading', { name: 'Partial overlap' })).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Add brand' })).toBeNull()
  })

  it('keeps the open tab in the URL, so a link or Back reopens it', () => {
    window.location.hash = '#/onboarding?fill=brand'
    const view = renderFull()
    expect(view.getByRole('tab', { name: /Brand & market/ }).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(view.getByRole('button', { name: 'Add brand' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Use this market' })).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: /Buyers/ }))
    expect(window.location.hash).toBe('#/onboarding?fill=buyers')
    expect(view.getByRole('tab', { name: /Buyers/ }).getAttribute('href')).toBe(
      '#/onboarding?fill=buyers'
    )
    fireEvent.click(view.getByRole('tab', { name: /Competitors/ }))
    expect(window.location.hash).toBe('#/onboarding')
  })

  it('lists buyer types (who buys), once each, apart from competitors', () => {
    window.location.hash = '#/onboarding?fill=buyers'
    const view = renderFull()
    const list = view.getByRole('list', { name: 'Buyer types' })
    const items = list.querySelectorAll('li')
    expect(items).toHaveLength(1)
    expect(items[0]?.textContent).toContain('IT and ops teams')
    expect(items[0]?.textContent).toContain('Send monitoring alerts to on-call phones as texts.')
    expect(view.getByRole('link', { name: 'Open textbolt.com/grafana in a new tab' })).toBeTruthy()
    expect(view.queryByRole('heading', { name: 'Partial overlap' })).toBeNull()
  })

  it('says so when a tab has nothing', () => {
    window.location.hash = '#/onboarding?fill=integrations'
    const view = renderFull()
    expect(view.getByText('No integrations were found on the pages read.')).toBeTruthy()
  })
})
