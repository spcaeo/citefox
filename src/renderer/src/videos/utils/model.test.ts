import { describe, expect, test } from 'vitest'
import type { CommunityAio, VideoBrief, VideoIdea } from '@shared/domain'
import { aioDrill, aioDrillItems, ideaPrompts, marketKeys } from './drill'
import {
  boardColumns,
  briefText,
  checklistLabel,
  CHECKLIST,
  defaultFlowStep,
  flowSteps,
  isFlowStep,
  kpiPercent,
  ofAnswers,
  plainError,
  promptsLabel,
  sortIdeas,
  statusLabel,
  stepLabel,
  teleprompterLine,
  toggleChecklist
} from './model'

function idea(partial: Partial<VideoIdea>): VideoIdea {
  return {
    id: 'vi-1',
    saved: false,
    step: 'idea',
    question: 'How do I alert the crew?',
    pageId: 'page-1',
    pageLabel: 'Alerts',
    pageUrl: 'https://textbolt.com/a',
    promptIds: ['p1'],
    promptPositions: [1],
    evidence: 1,
    evidenceKeys: ['r|p1'],
    evidencePages: 1,
    marketIds: ['us'],
    videos: [],
    competitorVideo: true,
    deadline: null,
    brief: null,
    checklist: [],
    sentToFoxcueAt: null,
    videoUrl: null,
    trackingStartedAt: null,
    tracking: null,
    ...partial
  }
}

const BRIEF: VideoBrief = {
  title: 'Alert your crew',
  hook: 'Nobody reads email on site.',
  chapters: [{ at: '00:00', name: 'The problem' }],
  script: [
    { at: '00:00', text: 'Intro.', source: null },
    { at: '00:20', text: 'Claim.', source: 1 }
  ],
  sources: [{ n: 1, section: 'Text alerts', onPage: false }],
  description: 'Desc',
  thumbnailText: 'Texts',
  tags: ['a', 'b'],
  scenes: [],
  writtenAt: '2026-10-20T00:00:00Z',
  templateHash: 'x'
}

