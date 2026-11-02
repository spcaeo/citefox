import { describe, expect, test } from 'vitest'
import { drawerStack, screenQuery } from '../../shell/drawerUrl'
import {
  drawerDrill,
  drillDrawerHash,
  drillValues,
  isDrillQuery,
  legacyDrillHash,
  legacyTopicPatch,
  parseViewQuery,
  QUESTIONS_DRILL_PREFIX,
  withoutDrillDrawer
} from './url'

const q = (text: string): URLSearchParams => new URLSearchParams(text)

describe('topic view URLs', () => {
  test('reads the segment, search, tree mode, page, picks and drill', () => {
    const query = parseViewQuery(
      q('view=list&type=keyword&q=nagios&tree=result&p=3&sel=a,b&stage=problem&result=not_cited')
    )
    expect(query).toEqual({
      type: 'keyword',
      q: 'nagios',
      tree: 'result',
      page: 3,
      sel: ['a', 'b'],
      drill: { stage: 'problem', result: 'not_cited' }
    })
    expect(isDrillQuery(query)).toBe(true)
    // The Questions/Keywords segment alone is not a drill.
    expect(isDrillQuery(parseViewQuery(q('type=question')))).toBe(false)
    expect(parseViewQuery(q('p=0&tree=nope'))).toMatchObject({ page: 1, tree: 'stage' })
  })

  test('a drill opens its drawer over the view, which keeps every value of its own', () => {
    const hash = drillDrawerHash('#/topics/t1?view=grid&type=question&q=sms&p=2', {
      stage: 'fit',
      result: 'other_page'
    })
    expect(drawerStack(hash)).toEqual([
      { id: 'search-drill', params: { stage: 'fit', result: 'other_page' } }
    ])
    const screen = screenQuery(new URLSearchParams(hash.split('?')[1]))
    expect(screen.toString()).toBe('view=grid&type=question&q=sms&p=2')
    // Closing it is the view exactly as it was.
    expect(withoutDrillDrawer(hash)).toBe('#/topics/t1?view=grid&type=question&q=sms&p=2')
    // A kind is the drawer's own, so the view's segment stays; a new drill replaces the
    // open one's values.
    const next = drillDrawerHash(hash, { result: 'target', kind: 'keyword' })
    expect(next).toContain('type=question')
    expect(drawerStack(next)).toEqual([
      { id: 'search-drill', params: { result: 'target', kind: 'keyword' } }
    ])
    expect(drawerDrill(drawerStack(next)[0]?.params)).toEqual({
      result: 'target',
      kind: 'keyword'
    })
  })

  test('Needs work drills as one key (work=1), and reads back', () => {
    expect(drillValues({ stage: 'problem', work: true })).toMatchObject({
      stage: 'problem',
      work: '1',
      result: null
    })
    expect(parseViewQuery(q('stage=problem&work=1')).drill).toEqual({
      stage: 'problem',
      work: true
    })
    expect(isDrillQuery(parseViewQuery(q('work=1')))).toBe(true)
  })

  test('old To-do, By stage, Keywords and Progress URLs land on the new views', () => {
    expect(legacyTopicPatch(q('tab=todo'))).toEqual({ tab: null, view: 'tree' })
    expect(legacyTopicPatch(q('tab=stage'))).toEqual({ tab: null, view: 'grid' })
    expect(legacyTopicPatch(q('tab=keywords'))).toEqual({
      tab: null,
      view: 'tree',
      type: 'keyword'
    })
    expect(legacyTopicPatch(q('tab=progress'))).toEqual({ tab: null, view: 'progress' })
    expect(legacyTopicPatch(q('filter=state:no_page'))).toEqual({
      tab: null,
      filter: null,
      result: 'not_cited'
    })
    expect(legacyTopicPatch(q('filter=stage:doubts'))).toEqual({
      tab: null,
      filter: null,
      stage: 'doubts'
    })
    expect(legacyTopicPatch(q('view=grid'))).toBeNull()
    expect(legacyTopicPatch(q('filter=target:p1'))).toBeNull()
  })

  test('Questions prefixes its drill keys, so the List keeps result and source', () => {
    const P = QUESTIONS_DRILL_PREFIX
    // The List's own filter is not a drill there.
    expect(isDrillQuery(parseViewQuery(q('result=cited&source=page-1'), P))).toBe(false)
    const query = parseViewQuery(q('type=question&d.result=not_cited&d.source=topic-1'), P)
    expect(query.type).toBe('question')
    expect(query.drill).toEqual({ result: 'not_cited', source: 'topic-1' })
    expect(drillValues({ result: 'target', kind: 'keyword' }, P)).toEqual({
      'd.kind': 'keyword',
      'd.stage': null,
      'd.result': 'target',
      'd.work': null,
      'd.words': null,
      'd.page': null,
      'd.site': null,
      'd.source': null
    })
    // The List's `result` stays the screen's while the drill's drawer is open.
    const hash = drillDrawerHash('#/questions?view=list&result=cited', { result: 'target' }, P)
    expect(screenQuery(new URLSearchParams(hash.split('?')[1])).get('result')).toBe('cited')
    expect(drawerStack(hash)[0]?.params).toEqual({ 'd.result': 'target' })
    expect(drawerDrill({ 'd.result': 'target', 'd.kind': 'question', result: 'x' }, P)).toEqual({
      result: 'target',
      kind: 'question'
    })
  })

  test('links from before the drawer open it, and leave the rest of the URL alone', () => {
    expect(legacyDrillHash('#/topics/t1?view=grid&stage=problem&result=not_cited')).toBe(
      '#/topics/t1?view=grid&drawer=search-drill&stage=problem&result=not_cited'
    )
    expect(legacyDrillHash('#/topics/t1?view=grid')).toBeNull()
    // Already in the drawer: nothing to do.
    expect(legacyDrillHash('#/topics/t1?drawer=search-drill&stage=problem')).toBeNull()
    // Questions: only the prefixed keys are the drill's; the List's `result` stays.
    const P = QUESTIONS_DRILL_PREFIX
    expect(legacyDrillHash('#/questions?folder=f1&result=cited&d.result=not_cited', P)).toBe(
      '#/questions?folder=f1&result=cited&drawer=search-drill&d.result=not_cited'
    )
    expect(legacyDrillHash('#/questions?result=cited', P)).toBeNull()
  })
})
