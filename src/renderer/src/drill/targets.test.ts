// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'
import { targetHref } from './targets'

describe('targetHref', () => {
  test('a page or question target in a named project opens through a project route', () => {
    expect(
      targetHref({ kind: 'page', pageId: 'a', tab: 'progress', marketId: 'm1', projectId: 'p2' })
    ).toBe('#/p/p2/pages/a/progress?market=m1')
    expect(targetHref({ kind: 'prompt', pageId: 'a', promptId: 'q', projectId: 'p2' })).toBe(
      '#/p/p2/pages/a/prompt/q'
    )
  })

  test('without a project the target stays in the open project', () => {
    expect(targetHref({ kind: 'page', pageId: 'a' })).toBe('#/pages/a/results')
    expect(targetHref({ kind: 'page', pageId: 'a', projectId: null })).toBe('#/pages/a/results')
  })

  test('a drawer target opens that drawer over the current screen and its drawers', () => {
    window.location.hash = '#/overview?drawer=drill&drill=fixes%3Aall'
    expect(targetHref({ kind: 'drawer', id: 'page-fix', values: { 'pfx.id': 'pf1' } })).toBe(
      '#/overview?drawer=drill&drill=fixes%3Aall&drawer=page-fix&pfx.id=pf1'
    )
    window.location.hash = ''
  })
})
