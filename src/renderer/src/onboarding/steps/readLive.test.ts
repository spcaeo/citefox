import { describe, expect, it } from 'vitest'
import type {
  CompanySuggestion,
  FillFromWebsiteResult,
  FillSiteFound,
  ProductSuggestion
} from '@shared/ipc'
import { emptySetupDraft } from '../setupDraft'
import { appendRows, applyFill, competitorRows } from '../setupApply'
import {
  competitorsSoFar,
  EMPTY_LIVE,
  liveFill,
  NOT_FINISHED_NOTE,
  reduceLive,
  retrying,
  retryRequest,
  searchesSettled,
  siteNamedOnly,
  type LiveAction,
  type ReadLive
} from './readLive'

function product(id: string, name: string): ProductSuggestion {
  return {
    id,
    name,
    job: `${name} job`,
    buyer: 'Small US businesses',
    evidence: null,
    searchNote: null
  }
}

function rival(name: string, productId: string, domain: string | null = null): CompanySuggestion {
  return {
    id: `c-${name}`,
    name,
    domain,
    domainSource: domain === null ? null : 'search',
    reason: 'Same job.',
    evidence: null,
    checkDomain: false,
    product: productId,
    tier: 'direct'
  }
}

const SITE: FillSiteFound = {
  kind: 'site',
  summary: 'TextBolt turns emails into texts.',
  brands: [{ id: 'b1', name: 'TextBolt', reason: 'Home page.' }],
  products: [
    product('p1', 'Email-to-SMS'),
    product('p2', 'Gateway replacement'),
    product('p3', 'On-call alerts')
  ],
  comparedWith: ['SimpleTexting', 'Text-Em-All', 'Textedly'],
  switchingFrom: [{ ...rival('AT&T gateway', ''), product: null }],
  integrations: [{ ...rival('Gmail', ''), product: null }],
  suggestedMarket: null,
  market: { country: 'US', language: 'en' }
}

function play(...actions: LiveAction[]): ReadLive {
  return actions.reduce(reduceLive, EMPTY_LIVE)
}

const search = (
  productId: string,
  state: 'waiting' | 'running' | 'done' | 'failed',
  at: number,
  competitors: CompanySuggestion[] = [],
  note: string | null = null
): LiveAction => ({
  type: 'search',
  found: { kind: 'search', productId, state, competitors, note },
  at
})

describe('step 3 live read: the reducer', () => {
  it('lists each product as waiting once the site read is in', () => {
    const live = play({ type: 'site', found: SITE })
    expect(live.searches.map((item) => [item.name, item.state])).toEqual([
      ['Email-to-SMS', 'waiting'],
      ['Gateway replacement', 'waiting'],
      ['On-call alerts', 'waiting']
    ])
    expect(searchesSettled(live)).toBe(false)
  })

  it('follows each search: its turn, its time, its competitors, or why it failed', () => {
    const live = play(
      { type: 'site', found: SITE },
      search('p1', 'running', 1_000),
      search('p2', 'running', 1_500),
      search('p1', 'done', 90_000, [rival('Textmagic', 'p1'), rival('SimpleTexting', 'p1')]),
      search('p2', 'failed', 181_500, [], 'It took too long and was stopped.')
    )
    const [p1, p2, p3] = live.searches
    expect(p1).toMatchObject({ state: 'done', startedAt: 1_000, endedAt: 90_000 })
    expect(p1?.competitors.map((row) => row.name)).toEqual(['Textmagic', 'SimpleTexting'])
    expect(p2).toMatchObject({
      state: 'failed',
      startedAt: 1_500,
      note: 'It took too long and was stopped.'
    })
    expect(p3).toMatchObject({ state: 'waiting', startedAt: null })
  })

  it('never takes a finished search back to running', () => {
    const live = play(
      { type: 'site', found: SITE },
      search('p1', 'done', 5, [rival('Textmagic', 'p1')]),
      search('p1', 'running', 6)
    )
    expect(live.searches[0]?.state).toBe('done')
  })

  it('ignores a search for a product it does not know', () => {
    const live = play({ type: 'site', found: SITE }, search('p9', 'done', 5, [rival('X', 'p9')]))
    expect(competitorsSoFar(live)).toEqual([])
  })

  it('a Try again runs, is waited for, and lands under the same product', () => {
    let live = play(
      { type: 'site', found: SITE },
      search('p2', 'failed', 10, [], 'It took too long and was stopped.'),
      { type: 'retry', productId: 'p2', at: 20 }
    )
    expect(live.searches[1]).toMatchObject({
      state: 'running',
      startedAt: 20,
      retried: true,
      note: null
    })
    expect(retrying(live)).toBe(true)
    live = reduceLive(live, {
      type: 'retried',
      result: { productId: 'p2', ok: true, competitors: [rival('ClickSend', 'p2')], note: null },
      at: 50
    })
    expect(live.searches[1]).toMatchObject({ state: 'done', endedAt: 50 })
    expect(retrying(live)).toBe(false)
  })

  it('a Try again that fails again says why', () => {
    const live = play(
      { type: 'site', found: SITE },
      search('p2', 'failed', 10),
      { type: 'retry', productId: 'p2', at: 20 },
      {
        type: 'retried',
        result: { productId: 'p2', ok: false, competitors: [], note: null },
        at: 30
      }
    )
    expect(live.searches[1]).toMatchObject({ state: 'failed', note: NOT_FINISHED_NOTE })
  })

  it('the read’s answer settles open searches, but not one the user is retrying', () => {
    const fill: FillFromWebsiteResult = {
      ...liveFill(play({ type: 'site', found: SITE }), 'textbolt.com'),
      products: [
        { ...product('p1', 'Email-to-SMS') },
        { ...product('p2', 'Gateway replacement'), searchNote: 'did not finish' },
        { ...product('p3', 'On-call alerts') }
      ],
      competitors: [rival('Textmagic', 'p1'), rival('Notifyre', 'p3')]
    }
    const live = play(
      { type: 'site', found: SITE },
      search('p1', 'failed', 10),
      { type: 'retry', productId: 'p1', at: 11 },
      { type: 'final', fill, at: 99 }
    )
    expect(live.searches.map((item) => item.state)).toEqual(['running', 'failed', 'done'])
    expect(live.searches[2]?.competitors.map((row) => row.name)).toEqual(['Notifyre'])
  })

  it('a read with no live events is filled in from its answer', () => {
    const fill: FillFromWebsiteResult = {
      ...liveFill(play({ type: 'site', found: SITE }), 'textbolt.com'),
      competitors: [rival('Textmagic', 'p1')]
    }
    const live = play({ type: 'final', fill, at: 5 })
    expect(live.site?.products.map((item) => item.name)).toEqual([
      'Email-to-SMS',
      'Gateway replacement',
      'On-call alerts'
    ])
    expect(searchesSettled(live)).toBe(true)
    expect(competitorsSoFar(live).map((row) => row.name)).toEqual(['Textmagic'])
  })

  it('a read that stops after the site read fails only the searches still open', () => {
    const live = play(
      { type: 'site', found: SITE },
      search('p1', 'done', 5, [rival('Textmagic', 'p1')]),
      { type: 'lost', note: 'The read stopped.', at: 9 }
    )
    expect(live.searches.map((item) => [item.state, item.note])).toEqual([
      ['done', null],
      ['failed', 'The read stopped.'],
      ['failed', 'The read stopped.']
    ])
  })
})

