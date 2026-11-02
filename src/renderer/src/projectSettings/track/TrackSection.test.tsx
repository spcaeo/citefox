// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CLORO_CREDITS,
  ENGINE_IDS,
  ENGINE_LABEL,
  type ApiKeyMetadata,
  type EngineId
} from '@shared/domain'
import type {
  EngineEstimate,
  EngineEstimateRequest,
  ProjectEnginesView,
  SetProjectEnginesRequest
} from '@shared/ipc'
import { axeViolations } from '../../ui/axe.test-helper'
import { CLORO_SIGNUP_URL } from '../../keys/providerLinks'
import { costText } from '../../engines/model'
import { costLines, serpPerQuestion } from './model'
import type { EnginesSettingsSource } from './source'
import { TrackSection } from './TrackSection'

afterEach(cleanup)

function engines(cloroReady: boolean, picked: readonly EngineId[]): ProjectEnginesView {
  return {
    projectId: 'proj-1',
    engines: picked,
    provider: 'auto',
    activeProvider: cloroReady ? 'cloro' : 'serpapi',
    cloroReady,
    serpapiReady: true,
    options: ENGINE_IDS.map((id) => ({
      id,
      label: ENGINE_LABEL[id],
      credits: CLORO_CREDITS[id],
      needsCloro: id !== 'google_aio',
      runnable: cloroReady || id === 'google_aio'
    })),
    overrides: 1,
    updatedAt: null
  }
}

/** 10 questions in one market, weekly: a check is 10 calls per engine. */
function estimateFor(request: EngineEstimateRequest, cloroReady: boolean): EngineEstimate {
  const picked = (request.engines ?? ['google_aio']).filter(
    (engine) => cloroReady || engine === 'google_aio'
  )
  const provider = request.provider === 'serpapi' || !cloroReady ? 'serpapi' : 'cloro'
  const rows = picked.map((engine) => {
    const onCloro = engine !== 'google_aio' || provider === 'cloro'
    const credits = onCloro ? 10 * CLORO_CREDITS[engine] : 0
    return {
      engine,
      label: ENGINE_LABEL[engine],
      calls: 10,
      searches: 10,
      credits,
      costMicros: onCloro ? credits * 800 : 150_000,
      runnable: true
    }
  })
  const sum = (key: 'searches' | 'credits' | 'costMicros'): number =>
    rows.reduce((total, row) => total + row[key], 0)
  const perCheck = {
    searches: sum('searches'),
    credits: sum('credits'),
    costMicros: sum('costMicros')
  }
  return {
    projectId: 'proj-1',
    provider,
    cloroReady,
    pages: 1,
    questions: 10,
    perCheck,
    perMonth: {
      searches: Math.round(perCheck.searches * 4.29),
      credits: Math.round(perCheck.credits * 4.29),
      costMicros: Math.round(perCheck.costMicros * 4.29)
    },
    byEngine: rows,
    plans: [],
    skipped: (request.engines ?? []).filter((engine) => !cloroReady && engine !== 'google_aio')
  }
}

function fakeSource(
  cloroReady: boolean,
  picked: readonly EngineId[] = ['google_aio']
): {
  source: EnginesSettingsSource
  set: ReturnType<typeof vi.fn>
  estimate: ReturnType<typeof vi.fn>
} {
  let saved = engines(cloroReady, picked)
  const set = vi.fn(async (request: SetProjectEnginesRequest) => {
    saved = {
      ...saved,
      engines: request.engines ?? saved.engines,
      provider: request.provider ?? saved.provider
    }
    return saved
  })
  const estimate = vi.fn(async (request: EngineEstimateRequest) => estimateFor(request, cloroReady))
  const source: EnginesSettingsSource = {
    'engines:get': async () => saved,
    'engines:set': set,
    'engines:estimate': estimate,
    'engines:summary': async () => ({ projectId: 'proj-1', engines: saved.engines, counts: [] })
  }
  return { source, set, estimate }
}

const CLORO_KEY: ApiKeyMetadata = {
  id: 'cl-1',
  provider: 'cloro',
  name: 'cloro',
  keychainRef: 'ref-cl-1',
  hint: 'ab12',
  rotationOrder: 0,
  cap: null,
  on: true,
  projectIds: [],
  state: 'ok',
  lastReason: null,
  serpapiUsage: null,
  cloroCredits: { remaining: 1_230, perCycle: 37_500, resetsAt: null }
}

function engineBox(name: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name: new RegExp(`^${name}`) }) as HTMLInputElement
}

