// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Market } from '@shared/domain'
import type { HelpFillResult, HelpFillRow, ProjectMarketsView } from '@shared/ipc'
import type { HelpFillSource } from '../ui'
import { AddMarketDrawer } from './AddMarketDrawer'
import { languageOptionsWith, marketPicks } from './marketPicks'
import type { ProjectMarketsSource } from './source'

afterEach(cleanup)

const US: Market = {
  id: 'us-en',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

const VIEW: ProjectMarketsView = {
  projectId: 'textbolt',
  defaultMarketId: US.id,
  markets: [US],
  pages: [
    {
      id: 'alerts',
      kind: 'page',
      name: 'alerts',
      url: 'https://textbolt.com/alerts',
      status: 'tracked',
      questions: 10,
      samples: 1,
      marketIds: [US.id],
      defaultMarketId: US.id
    }
  ],
  searchesLeft: 300
}

function row(id: string, country: string, language: string, city: string): HelpFillRow {
  return { id, section: null, values: { country, language, city } }
}

const ROWS = [
  row('row-1', 'CA', 'fr', 'Montreal'),
  row('row-2', 'BR', 'pt', ''),
  row('row-3', 'MX', '', '')
]

function result(rows: readonly HelpFillRow[]): HelpFillResult {
  return {
    kind: 'markets',
    rows,
    setAside: [],
    counts: { read: rows.length + 1, tracked: 1, repeats: 0, setAside: 0, ready: rows.length },
    noun: ['market', 'markets'],
    brand: 'TextBolt',
    warnings: []
  }
}

function helpSource(): HelpFillSource & { reads: string[] } {
  const reads: string[] = []
  return {
    reads,
    'helpfill:estimate': async ({ kind }) => ({
      kind,
      available: false,
      calls: 1,
      costText: '1 AI call',
      reason: 'Needs CiteFox AI connected.'
    }),
    'helpfill:prompt': async ({ kind }) => ({
      kind,
      prompt: 'You help a company choose…\ncountry,language,city',
      columns: ['country', 'language', 'city'],
      tracked: 1
    }),
    'helpfill:read': async ({ text, scope }) => {
      reads.push(`${scope.pageId ?? 'project'}:${text}`)
      return result(ROWS)
    },
    'helpfill:describe': async () => result([])
  }
}

function marketsSource(): ProjectMarketsSource {
  return {
    'projectSettings:markets': vi.fn(async () => VIEW),
    'projectSettings:addMarket': vi.fn(async (request) => ({
      marketId: 'ca-fr-montreal',
      added: [...request.pageIds],
      alreadyHad: [],
      view: VIEW
    })),
    'projectSettings:removeMarket': vi.fn(),
    'projectSettings:restoreMarket': vi.fn(),
    'pages:update': vi.fn()
  } as unknown as ProjectMarketsSource
}

describe('marketPicks', () => {
  it('labels each row and fills a missing language from the country, else the form', () => {
    expect(marketPicks(ROWS, 'de')).toEqual([
      {
        id: 'row-1',
        country: 'CA',
        language: 'fr',
        city: 'Montreal',
        label: 'CA · French · Montreal'
      },
      { id: 'row-2', country: 'BR', language: 'pt', city: '', label: 'BR · Portuguese' },
      { id: 'row-3', country: 'MX', language: 'es', city: '', label: 'MX · Spanish' }
    ])
    expect(marketPicks([row('r', 'NL', '', '')], 'de')[0]?.language).toBe('de')
    expect(marketPicks([row('r', '', 'en', 'Paris')])).toEqual([])
  })

  it('adds an unusual language to the language list once', () => {
    const values = languageOptionsWith('tlh').map((option) => option.value)
    expect(values.at(-1)).toBe('tlh')
    expect(values.filter((value) => value === 'tlh')).toHaveLength(1)
    expect(languageOptionsWith('en').map((option) => option.value)).not.toContain('tlh')
    // Portuguese is listed now, so it is not added again.
    expect(languageOptionsWith('pt').filter((option) => option.value === 'pt')).toHaveLength(1)
  })
})

describe('Add market drawer · Help me fill this', () => {
  it('reads a pasted answer: the first pick fills the form, Use fills another, nothing is added', async () => {
    const markets = marketsSource()
    const help = helpSource()
    render(
      <AddMarketDrawer
        source={markets}
        projectId="textbolt"
        pageId="alerts"
        helpSource={help}
        onClose={() => undefined}
      />
    )
    const section = await screen.findByTestId('add-market-help')
    // No Claude key: the helper opens on the chatbot way.
    await within(section).findByTestId('hf-chatbot')
    fireEvent.change(within(section).getByLabelText('Paste its answer below'), {
      target: { value: 'country,language,city\nCanada,French,Montreal' }
    })
    await act(async () => {
      fireEvent.click(within(section).getByTestId('hf-read'))
    })
    expect(help.reads).toEqual(['alerts:country,language,city\nCanada,French,Montreal'])
    const country = screen.getByLabelText('Country') as HTMLSelectElement
    const language = screen.getByLabelText('Language') as HTMLSelectElement
    const city = screen.getByLabelText('City') as HTMLInputElement
    await waitFor(() => expect(country.value).toBe('CA'))
    expect(language.value).toBe('fr')
    expect(city.value).toBe('Montreal')
    expect(within(section).getByTestId('mh-in-form').closest('li')?.textContent).toContain(
      'CA · French · Montreal'
    )
    fireEvent.click(within(section).getByRole('button', { name: 'Use BR · Portuguese' }))
    expect(country.value).toBe('BR')
    expect(language.value).toBe('pt')
    expect(city.value).toBe('')
    // A hand edit takes the "In the form" mark away.
    fireEvent.change(city, { target: { value: 'São Paulo' } })
    expect(within(section).queryByTestId('mh-in-form')).toBeNull()
    expect(markets['projectSettings:addMarket']).not.toHaveBeenCalled()
    // The drawer's own button is still the one green primary, and it adds the form's market.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add market' }))
    })
    expect(markets['projectSettings:addMarket']).toHaveBeenCalledWith(
      expect.objectContaining({
        market: expect.objectContaining({ country: 'BR', language: 'pt', location: 'São Paulo' })
      })
    )
  })
})
