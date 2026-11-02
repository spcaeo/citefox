import { describe, expect, test } from 'vitest'
import { emptyGuideProgress, type GuideProgress } from '@shared/guide'
import { STEPS, stepById, stepsOf } from '../constants'
import type { GuideFacts, GuideStep } from '../types'
import {
  applyPatch,
  finishStep,
  guideCounts,
  lessonCounts,
  lessonFor,
  lessonOrder,
  nextStep,
  onRoute,
  previousStep,
  followingStep,
  stepStatus,
  stepWhy
} from './engine'
import { NO_FACTS } from './facts'

const FACTS: GuideFacts = {
  hasResults: true,
  topic: { id: 't1', name: 'Text alerts', marketId: 'mkt-us', targetPage: null },
  prompt: { id: 'q6', label: 'Q6' },
  citesOwn: 6,
  noPage: { id: 'q2', label: 'Q2' },
  rival: null,
  pageFix: { improve: null, owner: null, create: null },
  loggedFix: null,
  topics: 1,
  competitors: 0
}

const NOW = '2026-10-29T10:00:00.000Z'

function progress(patch: Partial<GuideProgress> = {}): GuideProgress {
  return { ...emptyGuideProgress('p1'), ...patch }
}

function step(id: string): GuideStep {
  const found = stepById(id)
  if (!found) throw new Error(`no step ${id}`)
  return found
}

describe('stepStatus', () => {
  test('a real save done before the guide got there ticks the step (out of order)', () => {
    const saved = progress({ signals: ['competitor-saved'] })
    expect(stepStatus(step('mark-competitor'), saved, FACTS)).toBe('done')
    expect(stepStatus(step('set-target-page'), saved, FACTS)).toBe('todo')
  })

  test('the data alone can show a step done: a topic that already has a target page', () => {
    const facts = {
      ...FACTS,
      topic: { ...FACTS.topic!, targetPage: 'https://textbolt.com/alerts' }
    }
    expect(stepStatus(step('set-target-page'), progress(), facts)).toBe('done')
  })

  test('skipped, and nothing to show when the project has no checked topic', () => {
    expect(stepStatus(step('summary'), progress({ steps: { summary: 'skipped' } }), FACTS)).toBe(
      'skipped'
    )
    expect(stepStatus(step('topic-kpis'), progress(), NO_FACTS)).toBe('unavailable')
    // Screens that do not need a topic still teach.
    expect(stepStatus(step('competitors'), progress(), NO_FACTS)).toBe('todo')
  })

  test('counts done steps over every step', () => {
    const saved = progress({ steps: { summary: 'done' }, signals: ['check-started'] })
    expect(guideCounts(saved, FACTS)).toEqual({ done: 2, total: STEPS.length })
  })
})

describe('smart suggestions', () => {
  test('reads the data: own site cited with no target page', () => {
    expect(stepWhy(step('set-target-page'), progress(), FACTS)).toBe(
      '6 questions already cite your site, but this topic has no target page yet.'
    )
    expect(stepWhy(step('fix-list'), progress(), FACTS)).toBe(
      'Q2 has no page that answers it yet. What to fix shows the page to write.'
    )
  })

  test('the Summary comes first, then lessons the data gives a reason for, finished ones last', () => {
    const facts = {
      ...FACTS,
      noPage: null,
      rival: { domain: 'twilio.com', answers: 4, promptId: 'q4' }
    }
    // A target page to set (topic), a rival to mark (question page, Competitors).
    expect(lessonOrder(progress(), facts).slice(0, 5)).toEqual([
      'summary',
      'topic',
      'prompt',
      'competitors',
      'fixes'
    ])
    const noTarget = { ...facts, citesOwn: 0 }
    expect(lessonOrder(progress(), noTarget).slice(0, 4)).toEqual([
      'summary',
      'prompt',
      'competitors',
      'topic'
    ])
    expect(nextStep(progress(), noTarget)?.id).toBe('summary')
    const summaryDone = progress({
      steps: Object.fromEntries(stepsOf('summary').map((item) => [item.id, 'done' as const]))
    })
    const order = lessonOrder(summaryDone, noTarget)
    expect(order.indexOf('summary')).toBeGreaterThan(order.indexOf('topics'))
    expect(nextStep(summaryDone, noTarget)?.id).toBe('ai-answer')
  })

  test('next step inside a lesson skips what is done, skipped or has nothing to show', () => {
    const saved = progress({ steps: { 'topic-kpis': 'done', 'topic-todo': 'skipped' } })
    expect(nextStep(saved, FACTS, { lesson: 'topic' })?.id).toBe('set-target-page')
    expect(nextStep(saved, FACTS, { lesson: 'topic', after: 'set-target-page' })?.id).toBe(
      'check-now'
    )
    expect(nextStep(progress(), NO_FACTS, { lesson: 'topic' })).toBeNull()
    expect(previousStep('open-question', FACTS)?.id).toBe('check-now')
    expect(previousStep('topic-kpis', FACTS)).toBeNull()
    // Next after Back walks the lesson in order, done steps included.
    expect(followingStep('topic-todo', FACTS)?.id).toBe('set-target-page')
    expect(followingStep('open-question', FACTS)).toBeNull()
  })
})