describe('videos model', () => {
  test('words each result as every screen does', () => {
    expect(statusLabel('page_cited')).toBe('Right page')
    expect(statusLabel('other_own_page')).toBe('Your other page')
    expect(statusLabel('not_cited')).toBe('Not cited')
    expect(statusLabel('no_aio')).toBe('No AI Overview')
  })

  test('board columns hold every idea once, in flow order', () => {
    const ideas = [
      idea({ id: 'a', step: 'idea' }),
      idea({ id: 'b', step: 'tracking' }),
      idea({ id: 'c', step: 'brief' })
    ]
    const columns = boardColumns(ideas)
    expect(columns.map((column) => column.label)).toEqual([
      'Idea',
      'Brief',
      'Sent',
      'Published',
      'Tracking'
    ])
    expect(columns.map((column) => column.ideas.length)).toEqual([1, 1, 0, 0, 1])
    expect(columns.reduce((sum, column) => sum + column.ideas.length, 0)).toBe(ideas.length)
  })

  test('ideas rank by evidence, then deadline, then question', () => {
    const sorted = sortIdeas([
      idea({ id: 'low', evidence: 1, question: 'A' }),
      idea({ id: 'dead', evidence: 2, question: 'Z', deadline: '2027-03-31' }),
      idea({ id: 'high', evidence: 2, question: 'B' })
    ])
    expect(sorted.map((item) => item.id)).toEqual(['dead', 'high', 'low'])
  })

  test('KPI percent rounds and guards zero', () => {
    expect(kpiPercent(3, 4)).toBe('75%')
    expect(kpiPercent(1, 3)).toBe('33%')
    expect(kpiPercent(0, 0)).toBe('—')
  })

  test('step and checklist labels', () => {
    expect(stepLabel('sent')).toBe('Sent to FoxCue')
    expect(stepLabel('idea')).toBe('Suggested')
    expect(CHECKLIST).toHaveLength(7)
    expect(CHECKLIST.map(checklistLabel)).toContain('The page has VideoObject structured data')
    expect(toggleChecklist(['captions'], 'title_wording', true)).toEqual([
      'title_wording',
      'captions'
    ])
    expect(toggleChecklist(['captions', 'chapters'], 'captions', false)).toEqual(['chapters'])
  })

  test('teleprompter moves one line and stays inside the script', () => {
    expect(teleprompterLine(0, 3, 'ArrowDown')).toBe(1)
    expect(teleprompterLine(2, 3, 'ArrowRight')).toBe(2)
    expect(teleprompterLine(0, 3, 'ArrowUp')).toBe(0)
    expect(teleprompterLine(2, 3, 'Home')).toBe(0)
    expect(teleprompterLine(0, 3, 'End')).toBe(2)
    expect(teleprompterLine(1, 3, 'x')).toBeNull()
    expect(teleprompterLine(0, 0, 'ArrowDown')).toBeNull()
  })

  test('flow steps mark what is done', () => {
    expect(flowSteps(idea({})).map((step) => step.done)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false
    ])
    expect(flowSteps(idea({})).map((step) => step.label)).toEqual([
      'Question',
      'Brief',
      'Storyboard',
      'Make',
      'Publish',
      'Track'
    ])
    const done = flowSteps(
      idea({ brief: BRIEF, sentToFoxcueAt: '2026-10-20T00:00:00Z', step: 'tracking' })
    )
    expect(done.every((step) => step.done)).toBe(true)
  })

  test('an idea opens on the question, then on its first step not done', () => {
    expect(defaultFlowStep(idea({}))).toBe('question')
    expect(defaultFlowStep(idea({ brief: BRIEF }))).toBe('make')
    expect(defaultFlowStep(idea({ brief: BRIEF, sentToFoxcueAt: '2026-10-20T00:00:00Z' }))).toBe(
      'publish'
    )
    expect(defaultFlowStep(idea({ brief: BRIEF, step: 'tracking' }))).toBe('track')
    expect(isFlowStep('storyboard')).toBe(true)
    expect(isFlowStep('nope')).toBe(false)
  })

  test('drill rows follow the keys and keep unknown ones, so totals match (NFR-14)', () => {
    const aio = (key: string): CommunityAio => ({
      key,
      runId: 'r',
      pageId: 'page-1',
      pageLabel: 'Alerts',
      marketId: 'us',
      promptId: key,
      promptPosition: 1,
      label: 'L',
      text: 'T',
      status: 'not_cited',
      named: false,
      checkedAt: '2026-10-19T12:00:00Z',
      latest: true
    })
    const rows = aioDrillItems([aio('a'), aio('b')], [], ['b', 'zz', 'a'])
    expect(rows.map((row) => row.id)).toEqual(['b', 'zz', 'a'])
    expect(rows[1]?.target).toBeUndefined()
    expect(rows[0]?.target).toEqual({
      kind: 'prompt',
      pageId: 'page-1',
      promptId: 'b',
      marketId: 'us',
      runId: null
    })
    const old = aioDrillItems([{ ...aio('c'), latest: false }], [], ['c'])
    expect(old[0]?.target).toMatchObject({ runId: 'r' })
    const drill = aioDrill(
      { id: 'yt:x', title: 'X', description: 'd', keys: ['a', 'zz'] },
      [aio('a')],
      []
    )
    expect(drill.items).toHaveLength(2)
    expect(drill.noun).toEqual(['answer', 'answers'])
    expect(marketKeys([aio('a'), { ...aio('b'), marketId: 'uk' }], ['a', 'b', 'zz'], 'uk')).toEqual(
      ['b']
    )
  })

  test('idea questions carry their page, in position order, once each', () => {
    expect(
      ideaPrompts({
        prompts: [
          { promptId: 'p7', pageId: 'page-2', position: 7 },
          { promptId: 'p3', pageId: 'page-1', position: 3 },
          { promptId: 'p3', pageId: 'page-1', position: 3 }
        ]
      }).map((prompt) => prompt.promptId)
    ).toEqual(['p3', 'p7'])
    expect(ideaPrompts({})).toEqual([])
  })

  test('labels and plain errors', () => {
    expect(promptsLabel([5, 2])).toBe('Questions 2, 5')
    expect(promptsLabel([3])).toBe('Question 3')
    expect(ofAnswers(null, null)).toBe('No check before')
    expect(ofAnswers(2, 3)).toBe('2 of 3 answers')
    expect(
      plainError(
        new Error(
          "Error invoking remote method 'videos:track': IpcRequestError: videos:track: That is not a YouTube video URL"
        ),
        'x'
      )
    ).toBe('That is not a YouTube video URL')
    const text = briefText(BRIEF, { question: 'Q?', pageUrl: 'https://textbolt.com/a' })
    expect(text).toContain('Claim. [1]')
    expect(text).toContain('(not on the page yet)')
  })
})
