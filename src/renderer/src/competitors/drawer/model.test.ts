import { describe, expect, it } from 'vitest'
import {
  competitorParamsFrom,
  formErrors,
  formFrom,
  mergeCompetitorValues,
  saveRequest,
  sameForm
} from './model'

describe('competitor drawer model', () => {
  it('reads the mode and the merge picks from the URL', () => {
    expect(competitorParamsFrom({})).toEqual({ mode: 'add', id: null, ids: [] })
    expect(competitorParamsFrom({ competitor: 'sabc' })).toEqual({
      mode: 'edit',
      id: 'sabc',
      ids: []
    })
    expect(
      competitorParamsFrom({
        competitor: 'sabc',
        'competitor.mode': 'merge',
        'competitor.ids': 'sdef,sabc, ,sghi'
      })
    ).toEqual({ mode: 'merge', id: 'sabc', ids: ['sdef', 'sghi'] })
    expect(mergeCompetitorValues('sabc')).toEqual({
      competitor: 'sabc',
      'competitor.mode': 'merge',
      'competitor.ids': null
    })
  })

  it('checks the domain, the aliases and the products, and builds the request', () => {
    const form = { ...formFrom(null), domain: 'not a domain' }
    expect(formErrors(form, false)).toEqual({
      domain: 'Use a domain such as competitor.example.com'
    })
    expect(formErrors(formFrom(null), false).name).toBe('Give the competitor a name or a domain')
    expect(
      formErrors({ ...formFrom(null), name: 'X', aliasDraft: 'nope', products: [] }, true)
    ).toEqual({ aliases: 'nope is not a domain', products: 'Pick what it competes with' })
    const ok = {
      ...formFrom(null),
      domain: 'www.Example.com/pricing',
      aliases: ['https://app.example.io'],
      products: ['', 'prod-a']
    }
    expect(saveRequest('proj-1', null, ok, true)).toEqual({
      projectId: 'proj-1',
      id: null,
      name: 'example.com',
      domain: 'example.com',
      aliases: ['app.example.io'],
      tier: 'direct',
      productIds: [null, 'prod-a']
    })
    expect(sameForm(formFrom(null), { ...formFrom(null), name: '  ' })).toBe(true)
    expect(sameForm(formFrom(null), { ...formFrom(null), tier: 'partial' })).toBe(false)
  })
})