describe('step 3 live read: merging what was found', () => {
  const live = play(
    { type: 'site', found: SITE },
    search('p1', 'done', 5, [rival('Textmagic', 'p1'), rival('SimpleTexting', 'p1')]),
    search('p3', 'done', 6, [rival('Text Magic', 'p3'), rival('Notifyre', 'p3')])
  )

  it('lists each competitor once, by name, in product order', () => {
    expect(competitorsSoFar(live).map((row) => row.name)).toEqual([
      'Textmagic',
      'SimpleTexting',
      'Notifyre'
    ])
  })

  it('adds the rivals the site names that no search listed, without repeats', () => {
    expect(siteNamedOnly(live)).toEqual(['Text-Em-All', 'Textedly'])
    expect(siteNamedOnly(EMPTY_LIVE)).toEqual([])
  })

  it('builds a Fill answer from the site read and the finished searches', () => {
    const failed = reduceLive(live, search('p2', 'failed', 7))
    const fill = liveFill(failed, 'textbolt.com')
    expect(fill.products?.map((item) => item.searchNote)).toEqual([null, NOT_FINISHED_NOTE, null])
    expect(fill.competitors.map((row) => row.name)).toEqual([
      'Textmagic',
      'SimpleTexting',
      'Text Magic',
      'Notifyre'
    ])
    expect(fill.brands.map((brand) => brand.name)).toEqual(['TextBolt'])
  })

  it('asks Try again with the same question the read asked', () => {
    expect(retryRequest(live, 'textbolt.com', 'p2')).toEqual({
      projectId: null,
      domain: 'textbolt.com',
      market: { country: 'US', language: 'en' },
      summary: 'TextBolt turns emails into texts.',
      product: {
        id: 'p2',
        name: 'Gateway replacement',
        job: 'Gateway replacement job',
        buyer: 'Small US businesses'
      },
      comparedWith: ['SimpleTexting', 'Text-Em-All', 'Textedly'],
      brandNames: ['TextBolt'],
      notCompetitors: ['AT&T gateway', 'Gmail']
    })
    expect(retryRequest(EMPTY_LIVE, 'textbolt.com', 'p2')).toBeNull()
    expect(retryRequest(live, 'textbolt.com', 'nope')).toBeNull()
  })

  it('late competitors join the draft at the end, leaving every row there as it is', () => {
    let draft = applyFill(emptySetupDraft(), liveFill(live, 'textbolt.com'))
    const before = draft.lists.competitors
    expect(before.map((row) => [row.name, row.tag])).toEqual([
      ['Textmagic', 'Email-to-SMS'],
      ['SimpleTexting', 'Email-to-SMS'],
      ['Notifyre', 'On-call alerts']
    ])
    // The user unticks one; a late search that names it again must not tick it back.
    draft = {
      ...draft,
      lists: {
        ...draft.lists,
        competitors: draft.lists.competitors.map((row) =>
          row.name === 'Notifyre' ? { ...row, kept: false } : row
        )
      }
    }
    const late = competitorRows(SITE.products, [rival('ClickSend', 'p2'), rival('notifyre', 'p2')])
    const next = appendRows(draft, 'competitors', late)
    expect(next.lists.competitors.map((row) => [row.name, row.kept, row.tag])).toEqual([
      ['Textmagic', true, 'Email-to-SMS'],
      ['SimpleTexting', true, 'Email-to-SMS'],
      ['Notifyre', false, 'On-call alerts'],
      ['ClickSend', true, 'Gateway replacement']
    ])
    expect(next.lists.competitors[0]).toBe(draft.lists.competitors[0])
    expect(appendRows(next, 'competitors', late)).toBe(next)
  })
})
