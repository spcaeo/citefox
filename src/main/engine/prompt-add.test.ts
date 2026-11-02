import type { CheckProgress } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { insertBuyerProfile, insertPromptSet, insertSnapshot } from '../storage/content-records'
import { addPageMarket, getPage, insertPage, updateStoredPage } from '../storage/pages'
import { insertTopicPrompts, listAllTopicPrompts, type TopicPromptRecord } from '../topics/records'
import {
  buyerPrompt,
  closeSeeds,
  envelope,
  NOW,
  page,
  profile,
  seed,
  snapshot
} from './checks/checks.test-helper'

afterEach(() => {
  closeSeeds()
})

const PAGE = { projectId: 'proj-1', pageId: 'page-1' }
const TOPIC = { projectId: 'proj-1', pageId: 'topic-1' }
const LONG_A = 'How do I text the whole crew when a Saturday shift changes at the last minute?'
const LONG_B = 'What can an office manager use to send appointment reminders by text from Outlook?'

/** A seeded project with two enabled prompts on page-1; SerpApi answers from fixtures. */
async function setup(queries: string[] = []): ReturnType<typeof seed> {
  return seed({
    progress: [] as CheckProgress[],
    secondPrompt: true,
    http(request) {
      const url = new URL(request.url)
      if (url.searchParams.get('engine') === 'google') queries.push(url.searchParams.get('q') ?? '')
      return url.searchParams.get('engine') === 'google_ai_overview'
        ? envelope('google-ai-overview.json')
        : envelope('google-page-token.json')
    }
  })
}

/** A topic with one question, written as `topics:start` writes one. */
function addTopic(db: Awaited<ReturnType<typeof seed>>['projectDb']): void {
  insertPage(db, {
    ...page(),
    id: 'topic-1',
    url: null,
    kind: 'topic',
    title: 'Replacing a carrier email-to-text gateway',
    label: 'Replacing a carrier gateway'
  })
  addPageMarket(db, { pageId: 'topic-1', marketId: 'mkt-us', addedAt: NOW, baselineRunId: null })
  insertSnapshot(db, { ...snapshot(), id: 'snap-t', pageId: 'topic-1' })
  insertBuyerProfile(db, { ...profile(), id: 'icp-t', pageId: 'topic-1', snapshotId: 'snap-t' })
  insertPromptSet(
    db,
    {
      id: 'pset-t',
      pageId: 'topic-1',
      version: 1,
      savedAt: NOW,
      icpId: 'icp-t',
      templateId: null,
      templateName: null,
      templateHash: null,
      templateUpdatedAt: null,
      prompts: [
        {
          ...buyerPrompt('prompt-t1', 'att email to text gateway replacement', true),
          label: 'att email to text gateway replacement'
        }
      ]
    },
    ['TextBolt']
  )
  const row: TopicPromptRecord = {
    promptId: 'prompt-t1',
    pageId: 'topic-1',
    stableKey: 'tp-a',
    kind: 'question',
    stage: 'problem',
    source: 'claude',
    sourceNote: null,
    kwGroup: null,
    kwGroupKind: null,
    intent: null,
    funnel: null,
    pageType: null,
    targetPageId: 'page-1',
    targetUrl: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
    matchConfidence: 100,
    matchReason: 'You picked this page.',
    matchSetBy: 'user',
    matchConfirmed: true
  }
  insertTopicPrompts(db, [row])
}

