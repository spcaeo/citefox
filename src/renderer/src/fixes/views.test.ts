import { describe, expect, test } from 'vitest'
import { fixesTodoHash, fixesView, FIXES_TABS, tabOf, viewPatch } from './views'

describe('Fixes views', () => {
  test('three tabs; the old views open under Did it work?', () => {
    expect(FIXES_TABS.map((tab) => tab.label)).toEqual([
      'What to fix',
      'Changes made',
      'Did it work?'
    ])
    expect(fixesView(null)).toBe('todo')
    expect(fixesView('nope')).toBe('todo')
    expect(tabOf('todo')).toBe('todo')
    expect(tabOf('log')).toBe('log')
    for (const view of ['changes', 'round', 'backlinks', 'lost'] as const) {
      expect(tabOf(view)).toBe('changes')
    }
  })

  test('a view change clears the other views’ state but keeps the topic', () => {
    const patch = viewPatch('log')
    expect(patch.view).toBe('log')
    expect(patch.pf).toBeNull()
    expect(patch.kind).toBeNull()
    expect('topic' in patch).toBe(false)
    expect(viewPatch('todo').view).toBeNull()
  })

  test('links to What to fix, for a topic and an open fix', () => {
    expect(fixesTodoHash()).toBe('#/fixes')
    expect(fixesTodoHash({ topic: 'topic-1', pf: 'pfabc' })).toBe('#/fixes?topic=topic-1&pf=pfabc')
  })
})
