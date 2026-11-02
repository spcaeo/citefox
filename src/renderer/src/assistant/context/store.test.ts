import { afterEach, describe, expect, it } from 'vitest'
import {
  currentAiContext,
  registerAiPatch,
  removeAiPatch,
  resetAiContext,
  setAiBase,
  updateAiPatch
} from './store'
import { aiBaseFor } from './base'
import type { AiContextBase } from './types'
import { contextChips } from '../words'

const BASE: AiContextBase = {
  screen: 'topic.todo',
  screenLabel: 'To-do',
  route: '#/topics/topic-1',
  crumbs: ['TextBolt', 'Topics', 'Replacing a carrier gateway'],
  projectId: 'proj-1',
  projectName: 'TextBolt',
  pageId: null,
  topicId: 'topic-1',
  promptId: null,
  marketId: 'mkt-us',
  runId: null,
  filters: { status: 'Not cited' }
}

afterEach(() => resetAiContext())

describe('the AI context registry', () => {
  it('starts from the route part the shell sets', () => {
    setAiBase(BASE)
    expect(currentAiContext()).toMatchObject({
      screen: 'topic.todo',
      topicId: 'topic-1',
      filters: { status: 'Not cited' },
      entities: []
    })
  })

  it('names the open page as the breadcrumb does, whatever label the screen used', () => {
    setAiBase(
      aiBaseFor({
        location: { kind: 'prompt', pageId: 'page-1', promptId: 'prompt-1' },
        hash: '#/pages/page-1/prompt/prompt-1',
        projectId: 'proj-1',
        projectName: 'TextBolt',
        crumbs: [
          { label: 'TextBolt' },
          { label: 'Text alerts for business' },
          { label: 'Question' }
        ],
        pageName: 'Text alerts for business'
      })
    )
    // The screen names the page by its short label; another page keeps its own name.
    registerAiPatch(0, {
      entities: [
        { kind: 'page', id: 'page-1', label: 'Alerts' },
        { kind: 'page', id: 'page-2', label: 'Pricing' }
      ]
    })
    const context = currentAiContext()
    expect(context.entities.map((item) => item.label)).toEqual([
      'Text alerts for business',
      'Pricing'
    ])
    expect(contextChips(context)).toContain('Page: Text alerts for business')
    expect(contextChips(context)).not.toContain('Page: Alerts')
  })

  it('names the open topic as the breadcrumb does', () => {
    setAiBase({ ...BASE, pageName: 'Replacing a carrier gateway' })
    registerAiPatch(0, { entities: [{ kind: 'topic', id: 'topic-1', label: 'Carrier' }] })
    expect(contextChips(currentAiContext())).toContain('Topic: Replacing a carrier gateway')
  })

  it('merges the screen under a drawer: scalars override, lists add up', () => {
    setAiBase(BASE)
    registerAiPatch(0, {
      entities: [{ kind: 'topic', id: 'topic-1', label: 'Replacing a carrier gateway' }],
      numbers: [{ label: 'Cited', value: '7 of 10' }],
      selection: [{ kind: 'question', id: 'q-1', label: 'How do I…' }]
    })
    registerAiPatch(1, {
      screen: 'drawer.add-questions',
      screenLabel: 'Add questions',
      numbers: [{ label: 'Cited', value: '8 of 10' }],
      selection: [{ kind: 'question', id: 'q-2', label: 'Can I…' }]
    })
    const merged = currentAiContext()
    expect(merged.screen).toBe('drawer.add-questions')
    expect(merged.screenLabel).toBe('Add questions')
    expect(merged.entities).toHaveLength(1)
    // Same label: the drawer's number wins; its selection replaces the screen's.
    expect(merged.numbers).toEqual([{ label: 'Cited', value: '8 of 10' }])
    expect(merged.selection.map((item) => item.id)).toEqual(['q-2'])
  })

  it('updates and removes a patch, and keeps the same object until something changes', () => {
    setAiBase(BASE)
    const token = registerAiPatch(0, { facts: ['One'] })
    const first = currentAiContext()
    expect(currentAiContext()).toBe(first)
    updateAiPatch(token, 0, { facts: ['Two'] })
    expect(currentAiContext().facts).toEqual(['Two'])
    removeAiPatch(token)
    expect(currentAiContext().facts).toEqual([])
  })

  it('cuts long texts to the privacy limit', () => {
    setAiBase(BASE)
    registerAiPatch(0, { facts: ['x'.repeat(400)] })
    expect(currentAiContext().facts[0]?.length).toBeLessThanOrEqual(300)
  })
})