describe('one lesson per screen', () => {
  test('the open route picks the lesson: a screen, or its part', () => {
    expect(lessonFor('summary', '#/overview')).toBe('summary')
    expect(lessonFor('fixes', '#/fixes')).toBe('fixes')
    expect(lessonFor('fixes', '#/fixes?pf=pf1&pft=edits')).toBe('fix-brief')
    expect(lessonFor('fixes', '#/fixes?view=changes')).toBe('did-it-work')
    expect(lessonFor('fixes', '#/fixes?view=changes&drawer=page-fix&pfx.id=pf1')).toBe('fix-brief')
    expect(lessonFor('reports', '#/reports?layout=reports')).toBe('reports')
    expect(lessonFor('reports', '#/reports?report=pitch&section=verdict')).toBe('report')
    expect(lessonFor('settings', '#/settings?tab=general')).toBe('settings')
    expect(lessonFor('settings', '#/settings?tab=reports')).toBe('branding')
    expect(lessonFor(null, '#/start')).toBeNull()
  })

  test("a lesson's own count: done steps over its steps", () => {
    const saved = progress({ steps: { 'topic-kpis': 'done' }, signals: ['check-started'] })
    expect(lessonCounts('topic', saved, FACTS)).toEqual({ done: 2, total: 5 })
    expect(lessonCounts('summary', saved, FACTS)).toEqual({ done: 0, total: 4 })
  })
})

describe('onRoute: following, completing and pausing the running step', () => {
  const running = progress({ current: 'set-target-page', steps: { 'set-target-page': 'shown' } })

  test('on the step screen it remembers the exact route (topic, tab and drawer)', () => {
    expect(
      onRoute({
        progress: running,
        facts: FACTS,
        screen: 'topic',
        hash: '#/topics/t1?tab=stage&drawer=topic-page',
        signals: [],
        lastRoute: null
      })
    ).toEqual({ kind: 'on-step', route: '#/topics/t1?tab=stage&drawer=topic-page' })
  })

  test('walking away half-way pauses quietly with the last route the step was on', () => {
    expect(
      onRoute({
        progress: running,
        facts: FACTS,
        screen: 'competitors',
        hash: '#/competitors',
        signals: [],
        lastRoute: '#/topics/t1?tab=stage&drawer=topic-page'
      })
    ).toEqual({
      kind: 'pause',
      stepId: 'set-target-page',
      route: '#/topics/t1?tab=stage&drawer=topic-page'
    })
    // Never seen on screen: the step's own route.
    expect(
      onRoute({
        progress: running,
        facts: FACTS,
        screen: 'fixes',
        hash: '#/fixes',
        signals: [],
        lastRoute: null
      })
    ).toMatchObject({ kind: 'pause', route: '#/topics/t1?market=mkt-us' })
  })

  test('a route that is the step itself completes it instead of pausing', () => {
    const opening = progress({ current: 'open-question' })
    expect(
      onRoute({
        progress: opening,
        facts: FACTS,
        screen: 'prompt',
        hash: '#/pages/t1/prompt/q6',
        signals: ['prompt-opened'],
        lastRoute: '#/topics/t1'
      })
    ).toEqual({ kind: 'done', stepId: 'open-question' })
  })

  test('a paused or finished guide ignores routes', () => {
    const paused = {
      ...running,
      paused: { stepId: 'set-target-page', route: '#/topics/t1', at: NOW }
    }
    const input = {
      facts: FACTS,
      screen: 'fixes' as const,
      hash: '#/fixes',
      signals: [],
      lastRoute: null
    }
    expect(onRoute({ ...input, progress: paused })).toEqual({ kind: 'idle' })
    expect(onRoute({ ...input, progress: progress() })).toEqual({ kind: 'idle' })
  })
})

describe('finishing steps and saving', () => {
  test('Got it saves the step and moves to the next step of the lesson', () => {
    const { patch, next } = finishStep(
      progress({ current: 'topic-kpis' }),
      FACTS,
      'topic-kpis',
      'done'
    )
    expect(next?.id).toBe('topic-todo')
    expect(patch).toEqual({
      steps: { 'topic-kpis': 'done', 'topic-todo': 'shown' },
      current: 'topic-todo',
      paused: null
    })
  })

  test('the last step of a lesson ends it', () => {
    const { patch, next } = finishStep(progress(), FACTS, 'open-question', 'skipped')
    expect(next).toBeNull()
    expect(patch).toEqual({ steps: { 'open-question': 'skipped' }, current: null, paused: null })
  })

  test('applyPatch mirrors what main saves', () => {
    const before = progress({ explainersSeen: ['fixes'], steps: { summary: 'shown' } })
    const after = applyPatch(
      before,
      {
        steps: { summary: null, 'topic-kpis': 'done' },
        paused: { stepId: 'topic-kpis', route: '#/topics/t1' },
        explainerSeen: 'competitors',
        tipsOff: true
      },
      NOW
    )
    expect(after.steps).toEqual({ 'topic-kpis': 'done' })
    expect(after.paused).toEqual({ stepId: 'topic-kpis', route: '#/topics/t1', at: NOW })
    expect(after.explainersSeen).toEqual(['competitors', 'fixes'])
    expect(after.tipsOff).toBe(true)
    expect(applyPatch(after, { explainersReset: true }, NOW).explainersSeen).toEqual([])
  })
})
