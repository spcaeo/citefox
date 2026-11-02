import { describe, expect, test } from 'vitest'
import type { TopicStage } from '@shared/domain'
import {
  assignBuyers,
  buyersText,
  journeyBuyers,
  overusedSoftware,
  type CappedQuestion
} from './journey-buyers'

const BUYERS = [
  'School facilities lead whose Niagara BAS emails a freeze alarm nobody saw',
  'Security manager at a warehouse whose Milestone XProtect emails camera-offline alarms',
  'Sysadmin at a small plant whose Nagios outage emails went to a dead carrier gateway',
  'Clinic office manager whose Outlook reminders stopped reaching patients',
  'Water utility operator whose WIN-911 alarm emails no longer reach the on-call phone',
  'Property manager whose Honeywell panel emails leak alarms to a shared inbox'
]

const STANDARD: Record<TopicStage, number> = {
  problem: 3,
  options: 3,
  doubts: 3,
  fit: 2,
  compare: 2,
  decide: 2
}

describe('buyer variety (Docs/PROMPT-AUDIT.md, P3)', () => {
  test('the profile’s who points are the buyers; segments fill in when who is short', () => {
    const point = (
      section: 'who' | 'segments',
      text: string
    ): { section: 'who' | 'segments'; text: string } => ({
      section,
      text
    })
    expect(journeyBuyers(BUYERS.map((text) => point('who', text)))).toHaveLength(6)
    expect(
      journeyBuyers([
        point('who', 'Facilities lead.'),
        point('who', 'Sysadmin'),
        point('segments', 'Clinics'),
        point('segments', 'Plants')
      ])
    ).toEqual(['Facilities lead', 'Sysadmin', 'Clinics', 'Plants'])
  })

  test('15 questions over six buyers: no buyer more than three, no repeat within a stage', () => {
    const assigned = assignBuyers(BUYERS, STANDARD)
    const all = Object.values(assigned).flat()
    expect(all).toHaveLength(15)
    for (const buyer of BUYERS) {
      expect(all.filter((item) => item === buyer).length).toBeLessThanOrEqual(3)
    }
    for (const list of Object.values(assigned)) expect(new Set(list).size).toBe(list.length)
    expect(buyersText(assigned.fit)).toBe(`Question 1: ${BUYERS[3]}.\nQuestion 2: ${BUYERS[4]}.`)
  })

  test('software named in more than three questions: the later ones go over', () => {
    const question = (
      stage: TopicStage,
      text: string,
      namedTool: string | null
    ): CappedQuestion => ({
      stage,
      text,
      namedTool
    })
    const questions = [
      question('decide', 'Our XProtect alarms need texts; what does setup cost?', 'XProtect'),
      question(
        'problem',
        'Our Milestone XProtect emails go unread overnight.',
        'Milestone XProtect'
      ),
      question('options', 'What ways exist to text XProtect alarms?', 'XProtect'),
      question('doubts', 'Will XProtect alarm texts get filtered?', 'Milestone XProtect'),
      question('fit', 'Does this fit our XProtect office?', null),
      question('fit', 'Our AT&T gateway stopped; what now?', 'AT&T email-to-text gateway'),
      question('problem', 'Nagios outage emails never reached me.', 'Nagios')
    ]
    const { tools, over } = overusedSoftware(questions)
    expect(tools).toEqual(['XProtect'])
    expect(over.map((item) => item.stage)).toEqual(['fit', 'decide'])
  })
})
