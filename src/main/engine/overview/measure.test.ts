import { describe, expect, it } from 'vitest'
import type { AioReference, PromptCheckRow } from '@shared/domain'
import { ownPageOf } from './measure'

function reference(position: number, classification: AioReference['classification']): AioReference {
  return {
    id: `r${position}`,
    position,
    url: `https://example.com/${position}/`,
    normalizedUrl: `example.com/${position}`,
    domain: 'example.com',
    title: null,
    classification,
    untracked: false,
    sourceType: 'other'
  } as AioReference
}

function row(status: PromptCheckRow['status'], references: AioReference[]): PromptCheckRow {
  return { status, references, named: false } as unknown as PromptCheckRow
}

describe('ownPageOf', () => {
  it('says which own page an overview cites: the target page wins over another own page', () => {
    expect(ownPageOf(row('page_cited', [reference(1, 'own'), reference(2, 'target')]))).toBe(
      'target'
    )
    expect(
      ownPageOf(row('other_own_page', [reference(1, 'competitor'), reference(2, 'own')]))
    ).toBe('other')
  })

  it('for a topic question, the target page is the URL the question names, like the topic screen', () => {
    const cited = row('page_cited', [reference(1, 'competitor'), reference(2, 'own')])
    expect(ownPageOf(cited, { url: 'https://example.com/2/' })).toBe('target')
    expect(ownPageOf(cited, { url: 'https://example.com/9/' })).toBe('other')
    expect(ownPageOf(cited, { url: null })).toBe('other')
  })

  it('is null when the site is not cited or there is no AI Overview', () => {
    expect(ownPageOf(row('not_cited', [reference(1, 'competitor')]))).toBeNull()
    expect(ownPageOf(row('no_aio', []))).toBeNull()
  })
})
