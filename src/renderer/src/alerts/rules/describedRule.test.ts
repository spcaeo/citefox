import { describe, expect, it } from 'vitest'
import type { ScopeOptions } from '../../scope'
import { fillFromDescribed } from './describedRule'

const OPTIONS = {
  projectId: 'proj-1',
  domain: 'textbolt.com',
  pages: [{ id: 'pg-1', tracked: true }],
  groups: [{ id: 'grp-1' }],
  clusters: [],
  topics: [],
  views: [],
  markets: [{ id: 'm-us' }],
  defaultMarketId: 'm-us',
  searchesLeft: null
} as unknown as ScopeOptions

describe('fillFromDescribed', () => {
  it('a rule with no known "when" fills nothing', () => {
    expect(
      fillFromDescribed({ when: 'whenever' }, { options: OPTIONS, emails: [], slackReady: true })
    ).toBeNull()
  })

  it('unknown pages fall back to every tracked page, Slack stays off until set up, desktop is kept on', () => {
    const fill = fillFromDescribed(
      {
        name: 'Score watch',
        when: 'score_drop',
        score: '15',
        scope: 'group',
        scope_ids: 'grp-gone',
        markets: 'm-us,m-zz',
        desktop: 'no',
        slack: 'yes',
        email: 'boss@example.com',
        delivery: 'instant',
        note: ''
      },
      { options: OPTIONS, emails: ['ops@textbolt.com'], slackReady: false }
    )
    expect(fill?.patch).toMatchObject({
      name: 'Score watch',
      when: 'score_drop',
      scoreDrop: 15,
      scoreText: '15',
      scope: { kind: 'tracked', ids: [] },
      marketIds: ['m-us'],
      desktop: true,
      slack: false,
      emailTo: []
    })
    expect(fill?.notes).toEqual([
      'The pages it named were not found, so it watches every tracked page. Pick them below.',
      'Slack is not set up yet, so it is left off.',
      'Only addresses already set up in Alerts are filled in.'
    ])
  })
})