describe('Project settings › What to track', () => {
  test('with a multi-engine search key: picks engines, shows the price before saving, and saves', async () => {
    const { source, set, estimate } = fakeSource(true)
    const view = render(<TrackSection projectId="proj-1" keys={[CLORO_KEY]} source={source} />)
    const region = await screen.findByRole('region', { name: 'What to track' })
    expect(within(region).getByText('Key saved in Keychain · 1,230 credits left')).toBeTruthy()
    expect(within(region).getByRole('radio', { name: /^cloro/ })).toHaveProperty('checked', true)
    expect(engineBox('ChatGPT').disabled).toBe(false)

    const cost = within(region).getByTestId('engines-cost')
    await waitFor(() => expect(cost.textContent).toContain('About 300 credits a month'))

    fireEvent.click(engineBox('ChatGPT'))
    fireEvent.click(engineBox('Perplexity'))
    await waitFor(() =>
      expect(estimate).toHaveBeenLastCalledWith({
        projectId: 'proj-1',
        engines: ['google_aio', 'chatgpt', 'perplexity'],
        provider: 'cloro'
      })
    )
    // 10 questions × (7 + 7 + 6) credits = 200 a check, 858 a month, before Save.
    await waitFor(() => expect(cost.textContent).toContain('About 858 credits a month'))
    expect(cost.textContent).toContain('One check: 200 credits')
    expect(cost.textContent).toContain('10 questions × 3 engines')
    expect(await axeViolations(view.container)).toEqual([])

    fireEvent.click(within(region).getByRole('button', { name: 'Save' }))
    await within(region).findByText('What to track is saved.')
    expect(set).toHaveBeenCalledWith({
      projectId: 'proj-1',
      engines: ['google_aio', 'chatgpt', 'perplexity']
    })
    expect(within(region).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
  })

  test('without a multi-engine search key: the cloro engines are off, with a way to Connections', async () => {
    const { source } = fakeSource(false)
    render(<TrackSection projectId="proj-1" keys={[]} source={source} />)
    const region = await screen.findByRole('region', { name: 'What to track' })
    for (const name of ['ChatGPT', 'Perplexity', 'Google AI Mode', 'Gemini', 'Copilot']) {
      expect(engineBox(name).disabled).toBe(true)
    }
    expect(engineBox('Google AI Overview').disabled).toBe(false)
    expect(within(region).getAllByText('Needs a key')).toHaveLength(5)
    const links = within(region).getAllByRole('link', { name: /Add (one|it) in Connections/ })
    expect(links[0]?.getAttribute('href')).toBe('#/connections?tab=cloro')
    expect(
      within(region)
        .getAllByRole('link', { name: /cloro/i })
        .some((link) => link.getAttribute('href') === CLORO_SIGNUP_URL)
    ).toBe(true)
    // SerpApi says plainly it covers Google AI Overviews only.
    expect(within(region).getByText('Google AI Overviews only.')).toBeTruthy()
    expect(within(region).getByRole('radio', { name: /^cloro/ })).toHaveProperty('disabled', true)
    const cost = within(region).getByTestId('engines-cost')
    await waitFor(() => expect(cost.textContent).toContain('About 43 searches a month'))
  })

  test('Cancel puts the saved choice back; no engine at all cannot be saved', async () => {
    const { source, set } = fakeSource(true, ['google_aio', 'chatgpt'])
    render(<TrackSection projectId="proj-1" keys={[CLORO_KEY]} source={source} />)
    const region = await screen.findByRole('region', { name: 'What to track' })
    fireEvent.click(engineBox('Gemini'))
    expect(engineBox('Gemini').checked).toBe(true)
    fireEvent.click(within(region).getByRole('button', { name: 'Cancel' }))
    expect(engineBox('Gemini').checked).toBe(false)

    fireEvent.click(engineBox('Google AI Overview'))
    fireEvent.click(engineBox('ChatGPT'))
    expect(within(region).getByTestId('engines-cost').textContent).toContain(
      'Pick at least one engine.'
    )
    fireEvent.click(within(region).getByRole('button', { name: 'Save' }))
    await within(region).findByRole('alert')
    expect(set).not.toHaveBeenCalled()
  })

  test('picking SerpApi saves it as the provider', async () => {
    const { source, set } = fakeSource(true)
    render(<TrackSection projectId="proj-1" keys={[CLORO_KEY]} source={source} />)
    const region = await screen.findByRole('region', { name: 'What to track' })
    fireEvent.click(within(region).getByRole('radio', { name: /^SerpApi/ }))
    expect(within(region).getByText('1–2 searches')).toBeTruthy()
    fireEvent.click(within(region).getByRole('button', { name: 'Save' }))
    await within(region).findByText('What to track is saved.')
    expect(set).toHaveBeenCalledWith({
      projectId: 'proj-1',
      engines: ['google_aio'],
      provider: 'serpapi'
    })
  })
})

describe('What to track model', () => {
  test('prices read plainly', () => {
    expect(costText(0)).toBe('$0')
    expect(costText(1_900_000)).toBe('$1.90')
    expect(costText(4_000)).toBe('$0.004')
    expect(serpPerQuestion(null)).toBe('$0.03')
    const none = costLines({ ...estimateFor({ projectId: 'p' }, true), pages: 0, questions: 0 }, 1)
    expect(none.month).toBe('Nothing to check yet.')
  })
})
