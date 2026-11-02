import { describe, expect, it } from 'vitest'
import type { CommunitiesReport, CommunityAio, CommunityLink } from '@shared/domain'
import { createCommunityDrills } from './drills'

function aio(key: string, position: number): CommunityAio {
  const [runId = '', promptId = ''] = key.split('|')
  return {
    key,
    runId,
    pageId: 'page-1',
    pageLabel: 'Alerts',
    marketId: 'mkt-us',
    promptId,
    promptPosition: position,
    label: `Question ${position}`,
    text: `Question ${position}?`,
    status: 'not_cited',
    named: false,
    checkedAt: '2026-10-19T12:00:00.000Z',
    latest: runId === 'new'
  }
}

function link(aioKey: string, url: string, checkIndex: number): CommunityLink {
  return {
    aioKey,
    checkIndex,
    url,
    normalizedUrl: url,
    domain: new URL(url).hostname,
    title: null,
    position: 1,
    type: 'reddit',
    owner: 'external'
  }
}

const OLD = [
  link('old|p1', 'https://reddit.com/r/a/1', 1),
  link('old|p1', 'https://reddit.com/r/a/2', 1),
  link('old|p2', 'https://reddit.com/r/a/3', 1)
]
const NEW = [
  link('new|p1', 'https://reddit.com/r/a/1', 0),
  link('new|p2', 'https://reddit.com/r/a/4', 0),
  link('new|p2', 'https://reddit.com/r/a/5', 0),
  link('new|p3', 'https://reddit.com/r/a/6', 0)
]

const report = {
  scope: 'page',
  pageId: 'page-1',
  marketId: 'mkt-us',
  markets: [],
  brandNames: ['TextBolt'],
  domain: 'textbolt.com',
  aios: [aio('old|p1', 1), aio('old|p2', 2), aio('new|p1', 1), aio('new|p2', 2), aio('new|p3', 3)],
  links: [...OLD, ...NEW]
} as unknown as CommunitiesReport

describe('community drills (NFR-14)', () => {
  it('the change drawer lists the links gained and lost, and gained − lost is the change', () => {
    const drills = createCommunityDrills(report)
    const drill = drills.change(
      { id: 'change:reddit:delta', title: 'Reddit citations', description: '' },
      { before: OLD, after: NEW }
    )
    const gained = drill.items.filter((item) => item.group === 'gained')
    const lost = drill.items.filter((item) => item.group === 'lost')
    // The same link for the same prompt and market in both checks is neither.
    expect(gained).toHaveLength(3)
    expect(lost).toHaveLength(2)
    expect(gained.length - lost.length).toBe(NEW.length - OLD.length)
    expect(drill.title).toBe('Reddit citations: +1 (3 gained, 2 lost)')
    expect(drill.summary?.map((part) => part.label)).toEqual(['Gained', 'Lost'])
  })

  it('a links drill has one row per link, each opening its question in that check', () => {
    const drills = createCommunityDrills(report)
    const drill = drills.links({ id: 'links', title: 'Links', description: '' }, NEW)
    expect(drill.items).toHaveLength(NEW.length)
    expect(drill.items[1]?.target).toEqual({
      kind: 'prompt',
      pageId: 'page-1',
      promptId: 'p2',
      marketId: 'mkt-us',
      runId: 'new'
    })
    expect(drill.items[1]?.url).toBe('https://reddit.com/r/a/4')
  })

  it('an answers drill skips unknown keys, so its count is what it lists', () => {
    const drills = createCommunityDrills(report)
    const drill = drills.answers({ id: 'a', title: 'A', description: '' }, ['new|p1', 'gone|p9'])
    expect(drill.items.map((item) => item.id)).toEqual(['new|p1'])
  })

  it('a pages drill lists each tracked page once', () => {
    const drills = createCommunityDrills(report)
    const drill = drills.pages({ id: 'p', title: 'P', description: '' }, ['new|p1', 'new|p2'])
    expect(drill.items).toHaveLength(1)
    expect(drill.items[0]?.cells?.answers).toBe(2)
    expect(drill.items[0]?.target).toEqual({
      kind: 'page',
      pageId: 'page-1',
      tab: 'communities',
      marketId: 'mkt-us'
    })
  })

  it('project scope names each answer’s page instead of "your page"', () => {
    const project = { ...report, scope: 'project', pageId: null, marketId: null }
    const drills = createCommunityDrills(project as CommunitiesReport)
    const drill = drills.answers({ id: 'a', title: 'A', description: '' }, ['new|p1'])
    expect(drill.columns?.[0]?.label).toBe('Its page')
    expect(drill.summary?.[0]?.label).toBe('Its page cited')
    expect(drill.items[0]?.primary).toBe('Question 1 · Question 1 · Alerts')
    expect(drill.scope?.pageId).toBeNull()
    const pages = drills.pages({ id: 'p', title: 'P', description: '' }, ['new|p1'])
    expect(pages.items[0]?.target).toEqual({ kind: 'page', pageId: 'page-1', tab: 'communities' })
  })
})
