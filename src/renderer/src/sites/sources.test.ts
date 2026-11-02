import { describe, expect, it } from 'vitest'
import type { AioOverview } from '@shared/aio-overview'
import type { CompetitorEntry } from '@shared/competitor-hosts'
import type { SiteTypeSettings } from '@shared/site-overrides'
import {
  REAL_MARKDOWN,
  REAL_REFERENCES
} from '../promptDetail/components/sources/sources.fixtures.test-helper'
import {
  citedLabel,
  markdownCitations,
  overviewCitations,
  relationLabel,
  siteTypeLabel,
  sourceLines,
  sourceRelation,
  sourceSummary,
  urlKey
} from './sources'

const TWILIO = { id: 'c-twilio', name: 'Twilio', domain: 'twilio.com', aliases: [] }
const inputs = REAL_REFERENCES.map((reference) => ({ ...reference, key: reference.id }))

describe('who a source is', () => {
  it('keeps the stored class for this page and own pages', () => {
    expect(sourceRelation({ ...inputs[2]! }, [])).toEqual({ kind: 'target' })
    expect(sourceRelation({ ...inputs[0]! }, [])).toEqual({ kind: 'own', tracked: false })
    expect(sourceRelation({ ...inputs[0]!, untracked: false }, [])).toEqual({
      kind: 'own',
      tracked: true
    })
  })

  it('a page tracked this visit reads as tracked', () => {
    const tracked = new Set([urlKey('https://textbolt.com/migration/verizon')])
    expect(sourceRelation({ ...inputs[0]! }, [], tracked)).toEqual({ kind: 'own', tracked: true })
  })

  it('a saved competitor matches by host, even when the check stored it as other', () => {
    expect(sourceRelation({ ...inputs[1]! }, [TWILIO])).toEqual({
      kind: 'competitor',
      name: 'Twilio',
      id: 'c-twilio'
    })
    expect(sourceRelation({ ...inputs[1]! }, [])).toEqual({ kind: 'neutral' })
  })

  it('matches a competitor by an alias domain too', () => {
    const alias: CompetitorEntry = {
      name: 'ClickSend',
      domain: 'clicksend.io',
      aliases: ['clicksend.com']
    }
    expect(sourceRelation({ ...inputs[3]! }, [alias])).toEqual({
      kind: 'competitor',
      name: 'ClickSend',
      id: null
    })
  })

  it('keeps a stored competitor that the list no longer names', () => {
    expect(sourceRelation({ ...inputs[3]!, classification: 'competitor' }, [])).toEqual({
      kind: 'competitor',
      name: null,
      id: null
    })
  })

  it('a known platform names itself and its role, never a competitor', () => {
    expect(sourceRelation({ ...inputs[6]! }, [])).toEqual({
      kind: 'platform',
      role: 'community',
      name: 'Reddit',
      detail: 'r/msp'
    })
    // Even when an old check stored it as a competitor.
    expect(sourceRelation({ ...inputs[6]!, classification: 'competitor' }, [])).toMatchObject({
      kind: 'platform'
    })
    expect(relationLabel(sourceRelation({ ...inputs[6]! }, []), false)).toBe(
      'Community · Reddit r/msp'
    )
  })

  it('a big company that is not a platform stays Neutral until the user says', () => {
    expect(sourceRelation({ ...inputs[4]! }, [])).toEqual({ kind: 'neutral' })
    expect(relationLabel({ kind: 'neutral' }, false)).toBe('Neutral')
  })

  it('never says the bare word Other', () => {
    expect(relationLabel({ kind: 'target' }, false)).toBe('This page')
    expect(relationLabel({ kind: 'target' }, true)).toBe('Your target page')
    expect(relationLabel({ kind: 'own', tracked: false }, true)).toBe('Your page')
    expect(relationLabel({ kind: 'competitor', name: 'Twilio', id: null }, false)).toBe(
      'Competitor · Twilio'
    )
    expect(relationLabel({ kind: 'competitor', name: null, id: null }, false)).toBe('Competitor')
  })
})

describe('the sources table rows', () => {
  it('sorts each source into a type of site and counts its links in the answer', () => {
    const lines = sourceLines(inputs, [TWILIO], markdownCitations(REAL_MARKDOWN))
    expect(lines.map((line) => [line.position, line.type, line.relation.kind, line.cited])).toEqual(
      [
        [1, 'yours', 'own', 2],
        [2, 'competitor', 'competitor', 1],
        [3, 'yours', 'target', 1],
        [4, 'web', 'neutral', 0],
        [5, 'docs', 'neutral', 1],
        [6, 'web', 'neutral', 1],
        [7, 'community', 'platform', 0]
      ]
    )
    expect(sourceSummary(lines)).toEqual([
      'Your site: 2 pages',
      'Competitors: 1',
      'Communities: 1',
      'Neutral: 3'
    ])
  })

  it('says a dash when the answer links are not stored', () => {
    const [line] = sourceLines(inputs.slice(0, 1), [], null)
    expect(line?.cited).toBeNull()
    expect(citedLabel(null)).toBe('—')
    expect(citedLabel(0)).toBe('Listed only')
    expect(citedLabel(1)).toBe('Once')
    expect(citedLabel(3)).toBe('3 times')
  })
})

