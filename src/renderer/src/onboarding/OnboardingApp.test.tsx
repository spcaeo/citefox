// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CompanySuggestion,
  FillFound,
  FillFromWebsiteProgress,
  FillFromWebsiteResult,
  FinishSetupRequest,
  OnboardingDraft,
  OnboardingState,
  ProductCompetitorsRequest,
  ProductCompetitorsResult,
  ProductSearchState,
  ProductSuggestion,
  SaveProfileRequest,
  SetupDraft,
  SetupRow,
  SetupSectionRunRequest
} from '@shared/ipc'
import { createMockOnboardingClient, type MockOnboardingClient } from './mockClient'
import { createMockSetupServices, type MockSetupServices } from './mockSetupServices'
import { OnboardingApp } from './OnboardingApp'
import type { SetupSectionClient } from './sectionClient'
import { itemOf } from './setupApply'
import { emptySetupDraft } from './setupDraft'
import { toOnboardingDraft } from './draft'
import type { SetupView } from './setupSteps'

const FRESH: OnboardingState = {
  finished: false,
  currentStep: 'profile',
  profile: null,
  steps: []
}

const FILL: FillFromWebsiteResult = {
  domain: 'textbolt.com',
  pagesRead: [{ url: 'https://textbolt.com/', role: 'home', ok: true }],
  summary: 'Turns an email into a text message.',
  products: [
    {
      id: 'p1',
      name: 'Email-to-SMS gateway',
      job: 'Turns emails into texts',
      buyer: '',
      evidence: { path: '/email-to-text/', quote: 'Email to text' },
      searchNote: null
    }
  ],
  brands: [{ id: 'b1', name: 'TextBolt', reason: 'Page title.' }],
  competitors: [
    {
      id: 'c1',
      name: 'Textmagic',
      domain: 'textmagic.com',
      domainSource: 'search',
      reason: 'Same job.',
      evidence: null,
      checkDomain: false,
      product: 'p1',
      tier: 'direct'
    }
  ],
  switchingFrom: [],
  integrations: [],
  suggestedMarket: null,
  message: 'Read textbolt.com.',
  nextStep: null
}

const PROFILE: SaveProfileRequest = {
  userName: 'Ada',
  projectName: 'TextBolt',
  domain: 'textbolt.com',
  includeSubdomains: true,
  brandNames: ['TextBolt'],
  competitors: [],
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop'
}

interface FakeSections extends SetupSectionClient {
  runs: SetupSectionRunRequest[]
  finishes: FinishSetupRequest[]
}

function fakeSections(client: MockOnboardingClient): FakeSections {
  const runs: SetupSectionRunRequest[] = []
  const finishes: FinishSetupRequest[] = []
  return {
    runs,
    finishes,
    sectionEstimate: async ({ section }) => ({
      kind: section,
      available: true,
      calls: 1,
      costText: '1 Claude call · on your Claude plan',
      reason: null
    }),
    sectionPrompt: async ({ section }) => ({
      section,
      prompt: 'p',
      columns: ['name'],
      webSearch: false
    }),
    sectionRun: async (request) => {
      runs.push(request)
      const rows =
        request.section === 'buyers'
          ? [{ name: 'IT sysadmin', detail: 'On-call texts stopped.', url: null, tag: null }]
          : [{ name: 'AT&T gateway shut down', detail: '', url: null, tag: null }]
      return { section: request.section, rows, text: null, warnings: [] }
    },
    sectionRead: async ({ section }) => ({ section, rows: [], text: null, warnings: [] }),
    finishSetup: async (request) => {
      finishes.push(request)
      const state = { ...(await client.getState()), finished: true, currentStep: null }
      return {
        state,
        projectId: 'project-1',
        topicId: 'topic-1',
        checkStarted: true,
        message: null
      }
    }
  }
}

function newClient(): MockOnboardingClient {
  return createMockOnboardingClient({ wait: () => Promise.resolve(), paceMs: 0 })
}

function v2(view: SetupView, setup: SetupDraft): OnboardingDraft {
  return toOnboardingDraft(view, setup)
}

