import { describe, expect, it } from 'vitest'
import {
  drawerOwnedKeys,
  drawerStack,
  sameStack,
  screenHash,
  usesLegacyDialog,
  withDrawerOpened,
  withDrawerParams,
  withDrawersClosed,
  withDrawerStack
} from './drawerUrl'
import { parseHash } from './routes'

describe('drawer URL', () => {
  it('reads the stack bottom first with each drawer’s own values', () => {
    expect(
      drawerStack('#/topics?sort=name&drawer=add-questions&target=t1&drawer=new-topic&step=pages')
    ).toEqual([
      { id: 'add-questions', params: { target: 't1' } },
      { id: 'new-topic', params: { step: 'pages' } }
    ])
    expect(drawerStack('#/overview')).toEqual([])
  })

  it('ignores unknown ids, repeats and a third level', () => {
    expect(
      drawerStack('#/x?drawer=nope&drawer=drill&drawer=drill&drawer=compare&drawer=add-questions')
    ).toEqual([
      { id: 'drill', params: {} },
      { id: 'compare', params: {} }
    ])
  })

  it('still opens the old ?dialog= links, and only for drawers that had one', () => {
    expect(drawerStack('#/overview?dialog=add-questions&target=p1')).toEqual([
      { id: 'add-questions', params: { target: 'p1' } }
    ])
    expect(usesLegacyDialog('#/overview?dialog=add-questions')).toBe(true)
    expect(drawerStack('#/settings?dialog=reset')).toEqual([])
    expect(drawerStack('#/x?dialog=drill')).toEqual([])
    expect(
      withDrawerStack(
        '#/overview?period=7d&dialog=new-topic&step=pages',
        drawerStack('#/overview?dialog=new-topic&step=pages')
      )
    ).toBe('#/overview?period=7d&drawer=new-topic&step=pages')
  })

  it('opens over the open drawer, swaps the top of a full stack, and reopens one already open', () => {
    const one = withDrawerOpened('#/topics?sort=name', 'add-questions', { target: 't1' })
    expect(one).toBe('#/topics?sort=name&drawer=add-questions&target=t1')
    const two = withDrawerOpened(one, 'new-topic', { step: 'questions' })
    expect(two).toBe(
      '#/topics?sort=name&drawer=add-questions&target=t1&drawer=new-topic&step=questions'
    )
    expect(withDrawerOpened(two, 'compare', { 'read-from': 'a' })).toBe(
      '#/topics?sort=name&drawer=add-questions&target=t1&drawer=compare&read-from=a'
    )
    expect(withDrawerOpened(two, 'add-questions', { target: 't2' })).toBe(
      '#/topics?sort=name&drawer=add-questions&target=t2'
    )
  })

  it('closes from a depth up and keeps the screen’s values', () => {
    const two =
      '#/topics?sort=name&drawer=add-questions&target=t1&drawer=new-topic&draft=d1&step=pages'
    expect(withDrawersClosed(two, 1)).toBe('#/topics?sort=name&drawer=add-questions&target=t1')
    expect(withDrawersClosed(two, 0)).toBe('#/topics?sort=name')
    expect(screenHash(two)).toBe('#/topics?sort=name')
    expect(screenHash('')).toBe('#/')
  })

  it('patches one drawer’s values and drops keys it does not own', () => {
    const hash = '#/a?drawer=drill&drill=kpi%3Aaio'
    expect(withDrawerParams(hash, 0, { 'drill.q': 'crm', other: 'x' })).toBe(
      '#/a?drawer=drill&drill=kpi%3Aaio&drill.q=crm'
    )
    expect(withDrawerParams('#/a?drawer=drill&drill=x&drill.q=crm', 0, { 'drill.q': null })).toBe(
      '#/a?drawer=drill&drill=x'
    )
    expect(withDrawerParams(hash, 3, { 'drill.q': 'x' })).toBe(hash)
  })

  it('lets a Topics row action keep its topic while New topic is open', () => {
    const owned = drawerOwnedKeys(
      new URLSearchParams('action=rename&topic=t1&drawer=new-topic&step=pages')
    )
    expect(owned.has('topic')).toBe(false)
    expect(owned.has('step')).toBe(true)
    expect(drawerOwnedKeys(new URLSearchParams('topic=t1&drawer=new-topic')).has('topic')).toBe(
      true
    )
  })

  it('keeps drawers out of the route, so opening one never changes the screen', () => {
    expect(parseHash('#/questions?view=all&drawer=drill&drill=kpi%3Aaio&drill.q=crm')).toEqual(
      parseHash('#/questions?view=all')
    )
    expect(parseHash('#/pages?view=tracked&drawer=add-questions&target=p1')).toEqual(
      parseHash('#/pages?view=tracked')
    )
  })

  it('reads Add questions’ topic, page and tab from its own part of the URL', () => {
    const hash =
      '#/pages/p1?tab=prompts&drawer=add-questions&topic=t1&tab=import&drawer=new-topic&step=name'
    expect(drawerStack(hash)).toEqual([
      { id: 'add-questions', params: { topic: 't1', tab: 'import' } },
      { id: 'new-topic', params: { step: 'name' } }
    ])
    // The page keeps its own tab; New topic does not take Add questions' topic.
    expect(parseHash(hash)).toEqual(parseHash('#/pages/p1?tab=prompts'))
    expect(screenHash(hash)).toBe('#/pages/p1?tab=prompts')
    expect(drawerStack('#/topics?topic=t9&drawer=add-questions')).toEqual([
      { id: 'add-questions', params: {} }
    ])
    // New topic still reads a topic written before it (its old links).
    expect(drawerStack('#/x?topic=t1&drawer=new-topic')[0]?.params).toEqual({ topic: 't1' })
  })

  it('writes and patches positional values next to their drawer', () => {
    const one = withDrawerOpened('#/pages/p1?tab=prompts', 'add-questions', {
      page: 'p1',
      tab: 'type'
    })
    expect(one).toBe('#/pages/p1?tab=prompts&drawer=add-questions&page=p1&tab=type')
    expect(withDrawerParams(one, 0, { tab: 'suggest' })).toBe(
      '#/pages/p1?tab=prompts&drawer=add-questions&page=p1&tab=suggest'
    )
    const two = withDrawerOpened(one, 'import', { 'import.entity': 'questions' })
    expect(two).toBe(
      '#/pages/p1?tab=prompts&drawer=add-questions&page=p1&tab=type&drawer=import&import.entity=questions'
    )
    expect(withDrawersClosed(two, 1)).toBe(one)
  })

  it('compares stacks by id and values', () => {
    expect(
      sameStack(drawerStack('#/a?drawer=drill&drill=x'), drawerStack('#/b?drawer=drill&drill=x'))
    ).toBe(true)
    expect(
      sameStack(drawerStack('#/a?drawer=drill&drill=x'), drawerStack('#/a?drawer=drill&drill=y'))
    ).toBe(false)
  })
})