describe('your own word on a site', () => {
  const settings: SiteTypeSettings = {
    customTypes: [{ id: 't1', name: 'Carrier', tone: 'info' }],
    overrides: [
      // A role on a saved competitor's domain: the user's word wins.
      { domain: 'twilio.com', type: null, role: 'media' },
      { domain: 'reddit.com', type: 'news', role: 'neutral' },
      { domain: 'att.com', type: 'custom:t1', role: null },
      // A deleted custom type reads as automatic.
      { domain: 'email2phone.net', type: 'custom:gone', role: null },
      // Own pages always stay yours.
      { domain: 'textbolt.com', type: 'news', role: 'social' }
    ]
  }

  it('follows: own site > your choice > competitor list > known platform > Neutral', () => {
    const lines = sourceLines(inputs, [TWILIO], null, new Set(), settings)
    expect(
      lines.map((line) => [
        line.position,
        siteTypeLabel(line),
        relationLabel(line.relation, false),
        line.typeEdited,
        line.roleEdited
      ])
    ).toEqual([
      [1, 'Your site', 'Your page', false, false],
      [2, 'Other website', 'Media · twilio.com', false, true],
      [3, 'Your site', 'This page', false, false],
      [4, 'Other website', 'Neutral', false, false],
      [5, 'Carrier', 'Neutral', true, false],
      [6, 'Other website', 'Neutral', false, false],
      [7, 'News & media', 'Neutral', true, true]
    ])
    expect(lines[4]?.customType).toEqual({ id: 't1', name: 'Carrier', tone: 'info' })
    // Without the role, the competitor list wins over the platform list.
    const listed = sourceLines(inputs, [TWILIO, { name: 'Reddit', domain: 'reddit.com' }], null)
    expect(relationLabel(listed[6]!.relation, false)).toBe('Competitor · Reddit')
  })

  it('a choice on a domain covers its subdomains, and the nearest one wins', () => {
    const old = { ...inputs[6]!, url: 'https://old.reddit.com/r/msp/', domain: 'old.reddit.com' }
    const [line] = sourceLines([old], [], null, new Set(), {
      customTypes: [],
      overrides: [
        { domain: 'reddit.com', type: null, role: 'social' },
        { domain: 'old.reddit.com', type: null, role: 'qa' }
      ]
    })
    expect(line?.site).toBe('old.reddit.com')
    expect(relationLabel(line!.relation, false)).toBe('Q&A · Reddit')
  })
})

describe('links in the answer text', () => {
  it('counts each block of a Google overview that cites a source once', () => {
    const overview: AioOverview = {
      blocks: [
        { kind: 'paragraph', text: [], refs: [0, 0, 1] },
        {
          kind: 'list',
          items: [
            { label: null, text: [], refs: [1], children: [] },
            {
              label: null,
              text: [],
              refs: [],
              children: [{ kind: 'paragraph', text: [], refs: [0] }]
            }
          ]
        },
        {
          kind: 'expandable',
          title: 'More',
          blocks: [{ kind: 'table', header: [], rows: [], refs: [2] }]
        }
      ],
      sources: [
        source(0, 'https://textbolt.com/migration/verizon/#:~:text=alerts'),
        source(1, 'https://www.twilio.com/blog/sms'),
        source(2, 'https://www.reddit.com/r/msp/'),
        source(3, null)
      ]
    }
    const counts = overviewCitations(overview)
    expect(counts.get(urlKey('https://textbolt.com/migration/verizon'))).toBe(2)
    expect(counts.get(urlKey('https://twilio.com/blog/sms/'))).toBe(2)
    expect(counts.get(urlKey('https://reddit.com/r/msp'))).toBe(1)
  })

  it('matches addresses without www, a trailing slash or utm tags', () => {
    expect(urlKey('https://www.Twilio.com/blog/?utm_source=x')).toBe('twilio.com/blog')
    expect(urlKey('not a url')).toBe('not a url')
  })
})

function source(index: number, url: string | null): AioOverview['sources'][number] {
  return { index, title: null, url, snippet: null, source: null, icon: null, thumbnail: null }
}