/** A setup filled through step 6 (site, read, brand, buyers, a competitor). */
function filled(): SetupDraft {
  const empty = emptySetupDraft()
  const row = (name: string, url: string | null = null): SetupRow => ({
    name,
    detail: '',
    url,
    tag: null
  })
  return {
    ...empty,
    site: { ...empty.site, domain: 'textbolt.com', userName: 'Ada', country: 'US', language: 'en' },
    readWay: 'claude',
    readDone: true,
    summary: 'Turns an email into a text.',
    topic: 'Replacing a carrier email-to-text gateway',
    lists: {
      ...empty.lists,
      brands: [itemOf(row('TextBolt'), 'ai')],
      buyers: [itemOf(row('IT sysadmin'), 'ai')],
      competitors: [
        itemOf(row('Textmagic', 'textmagic.com'), 'ai'),
        { ...itemOf(row('Left out', 'leftout.com'), 'ai'), kept: false }
      ],
      questions: [itemOf(row('What changed?'), 'ai'), itemOf(row('What does it cost?'), 'ai')]
    }
  }
}

function renderApp(options: {
  client?: MockOnboardingClient
  state?: OnboardingState
  draft?: OnboardingDraft | null
  sections?: SetupSectionClient
  services?: MockSetupServices
  onFinished?: () => void
}): { view: RenderResult; client: MockOnboardingClient; services: MockSetupServices } {
  const client = options.client ?? newClient()
  const services = options.services ?? createMockSetupServices()
  const view = render(
    <OnboardingApp
      client={client}
      initialState={options.state ?? FRESH}
      initialDraft={options.draft ?? null}
      onFinished={options.onFinished ?? (() => undefined)}
      sections={options.sections ?? fakeSections(client)}
      services={services}
      openLink={() => undefined}
    />
  )
  return { view, client, services }
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '#/')
})

async function heading(view: RenderResult, name: string | RegExp): Promise<void> {
  await view.findByRole('heading', { level: 1, name })
}

describe('onboarding v2: step 1 and the step URLs', () => {
  it('starts on the welcome screen, then step 1 at #/setup/site with Continue off until valid', async () => {
    const { view } = renderApp({})
    await heading(view, /See whether Google AI Overviews, ChatGPT, Perplexity/)
    await waitFor(() => expect(window.location.hash).toBe('#/welcome'))
    fireEvent.click(view.getByRole('button', { name: 'Get started' }))
    await heading(view, 'Which website should AI answers cite?')
    expect(window.location.hash).toBe('#/setup/site')
    const go = view.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    // The United States and English are picked already.
    expect((view.getByLabelText(/Where are your buyers/) as HTMLSelectElement).value).toBe('US')
    expect((view.getByLabelText(/Language/) as HTMLSelectElement).value).toBe('en')
    fireEvent.change(view.getByLabelText(/Your website/), { target: { value: 'textbolt.com' } })
    expect(go.disabled).toBe(false)
    fireEvent.click(go)
    await heading(view, 'Let your AI do the reading and writing')
    expect(window.location.hash).toBe('#/setup/claude')
  })

  it('a step whose earlier steps are not done sends the user to the first one that is not', async () => {
    window.history.replaceState(null, '', '#/setup/buyers')
    const { view } = renderApp({})
    await heading(view, 'Which website should AI answers cite?')
    expect(window.location.hash).toBe('#/setup/site')
  })

  it('reopens on the saved v2 step, and Back goes to the step before', async () => {
    const { view } = renderApp({ draft: v2('buyers', filled()) })
    await heading(view, 'Who buys from you, and what makes them look?')
    await waitFor(() => expect(window.location.hash).toBe('#/setup/buyers'))
    fireEvent.click(view.getByRole('button', { name: 'Back' }))
    await heading(view, /^Is this right about /)
    expect(window.location.hash).toBe('#/setup/brand')
  })

  it('maps an old v1 draft into step 1', async () => {
    const old: OnboardingDraft = {
      view: 'serpapi',
      profile: {
        userName: 'Ada',
        projectName: 'Example',
        domain: 'example.com',
        brands: ['Example Co'],
        brandDraft: '',
        competitors: [],
        competitorDraft: '',
        switchingFrom: [],
        integrations: [],
        country: 'US',
        countryCode: '',
        language: 'en',
        languageCode: '',
        location: ''
      },
      fill: null,
      budget: ''
    }
    const { view } = renderApp({ draft: old })
    await heading(view, 'Which website should AI answers cite?')
    expect((view.getByLabelText(/Your website/) as HTMLInputElement).value).toBe('example.com')
    expect((view.getByLabelText(/Your name/) as HTMLInputElement).value).toBe('Ada')
  })

  it('autosaves the setup and the step, never a secret', async () => {
    const { view, client } = renderApp({})
    const save = vi.spyOn(client, 'saveDraft')
    fireEvent.click(await view.findByRole('button', { name: 'Get started' }))
    fireEvent.change(await view.findByLabelText(/Your website/), {
      target: { value: 'textbolt.com' }
    })
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 3000 })
    const saved = await client.getDraft()
    expect(saved?.setupView).toBe('site')
    expect(saved?.setup?.site.domain).toBe('textbolt.com')
    expect(saved?.profile.domain).toBe('')
    expect(JSON.stringify(saved)).not.toMatch(/secret|apiKey/i)
  })
})

