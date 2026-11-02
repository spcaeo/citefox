import { describe, expect, test } from 'vitest'
import type { TopicDraft } from '@shared/domain'
import { topicOptions } from '../topics/keyword-rules'
import { checkKeywordGroups } from './topic-keywords'

const OPTIONS = topicOptions(
  {
    product: null,
    direct: [{ name: 'ClickSend', domain: 'clicksend.com' }],
    partial: [],
    switchingFrom: [],
    integrations: []
  },
  { competitors: [], switchingFrom: [], integrations: [] }
)

function draft(keywords: { text: string; group: string; family: string | null }[]): TopicDraft {
  return {
    brandNames: ['TextBolt'],
    prompts: keywords.map((item) => ({
      kind: 'keyword',
      included: true,
      text: item.text,
      kwGroup: item.group,
      kwFamily: item.family
    }))
  } as unknown as TopicDraft
}

describe('smoke keyword check: one bad keyword is set aside, not a failed run', () => {
  test('a vs keyword that names no listed option is set aside with why', () => {
    const checked = checkKeywordGroups(
      draft([
        {
          text: 'clicksend alternative for alerts',
          group: 'Alternatives & vs',
          family: 'alternatives_vs'
        },
        {
          text: 'notifyre alternative for reminders',
          group: 'Alternatives & vs',
          family: 'alternatives_vs'
        },
        { text: 'email to text service', group: 'Core', family: null }
      ]),
      OPTIONS
    )
    expect(checked.detail).toContain('set-aside=1')
    expect(checked.lines).toContain(
      'keyword set aside (Alternatives & vs): "notifyre alternative for reminders" names no listed option'
    )
    expect(checked.lines).toContain('keywords Alternatives & vs: clicksend alternative for alerts')
  })

  test('fails when setting aside leaves a group empty, or a keyword names the brand', () => {
    expect(() =>
      checkKeywordGroups(
        draft([
          { text: 'notifyre alternative', group: 'Alternatives & vs', family: 'alternatives_vs' }
        ]),
        OPTIONS
      )
    ).toThrow(/no keyword in Alternatives & vs/u)
    expect(() =>
      checkKeywordGroups(
        draft([{ text: 'textbolt pricing', group: 'Core', family: null }]),
        OPTIONS
      )
    ).toThrow(/names the brand/u)
  })
})
