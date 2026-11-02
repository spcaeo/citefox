import { helpFillSummary } from '@shared/helpfill'
import { HELPFILL_MAX_ROWS, type HelpFillResult } from '@shared/ipc'
import { describe, expect, test } from 'vitest'
import { QUESTIONS_KIND } from './kinds/questions'
import { settleRows } from './merge'
import { readReply } from './reader'
import type { HelpFillContext, HelpFillKindDef } from './types'

const CONTEXT: HelpFillContext = {
  projectId: 'proj-1',
  domain: 'textbolt.com',
  brands: ['TextBolt', 'Text Bolt'],
  target: {
    id: 'page-1',
    kind: 'page',
    name: 'Email to text',
    url: 'https://textbolt.com/email-to-text/'
  },
  blocks: [],
  pagePaths: ['/email-to-text/', '/pricing/'],
  targetQuestions: ['What replaced the AT&T email to text gateway?'],
  projectQuestions: [
    'What replaced the AT&T email to text gateway?',
    'The best email to SMS gateway for IT alerts 2025'
  ],
  promptId: null,
  subject: null
}

function settle(text: string, context: HelpFillContext = CONTEXT): HelpFillResult {
  const read = readReply(text, QUESTIONS_KIND.sections)
  return settleRows(QUESTIONS_KIND, context, read.rows, read.warnings)
}

describe('settleRows', () => {
  test('merges tracked near-duplicates and repeats, sets aside the brand, and counts them', () => {
    const result = settle(`question,stage,page
What replaced AT&T email to text gateways?,Problem,/email-to-text/
Best email to SMS gateways for IT alerts 2026,Options,
How do I send Zabbix alerts by SMS without coding?,Problem,/email-to-text/
how do i send zabbix alerts by sms without coding,Problem,
Is TextBolt cheaper than Twilio for alerts?,Compare,/pricing/
Can a small clinic text patients from Outlook?,Fit,
Do I need 10DLC to text my own staff?,Doubts,`)
    expect(result.counts).toEqual({ read: 7, tracked: 2, repeats: 1, setAside: 1, ready: 3 })
    expect(result.rows.map((row) => row.values)).toEqual([
      {
        question: 'How do I send Zabbix alerts by SMS without coding?',
        stage: 'problem',
        page: '/email-to-text/'
      },
      { question: 'Can a small clinic text patients from Outlook?', stage: 'fit', page: '' },
      { question: 'Do I need 10DLC to text my own staff?', stage: 'doubts', page: '' }
    ])
    expect(result.setAside.map((row) => row.values.question)).toEqual([
      'Is TextBolt cheaper than Twilio for alerts?'
    ])
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(3)
    expect(result.brand).toBe('TextBolt')
    expect(result.noun).toEqual(['question', 'questions'])
    expect(helpFillSummary(result.counts, result.noun, result.brand)).toBe(
      'Read 7 rows. 2 were close to questions you track and were merged. 1 repeated another row and was merged. 1 named TextBolt and was set aside. 3 are ready.'
    )
  })

  test('an unknown stage word is blank, and a row with no question is dropped', () => {
    const result = settle('question,stage\nHow fast do texts arrive?,Awareness\n,Problem\n')
    expect(result.counts.read).toBe(1)
    expect(result.rows[0]?.values).toEqual({
      question: 'How fast do texts arrive?',
      stage: '',
      page: ''
    })
  })

  test('a non-neutral kind keeps rows that name the brand', () => {
    const named: HelpFillKindDef = { ...QUESTIONS_KIND, kind: 'named', neutral: false }
    const read = readReply(
      'question\nIs TextBolt HIPAA compliant?\nWhat does TextBolt cost?',
      named.sections
    )
    const result = settleRows(named, CONTEXT, read.rows)
    expect(result.counts.setAside).toBe(0)
    expect(result.counts.ready).toBe(2)
  })

  test('the "no table" warning goes once rows are found, and stays when none are', () => {
    expect(settle('question\nWhat replaced vtext?\nIs email to SMS reliable?').warnings).toEqual([])
    const empty = settle('No idea, sorry.')
    expect(empty.rows).toEqual([])
    expect(empty.warnings[0]).toMatch(/No table or list/u)
  })

  test(`keeps at most ${HELPFILL_MAX_ROWS} rows`, () => {
    const lines = Array.from(
      { length: HELPFILL_MAX_ROWS + 5 },
      (_, n) => `How do I send alert number ${n} by text?`
    )
    const result = settle(`question\n${lines.join('\n')}`)
    expect(result.rows).toHaveLength(HELPFILL_MAX_ROWS)
    expect(result.warnings).toContain(`Only the first ${HELPFILL_MAX_ROWS} rows were kept.`)
  })
})