describe('prompts:addQuestions', () => {
  test('saves the new questions at once, skips repeats, and checks only them on request', async () => {
    const queries: string[] = []
    const { handlers } = await setup(queries)
    const added = await handlers['prompts:addQuestions']({
      ...PAGE,
      questions: [
        { text: `  ${LONG_A}  ` },
        { text: 'how do i ALERT the crew' },
        { text: LONG_B, intentStage: 'solution', source: 'trigger_event', mappedElement: 'FAQ' },
        { text: `${LONG_A.toUpperCase()}!!` },
        // The same question with a year added and an article dropped: merged, not added.
        { text: `${LONG_B.replace('an office', 'office')} (2026)` },
        { text: '   ' }
      ]
    })
    expect(added.version).toBe(2)
    expect(added.promptIds).toHaveLength(2)
    expect(added.skipped).toEqual([
      'how do i ALERT the crew',
      `${LONG_A.toUpperCase()}!!`,
      `${LONG_B.replace('an office', 'office')} (2026)`
    ])

    // Live without a Save: the active set is the new version, not a draft.
    const set = await handlers['prompts:list'](PAGE)
    expect(set.dirty).toBe(false)
    expect(set.version).toBe(2)
    expect(set.prompts.map((prompt) => prompt.variants[0]?.text)).toEqual([
      'How do I alert the crew?',
      'How do I reach the night shift?',
      LONG_A,
      LONG_B
    ])
    expect(set.prompts.slice(2).map((prompt) => prompt.id)).toEqual(added.promptIds)
    expect(set.prompts[2]).toMatchObject({
      source: 'written_by_user',
      intentStage: 'unset',
      mappedElement: 'Not mapped yet',
      enabled: true,
      position: 3
    })
    expect(set.prompts[3]).toMatchObject({
      source: 'trigger_event',
      intentStage: 'solution',
      mappedElement: 'FAQ'
    })
    // Earlier prompts keep their history.
    const versions = await handlers['prompts:versions']({
      ...PAGE,
      promptId: set.prompts[0]?.id ?? ''
    })
    expect(versions.steps.map((step) => step.promptId)).toEqual([set.prompts[0]?.id, 'prompt-1'])

    // "Add and check now" checks just the new questions.
    const job = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: added.promptIds
    })
    expect(job.status).toBe('finished')
    expect(queries.sort()).toEqual([LONG_A, LONG_B].sort())
  })

  test('refuses what the Prompts tab refuses, untracked pages, and open drafts', async () => {
    const { handlers, projectDb } = await setup()
    const add = (text: string): ReturnType<(typeof handlers)['prompts:addQuestions']> =>
      handlers['prompts:addQuestions']({ ...PAGE, questions: [{ text }] })
    await expect(add('crew text alerts')).rejects.toThrow(/at least 8 words.*"crew text alerts"/)
    await expect(add(`Which TextBolt plan ${LONG_A}`)).rejects.toThrow(/brand name "TextBolt"/)
    await expect(add('How do I alert the crew?')).rejects.toThrow(/already tracked here/)
    await expect(
      (handlers['prompts:addQuestions'] as (value: unknown) => Promise<unknown>)({
        ...PAGE,
        questions: []
      })
    ).rejects.toThrow('prompts:addQuestions: Invalid request')
    expect((await handlers['prompts:list'](PAGE)).version).toBe(1)

    await handlers['prompts:edit']({ ...PAGE, promptId: 'prompt-2', label: 'Night shift' })
    await expect(add(LONG_A)).rejects.toThrow(/unsaved prompt edits on its Prompts tab/)
    await handlers['prompts:discard'](PAGE)

    updateStoredPage(projectDb, 'page-1', 'proj-1', { status: 'not_tracked' })
    await expect(add(LONG_A)).rejects.toThrow(/Track this page first/)
  })

  test('a topic takes short questions and keeps every question’s topic facts', async () => {
    const { handlers, projectDb } = await setup()
    addTopic(projectDb)
    const rules = await handlers['prompts:textRules'](TOPIC)
    expect(rules).toMatchObject({ kind: 'question', minWords: 1, maxWords: 32 })
    expect((await handlers['prompts:textRules'](PAGE)).kind).toBe('buyer_prompt')

    const added = await handlers['prompts:addQuestions']({
      ...TOPIC,
      questions: [
        { text: 'what replaced the verizon vtext gateway' },
        { text: 'ATT email-to-text gateway replacement?' },
        { text: 'email to text stopped working what now', source: 'trigger_event' }
      ]
    })
    expect(added.promptIds).toHaveLength(2)
    expect(added.skipped).toEqual(['ATT email-to-text gateway replacement?'])
    const set = await handlers['prompts:list'](TOPIC)
    expect(set.prompts.map((prompt) => prompt.label)).toEqual([
      'att email to text gateway replacement',
      'what replaced the verizon vtext gateway',
      'email to text stopped working what now'
    ])
    const rows = new Map(
      listAllTopicPrompts(projectDb, 'topic-1').map((row) => [row.promptId, row])
    )
    const carried = rows.get(set.prompts[0]?.id ?? '')
    expect(carried).toMatchObject({ stableKey: 'tp-a', matchSetBy: 'user', stage: 'problem' })
    expect(rows.get(added.promptIds[0] ?? '')).toMatchObject({
      kind: 'question',
      source: 'user',
      stage: null,
      targetPageId: null
    })
    expect(rows.get(added.promptIds[1] ?? '')?.source).toBe('claude')
    expect(getPage(projectDb, 'topic-1', 'proj-1')?.promptCount).toBe(3)
  })
})

describe('prompts:addTargets', () => {
  test('lists pages then topics with their questions, markets, schedule and searches left', async () => {
    const { handlers, projectDb } = await setup()
    addTopic(projectDb)
    insertPage(projectDb, {
      ...page(),
      id: 'page-3',
      url: 'https://textbolt.com/pricing/',
      label: null,
      title: 'Pricing',
      status: 'not_tracked'
    })
    insertPage(projectDb, {
      ...page(),
      id: 'page-4',
      url: 'https://textbolt.com/old/',
      status: 'removed'
    })
    const targets = await handlers['prompts:addTargets']({ projectId: 'proj-1' })
    expect(targets.markets.map((market) => market.id)).toEqual(['mkt-us'])
    expect(
      targets.targets.map((target) => [target.id, target.kind, target.name, target.status])
    ).toEqual([
      ['page-1', 'page', 'Alerts', 'tracked'],
      ['page-3', 'page', 'Pricing', 'not_tracked'],
      ['topic-1', 'topic', 'Replacing a carrier email-to-text gateway', 'tracked']
    ])
    expect(targets.targets[0]).toMatchObject({
      questions: 2,
      keywords: 0,
      samples: 1,
      marketIds: ['mkt-us']
    })
    expect(targets.targets[0]?.nextCheckAt).toEqual(expect.any(String))
    expect(targets.targets[1]?.nextCheckAt).toBeNull()
    expect(targets.targets[2]).toMatchObject({ url: null, questions: 1, keywords: 0 })
    expect(targets.searchesLeft === null || typeof targets.searchesLeft === 'number').toBe(true)
  })
})