describe('step 2 and step 3', () => {
  function atSite(): SetupDraft {
    const draft = emptySetupDraft()
    return {
      ...draft,
      site: { ...draft.site, domain: 'textbolt.com', country: 'US', language: 'en' }
    }
  }

  it('"Skip and use your own ChatGPT" opens step 3 on the ChatGPT way; its answer fills the lists', async () => {
    const { view } = renderApp({ draft: v2('claude', atSite()) })
    await heading(view, 'Let your AI do the reading and writing')
    fireEvent.click(view.getByRole('button', { name: 'Skip and use your own ChatGPT instead' }))
    await heading(view, 'How should CiteFox learn about textbolt.com?')
    expect(
      (view.getByRole('radio', { name: /Use my own ChatGPT/ }) as HTMLInputElement).checked
    ).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'Get the prompt' }))
    await heading(view, 'Ask your own ChatGPT about textbolt.com')
    await view.findByText(/AI-search tracking for textbolt\.com/)
    fireEvent.change(view.getByLabelText('Paste its answer below'), { target: { value: 'x' } })
    fireEvent.click(view.getByRole('button', { name: 'Read the answer' }))
    await heading(view, /^Is this right about /)
    expect(window.location.hash).toBe('#/setup/brand')
    expect(view.getByRole('checkbox', { name: 'Keep Email-to-SMS gateway' })).toBeTruthy()
  })

  it('"Read my website" runs the read, then buyers and triggers, applies them ticked and moves on', async () => {
    const client = newClient()
    const listeners: ((event: FillFromWebsiteProgress) => void)[] = []
    let release: (value: FillFromWebsiteResult) => void = () => undefined
    client.onFillProgress = (listener) => {
      listeners.push(listener)
      return () => undefined
    }
    const fill = vi.fn(
      () =>
        new Promise<FillFromWebsiteResult>((resolve) => {
          release = resolve
        })
    )
    client.fillFromWebsite = fill
    const sections = fakeSections(client)
    const { view } = renderApp({ client, sections, draft: v2('read', atSite()) })
    await heading(view, 'How should CiteFox learn about textbolt.com?')
    const start = await view.findByRole('button', { name: 'Read my website' })
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(start)
    await heading(view, 'Reading textbolt.com…')
    expect(view.getByRole('note').textContent).toMatch(/This runs on its own/)
    expect((view.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect(fill).toHaveBeenCalledWith({
      projectId: null,
      domain: 'textbolt.com',
      market: { country: 'US', language: 'en' }
    })
    act(() => {
      for (const listener of listeners) {
        listener({
          domain: 'textbolt.com',
          phase: 'fetch',
          state: 'running',
          url: 'https://textbolt.com/',
          detail: '',
          nextStep: null
        })
        listener({
          domain: 'textbolt.com',
          phase: 'fetch',
          state: 'ok',
          url: 'https://textbolt.com/',
          detail: '',
          nextStep: null
        })
        listener({
          domain: 'textbolt.com',
          phase: 'suggest',
          state: 'running',
          url: null,
          detail: '',
          nextStep: null
        })
      }
    })
    await view.findByText('Read 1 of your pages')
    await act(async () => release(FILL))
    await heading(view, /^Is this right about /)
    expect(sections.runs.map((run) => [run.section, run.mode, run.instruction])).toEqual([
      ['buyers', 'redo', null],
      ['triggers', 'redo', null],
      // Step 8's examples start as soon as the read is done.
      ['examples', 'redo', null]
    ])
    // The triggers run already knows the buyers and the site read.
    expect(sections.runs[1]?.context.buyers.map((row) => row.name)).toEqual(['IT sysadmin'])
    expect(sections.runs[1]?.context.products.map((row) => row.name)).toEqual([
      'Email-to-SMS gateway'
    ])
    expect(view.getByRole('heading', { level: 1 }).textContent).toBe(
      'Is this right about TextBolt?'
    )
    expect(view.getByRole('list', { name: 'Brand names and spellings' }).textContent).toContain(
      'TextBolt'
    )
    expect(
      (view.getByRole('checkbox', { name: 'Keep Email-to-SMS gateway' }) as HTMLInputElement)
        .checked
    ).toBe(true)
    expect(view.getByTestId('section-summary').textContent).toContain(
      'Turns an email into a text message.'
    )
  })

  it('lists what the read finds as it arrives; a failed search has Try again; Continue goes on with what was found', async () => {
    const client = newClient()
    const listeners: ((event: FillFromWebsiteProgress) => void)[] = []
    client.onFillProgress = (listener) => {
      listeners.push(listener)
      return () => undefined
    }
    client.fillFromWebsite = vi.fn(() => new Promise<FillFromWebsiteResult>(() => undefined))
    let retried: (result: ProductCompetitorsResult) => void = () => undefined
    const retry = vi.fn<(request: ProductCompetitorsRequest) => Promise<ProductCompetitorsResult>>(
      () =>
        new Promise((resolve) => {
          retried = resolve
        })
    )
    client.searchProductCompetitors = retry
    const sections = fakeSections(client)
    const { view } = renderApp({ client, sections, draft: v2('read', atSite()) })
    const start = await view.findByRole('button', { name: 'Read my website' })
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(start)
    await heading(view, 'Reading textbolt.com…')
    const push = (found: FillFound): void =>
      act(() => {
        for (const listener of listeners) {
          listener({
            domain: 'textbolt.com',
            phase: 'suggest',
            state: 'running',
            url: null,
            detail: '',
            nextStep: null,
            found
          })
        }
      })
    const product = (id: string, name: string): ProductSuggestion => ({
      id,
      name,
      job: `${name}.`,
      buyer: 'Small US businesses',
      evidence: null,
      searchNote: null
    })
    const rival = (name: string, productId: string): CompanySuggestion => ({
      ...(FILL.competitors[0] as CompanySuggestion),
      id: `c-${name}`,
      name,
      domain: null,
      product: productId
    })
    const search = (
      productId: string,
      state: ProductSearchState,
      competitors: CompanySuggestion[] = [],
      note: string | null = null
    ): FillFound => ({ kind: 'search', productId, state, competitors, note })

    // 1. What the site sells, before any search is done; buyers start at once.
    push({
      kind: 'site',
      summary: 'Turns an email into a text message.',
      brands: [{ id: 'b1', name: 'TextBolt', reason: 'Page title.' }],
      products: [
        product('p1', 'Email-to-SMS service'),
        product('p2', 'Carrier gateway replacement'),
        product('p3', 'On-call text alerts')
      ],
      comparedWith: ['SimpleTexting', 'Textedly'],
      switchingFrom: [],
      integrations: [],
      suggestedMarket: null,
      market: { country: 'US', language: 'en' }
    })
    await view.findByText('What you sell · 3 products')
    expect(view.getByRole('list', { name: 'What you sell' }).textContent).toContain(
      'Carrier gateway replacement'
    )
    await view.findByText('Who buys from you · 1 found')
    expect(sections.runs.map((run) => run.section)).toEqual(['buyers', 'triggers'])
    const lines = (): string =>
      view.getByRole('list', { name: 'Competitor searches, one per product' }).textContent ?? ''
    expect(lines()).toContain('Waiting its turn')
    expect(view.getByText(/Your site compares itself with: SimpleTexting, Textedly/)).toBeTruthy()

    // 2. Searches start, one finishes, one does not.
    push(search('p1', 'running'))
    push(search('p2', 'running'))
    expect(lines()).toMatch(/Email-to-SMS service.*Searching the web/)
    push(search('p1', 'done', [rival('Textmagic', 'p1'), rival('SimpleTexting', 'p1')]))
    push(search('p2', 'failed', [], 'It took too long and was stopped.'))
    expect(lines()).toContain('2 found')
    expect(lines()).toContain('Didn’t finish. It took too long and was stopped.')
    expect(view.getByText('Competitors so far (2)')).toBeTruthy()
    expect(view.getByRole('list', { name: 'Competitors found so far' }).textContent).toBe(
      'TextmagicSimpleTexting'
    )
    expect(view.getByText(/Your site also compares itself with: Textedly/)).toBeTruthy()

    // 3. Only the third search is left: Continue works, and the step says what it waits for.
    await view.findByText('Still searching the web for competitors.')
    const go = view.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(go.disabled).toBe(false)

    // 4. Try again for the failed product only.
    fireEvent.click(view.getByRole('button', { name: 'Try again: Carrier gateway replacement' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(retry.mock.calls[0]?.[0]).toMatchObject({
      domain: 'textbolt.com',
      product: { id: 'p2', name: 'Carrier gateway replacement' },
      comparedWith: ['SimpleTexting', 'Textedly'],
      brandNames: ['TextBolt']
    })
    expect(lines()).toMatch(/Carrier gateway replacement.*Trying again/)
    await view.findByText('Waiting for the search you asked to try again.')
    await act(async () =>
      retried({ productId: 'p2', ok: true, competitors: [rival('ClickSend', 'p2')], note: null })
    )
    expect(lines()).toMatch(/Carrier gateway replacement1 found/)
    expect(view.getByText('Competitors so far (3)')).toBeTruthy()

    // 5. Go on with what was found; the third search keeps running and fills in later.
    fireEvent.click(view.getByRole('button', { name: 'Continue' }))
    await heading(view, /^Is this right about /)
    fireEvent.click(view.getByRole('button', { name: 'Back' }))
    await heading(view, 'How should CiteFox learn about textbolt.com?')
    expect(window.location.hash).toBe('#/setup/read')
    const searches = view.getByRole('region', { name: 'Competitor searches' })
    expect(searches.textContent).toMatch(/On-call text alerts.*Waiting its turn/)
    const filledIn = (): string => view.getByText(/^Already filled in/).textContent ?? ''
    expect(filledIn()).toContain('and 3 competitors')
    push(search('p3', 'done', [rival('Notifyre', 'p3')]))
    await waitFor(() =>
      expect(view.queryByRole('region', { name: 'Competitor searches' })).toBeNull()
    )
    expect(filledIn()).toContain('and 4 competitors')
  })

  it('with no Claude, "Read my website" cannot be picked and the ChatGPT way is chosen', async () => {
    const services = createMockSetupServices({ available: false })
    const { view } = renderApp({ services, draft: v2('read', atSite()) })
    await heading(view, 'How should CiteFox learn about textbolt.com?')
    await waitFor(() =>
      expect(
        (view.getByRole('radio', { name: /Read my website/ }) as HTMLInputElement).disabled
      ).toBe(true)
    )
    expect(view.getByRole('button', { name: 'Get the prompt' })).toBeTruthy()
  })

  it('"I’ll type it myself" leaves the lists empty and goes on', async () => {
    const { view } = renderApp({ draft: v2('read', atSite()) })
    await heading(view, 'How should CiteFox learn about textbolt.com?')
    fireEvent.click(view.getByRole('radio', { name: /I’ll type it myself/ }))
    fireEvent.click(view.getByRole('button', { name: 'Continue with empty steps' }))
    await heading(view, /^Is this right about /)
    expect(window.location.search + window.location.hash).toContain('#/setup/brand')
  })
})

describe('Continue’s work on steps 6, 7 and 8', () => {
  it('leaving step 6 saves the profile from the kept rows and the site', async () => {
    const client = newClient()
    const save = vi.spyOn(client, 'saveProfile')
    const { view } = renderApp({ client, draft: v2('competitors', filled()) })
    await heading(view, 'Who could buyers pick instead of you?')
    fireEvent.click(view.getByRole('button', { name: 'Continue' }))
    await heading(view, 'Which AI answers should CiteFox check?')
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        userName: 'Ada',
        projectName: 'TextBolt',
        domain: 'textbolt.com',
        brandNames: ['TextBolt'],
        competitors: ['textmagic.com'],
        country: 'US',
        language: 'en'
      })
    )
  })

  it('step 7 tests the cloro key, saves the engines and the schedule, with the cost shown live', async () => {
    const client = newClient()
    await client.saveProfile(PROFILE)
    const state = await client.getState()
    const add = vi.spyOn(client, 'addKey')
    const { view, services } = renderApp({ client, state, draft: v2('engines', filled()) })
    await heading(view, 'Which AI answers should CiteFox check?')
    // New setups: Google AI Overview only, every 7 days (owner, 2026-11-01).
    expect((view.getByLabelText(/^Google AI Overview/) as HTMLInputElement).checked).toBe(true)
    expect((view.getByLabelText(/^ChatGPT/) as HTMLInputElement).checked).toBe(false)
    expect((view.getByLabelText(/Checks run/) as HTMLSelectElement).value).toBe('7')
    expect(view.getByText(/2 prompts × 1 answer every 7 days ≈ 56 credits a month/)).toBeTruthy()
    fireEvent.click(view.getByLabelText(/^ChatGPT/))
    fireEvent.click(view.getByLabelText(/^Perplexity/))
    await view.findByText(/2 prompts × 3 answers every 7 days ≈ 160 credits a month/)
    fireEvent.change(view.getByLabelText(/Checks run/), { target: { value: '0' } })
    await view.findByText(/≈ 40 credits each time you press Check now/)
    // Every day shows the month's cost and says it is about 4 times every 7 days.
    fireEvent.change(view.getByLabelText(/Checks run/), { target: { value: '1' } })
    await view.findByText(/2 prompts × 3 answers every day ≈ 1,200 credits a month/)
    expect(view.getByText(/Every day runs about 30 checks a month, about 7 times/)).toBeTruthy()
    fireEvent.change(view.getByLabelText(/Checks run/), { target: { value: '30' } })
    await view.findByText(/every 30 days ≈ 40 credits a month/)
    fireEvent.change(view.getByLabelText('cloro API key'), { target: { value: 'sk_live_sample' } })
    fireEvent.click(view.getByRole('button', { name: 'Continue' }))
    await heading(view, 'How do your buyers ask AI?')
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ provider: 'cloro' }))
    expect(services.calls).toEqual([
      {
        channel: 'engines:set',
        request: {
          projectId: state.profile?.project.id,
          engines: ['google_aio', 'chatgpt', 'perplexity'],
          provider: 'cloro'
        }
      },
      {
        channel: 'schedule:updateProject',
        request: { projectId: state.profile?.project.id, defaultIntervalDays: 30, paused: false }
      }
    ])
    // Step 8: the prompts on the draft were written to this mix, so step 9 opens as it is.
    fireEvent.click(view.getByRole('button', { name: 'Write my prompts' }))
    await heading(view, 'Your first topic and what buyers ask AI')
    expect(view.getByText('First check: 2 prompts × 3 answers · 40 credits')).toBeTruthy()
  })

  it('a rejected key is cleared from the field, says why and keeps Continue off', async () => {
    const client = newClient()
    await client.saveProfile(PROFILE)
    vi.spyOn(client, 'testKey').mockImplementation(async ({ id }) => {
      const key = (await client.getOverview()).keys.find((item) => item.id === id)
      if (!key) throw new Error('no key')
      return {
        key: { ...key, state: 'warning' },
        message: 'cloro rejected this key. Copy it again from your dashboard.',
        reason: 'rejected'
      }
    })
    const { view } = renderApp({
      client,
      state: await client.getState(),
      draft: v2('engines', filled())
    })
    await heading(view, 'Which AI answers should CiteFox check?')
    const field = view.getByLabelText('cloro API key') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'sk_live_wrong' } })
    fireEvent.click(view.getByRole('button', { name: 'Test key' }))
    expect((await view.findByRole('alert')).textContent).toMatch(/cloro rejected this key/)
    expect((view.getByLabelText('cloro API key') as HTMLInputElement).value).toBe('')
    expect((view.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect(view.container.textContent).not.toContain('sk_live_wrong')
  })

  it('SerpApi reaches Google AI Overviews only', async () => {
    const client = newClient()
    await client.saveProfile(PROFILE)
    const { view } = renderApp({
      client,
      state: await client.getState(),
      draft: v2('engines', filled())
    })
    await heading(view, 'Which AI answers should CiteFox check?')
    fireEvent.click(view.getByRole('radio', { name: /SerpApi/ }))
    expect((view.getByLabelText(/^ChatGPT/) as HTMLInputElement).disabled).toBe(true)
    expect(view.getByText(/2 prompts × 1 answer every 7 days ≈ 8 searches a month/)).toBeTruthy()
    expect(view.getByLabelText('SerpApi API key')).toBeTruthy()
  })

  it('step 8 finishes setup with the kept rows and runs the first check', async () => {
    const client = newClient()
    await client.saveProfile(PROFILE)
    const meta = await client.addKey({
      provider: 'cloro',
      name: 'cloro',
      secret: 'sk_live_sample',
      cap: null,
      projectIds: []
    })
    await client.testKey({ id: meta.id })
    const sections = fakeSections(client)
    const onFinished = vi.fn()
    const { view } = renderApp({
      client,
      sections,
      onFinished,
      state: await client.getState(),
      draft: v2('questions', filled())
    })
    await heading(view, 'Your first topic and what buyers ask AI')
    fireEvent.click(view.getByRole('button', { name: 'Finish and run the first check' }))
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1))
    // The app opens on the topic setup made, not on "How do you want to start?".
    expect(onFinished.mock.calls[0]?.[0]).toMatch(/topics\/topic-1/)
    expect(sections.finishes).toHaveLength(1)
    expect(sections.finishes[0]?.runFirstCheck).toBe(true)
    expect(sections.finishes[0]?.competitors.map((row) => row.name)).toEqual(['Textmagic'])
    expect(sections.finishes[0]?.questions).toHaveLength(2)
  })

  it('a failed finish stays on step 8 with a visible message', async () => {
    const client = newClient()
    const sections = fakeSections(client)
    sections.finishSetup = () => Promise.reject(new Error('The database is locked'))
    const state = {
      ...FRESH,
      profile: {} as NonNullable<OnboardingState['profile']>
    }
    const meta = await client.addKey({
      provider: 'cloro',
      name: 'cloro',
      secret: 'sk_live_sample',
      cap: null,
      projectIds: []
    })
    await client.testKey({ id: meta.id })
    const { view } = renderApp({ client, sections, state, draft: v2('questions', filled()) })
    await heading(view, 'Your first topic and what buyers ask AI')
    fireEvent.click(view.getByRole('button', { name: 'Finish and run the first check' }))
    expect((await view.findByRole('alert')).textContent).toMatch(/database is locked/)
  })
})
