import { describe, expect, test } from 'vitest'
import type {
  SiteStartPage,
  StartEdit,
  StartEditRecord,
  StartKnown,
  StartQuestion,
  StartRival
} from './ipc'
import {
  activeEdits,
  applyBuyerEdits,
  applyKnownEdits,
  applyPageEdits,
  applyQuestionEdits,
  applyRivalEdits,
  summarizeEdit
} from './start-edits'

function record(edit: StartEdit, id: string, undone = false): StartEditRecord {
  return {
    id,
    edit,
    summary: summarizeEdit(edit),
    at: '2026-10-22T10:00:00.000Z',
    undoneAt: undone ? '2026-10-22T10:01:00.000Z' : null,
    parentId: null,
    system: false
  }
}

const RIVALS: StartRival[] = [
  { name: 'SimpleTexting', domain: 'simpletexting.com', kind: 'competitor', reason: '' },
  { name: 'PagerDuty', domain: null, kind: 'competitor', reason: '' },
  { name: 'AT&T gateway', domain: null, kind: 'switch_from', reason: '' },
  { name: 'WIN-911', domain: null, kind: 'competitor', reason: '' }
]

function page(path: string): SiteStartPage {
  return {
    url: `https://textbolt.com${path}`,
    path,
    title: null,
    pageId: null,
    kind: 'other',
    section: 'Top-level pages',
    reason: '',
    evidence: '',
    alreadyTracked: false,
    questionCount: 0
  }
}

describe('summaries', () => {
  test('plain words', () => {
    expect(summarizeEdit({ kind: 'rival', op: 'remove', name: 'PagerDuty' })).toBe(
      'Removed PagerDuty'
    )
    expect(
      summarizeEdit({ kind: 'rival', op: 'move', name: 'WIN-911', rivalKind: 'partner' })
    ).toBe('Moved WIN-911 to Partners')
    expect(summarizeEdit({ kind: 'page', op: 'add', url: 'https://textbolt.com/x/' })).toBe(
      'Added page /x/'
    )
  })
})

describe('rivals', () => {
  test('remove, rename, move and add in order; undone edits do nothing', () => {
    const records = [
      record({ kind: 'rival', op: 'remove', name: 'pagerduty' }, 'e1'),
      record({ kind: 'rival', op: 'move', name: 'WIN-911', rivalKind: 'partner' }, 'e2'),
      record({ kind: 'rival', op: 'rename', name: 'SimpleTexting', to: 'Simple Texting' }, 'e3'),
      record({ kind: 'rival', op: 'add', name: 'Textline', rivalKind: 'competitor' }, 'e4'),
      record({ kind: 'rival', op: 'remove', name: 'AT&T gateway' }, 'e5', true)
    ]
    const out = applyRivalEdits(RIVALS, activeEdits(records))
    expect(out.map((rival) => `${rival.name}:${rival.kind}`)).toEqual([
      'Simple Texting:competitor',
      'AT&T gateway:switch_from',
      'WIN-911:partner',
      'Textline:competitor'
    ])
  })
})

describe('buyers', () => {
  test('segments and triggers edit in place; who is replaced', () => {
    const buyers = applyBuyerEdits(
      { who: 'Ops leads', segments: ['Clinics', 'MSPs'], triggers: ['Gateway stopped'] },
      [
        { kind: 'segment', op: 'remove', text: 'msps' },
        { kind: 'segment', op: 'add', text: 'Schools' },
        { kind: 'trigger', op: 'rename', text: 'Gateway stopped', to: 'Carrier gateway stopped' },
        { kind: 'who', op: 'set', text: 'Office managers' }
      ]
    )
    expect(buyers).toEqual({
      who: 'Office managers',
      segments: ['Clinics', 'Schools'],
      triggers: ['Carrier gateway stopped']
    })
  })
})

describe('pages and questions', () => {
  test('removed pages drop out and added pages join once', () => {
    const added = [page('/new/')]
    const out = applyPageEdits(
      [page('/pricing/'), page('/compare/a/')],
      [
        { kind: 'page', op: 'remove', url: 'https://textbolt.com/compare/a' },
        { kind: 'page', op: 'add', url: 'https://textbolt.com/new/' },
        { kind: 'page', op: 'add', url: 'https://textbolt.com/new/' }
      ],
      added
    )
    expect(out.map((entry) => entry.path)).toEqual(['/pricing/', '/new/'])
  })

  test('questions: drop, edit and add', () => {
    const questions: StartQuestion[] = [
      { id: 'q1', text: 'One?', stage: 'problem', targetUrl: null },
      { id: 'q2', text: 'Two?', stage: 'options', targetUrl: null }
    ]
    const out = applyQuestionEdits(questions, [
      record({ kind: 'question', op: 'remove', id: 'q1' }, 'e1'),
      record({ kind: 'question', op: 'edit', id: 'q2', text: 'Two, better?' }, 'e2'),
      record({ kind: 'question', op: 'add', text: 'Three?' }, 'e3')
    ])
    expect(out.map((question) => `${question.id}:${question.text}`)).toEqual([
      'q2:Two, better?',
      'added:e3:Three?'
    ])
  })

  test('the live panel shows edits as they are made', () => {
    const known: StartKnown = {
      pageCount: 142,
      sections: [],
      rivals: RIVALS,
      buyers: null,
      picked: 2,
      pickedPages: [
        { url: 'https://textbolt.com/pricing/', path: '/pricing/' },
        { url: 'https://textbolt.com/compare/a/', path: '/compare/a/' }
      ],
      questions: [],
      upNext: []
    }
    const out = applyKnownEdits(
      known,
      [
        record({ kind: 'rival', op: 'remove', name: 'PagerDuty' }, 'e1'),
        record({ kind: 'page', op: 'remove', url: 'https://textbolt.com/compare/a/' }, 'e2'),
        record({ kind: 'page', op: 'add', url: 'https://textbolt.com/new/' }, 'e3')
      ],
      [page('/new/')]
    )
    expect(out.rivals.map((rival) => rival.name)).not.toContain('PagerDuty')
    expect(out.pickedPages.map((entry) => entry.path)).toEqual(['/pricing/', '/new/'])
    expect(out.picked).toBe(2)
  })
})
