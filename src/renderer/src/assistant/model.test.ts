// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { AssistantAction, AssistantAnswer } from '@shared/ipc'
import { resetDrawersForTests } from '../shell/drawers'
import { askRedirectHash, askScopeFromHash } from './askLinks'
import type { AiContext } from './context/types'
import { aboutEntity } from './drawer/model'
import { aboutParam, clearPendingAsk, openAsk, parseAbout, peekPendingAsk } from './openAsk'
import { toAssistantContext } from './request'
import { actionCost, actionVerb } from './runAction'
import { basedOnText, contextChips, sourceHref } from './words'

afterEach(() => {
  clearPendingAsk()
  resetDrawersForTests()
  window.location.hash = ''
})

const CONTEXT: AiContext = {
  screen: 'prompt',
  screenLabel: 'Question',
  route: '#/pages/page-1/prompt/prompt-1',
  crumbs: ['TextBolt', 'Alerts', 'Question'],
  projectId: 'proj-1',
  projectName: 'TextBolt',
  pageId: 'page-1',
  topicId: null,
  promptId: 'prompt-1',
  marketId: 'mkt-us',
  runId: null,
  entities: [
    { kind: 'page', id: 'page-1', label: 'Alerts' },
    { kind: 'question', id: 'prompt-1', label: 'How do I alert the crew?' }
  ],
  selection: [],
  filters: { market: 'US · EN' },
  numbers: [{ label: 'Position', value: '3' }],
  facts: [],
  capabilities: ['draft-fix']
}

describe('openAsk and the ask URL', () => {
  it('opens the drawer with the question and an opaque subject on the URL', () => {
    openAsk({
      question: 'Explain this number',
      about: { kind: 'kpi', label: 'Cited' },
      send: true
    })
    const hash = decodeURIComponent(window.location.hash.replace(/\+/g, ' '))
    expect(hash).toContain('drawer=ask')
    expect(hash).toContain('ask.q=Explain this number')
    expect(hash).toContain('ask.about=kpi')
    expect(hash).not.toContain('Cited')
    expect(peekPendingAsk('Explain this number')).toMatchObject({ send: true })
    expect(peekPendingAsk('Another question')).toBeNull()
  })

  it('keeps labels off the URL and reads back only known kinds and safe ids', () => {
    expect(aboutParam({ kind: 'question', id: 'prompt-1', label: 'Secret text' })).toBe(
      'question:prompt-1'
    )
    expect(parseAbout('question:prompt-1')).toEqual({ kind: 'question', id: 'prompt-1' })
    expect(parseAbout('email:a@b.c')).toBeNull()
    expect(parseAbout('page:../../etc')).toBeNull()
  })

  it('names the subject from what the screen registered', () => {
    expect(aboutEntity('question:prompt-1', CONTEXT)?.label).toBe('How do I alert the crew?')
    expect(aboutEntity('kpi', CONTEXT)?.label).toBe('Question')
  })

  it('reads page, market and question from an old Ask link', () => {
    expect(askScopeFromHash('#/ask?page=topic-1&market=mkt-us&q=Why%20not%20cited%3F')).toEqual({
      pageId: 'topic-1',
      marketId: 'mkt-us',
      question: 'Why not cited?'
    })
    expect(askScopeFromHash('#/p/proj-1/ask?page=topic-1')).toMatchObject({ pageId: 'topic-1' })
    const none = { pageId: null, marketId: null, question: '' }
    expect(askScopeFromHash('#/pages?page=topic-1')).toEqual(none)
    expect(askScopeFromHash('#/ask')).toEqual(none)
    expect(askScopeFromHash('#/ask?page=&market=%20&q=')).toEqual(none)
    expect(askScopeFromHash(`#/ask?q=${'a'.repeat(900)}`).question).toHaveLength(500)
  })

  it('sends old #/ask links to their screen with the drawer open', () => {
    const hash = decodeURIComponent(askRedirectHash('#/ask?page=page-1&market=mkt-uk&q=Why'))
    expect(hash).toMatch(/^#\/pages\/page-1\/results\?/)
    expect(hash).toContain('market=mkt-uk')
    expect(hash).toContain('drawer=ask')
    expect(hash).toContain('ask.q=Why')
    expect(decodeURIComponent(askRedirectHash('#/ask'))).toMatch(/^#\/overview\?drawer=ask$/)
  })
})

describe('the request and the answer copy', () => {
  it('sends the context in the checked shape, with the subject', () => {
    const request = toAssistantContext(CONTEXT, { kind: 'question', id: 'prompt-1', label: 'How?' })
    expect(request).toMatchObject({
      screen: 'prompt',
      pageId: 'page-1',
      promptId: 'prompt-1',
      about: { kind: 'question', id: 'prompt-1', label: 'How?', detail: null },
      capabilities: ['draft-fix']
    })
    expect(request.entities[0]).toEqual({
      kind: 'page',
      id: 'page-1',
      label: 'Alerts',
      detail: null
    })
  })

  it('drops ids that are not opaque ids', () => {
    const request = toAssistantContext({ ...CONTEXT, pageId: 'has spaces', screen: 'Bad Screen' })
    expect(request.pageId).toBeNull()
    expect(request.screen).toBe('screen')
  })

  it('shows what it reads as chips', () => {
    expect(contextChips(CONTEXT)).toEqual([
      'Question',
      'Page: Alerts',
      'Question: How do I alert the crew?',
      'Market: US · EN',
      '1 number on screen'
    ])
  })

  it('links a source to the stored check, the topic or the page read', () => {
    const base = { label: 'x', marketId: 'mkt-us', runId: null, drill: null, domain: null }
    expect(sourceHref({ ...base, kind: 'check', pageId: 'page-1', promptId: 'prompt-1' })).toBe(
      '#/pages/page-1/prompt/prompt-1?market=mkt-us'
    )
    expect(
      decodeURIComponent(
        sourceHref({ ...base, kind: 'topic', pageId: 'topic-1', promptId: 'prompt-1' }) ?? ''
      )
    ).toContain('#/topics/topic-1?market=mkt-us&filter=target:prompt-1')
    expect(sourceHref({ ...base, kind: 'page-read', pageId: 'page-1', promptId: null })).toBe(
      '#/pages/page-1/read'
    )
  })

  it('says what an answer is based on and that it never searched', () => {
    const answer = {
      basedOn: { checks: 4, markets: 2, checkedThrough: '2026-10-19T12:00:00Z' },
      label: { connectionText: 'CiteFox AI · on your plan' }
    } as AssistantAnswer
    expect(basedOnText(answer)).toBe(
      'Based on 4 stored checks in 2 markets · checked through Oct 19 · CiteFox AI · on your plan · no searches'
    )
  })

  it('says what an action costs before it runs', () => {
    const action: AssistantAction = {
      id: 'a',
      kind: 'start-check',
      title: 'Check again',
      detail: 'Uses 2 searches',
      pageId: 'page-1',
      topicId: null,
      promptIds: ['p1', 'p2'],
      marketIds: ['m1'],
      questions: [],
      name: null,
      targetPageId: null,
      searches: 2,
      drill: null
    }
    expect(actionVerb(action)).toBe('Check now')
    expect(actionCost(action)).toBe('Uses 2 searches of your search key.')
    expect(actionVerb({ ...action, kind: 'add-questions', questions: ['a', 'b', 'c'] })).toBe(
      'Add 3 questions'
    )
  })
})
