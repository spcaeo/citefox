import { describe, expect, test } from 'vitest'
import { OTHER_KEYWORDS, wordGroupIndex, wordGroups } from './wordGroups'

const kw = (texts: readonly string[]): { id: string; text: string }[] =>
  texts.map((text, index) => ({ id: `k${index + 1}`, text }))

describe('keyword word groups (local, no AI)', () => {
  test('groups by the most shared two-word phrase, the rest in Other keywords', () => {
    const groups = wordGroups(
      kw([
        'nagios sms alerts',
        'nagios sms plugin',
        'send nagios sms',
        'nagios text alert setup',
        'nagios text alert not working',
        'email to sms gateway',
        'email to sms for monitoring',
        'zabbix pager'
      ])
    )
    expect(groups.map((group) => [group.label, group.ids])).toEqual([
      ['nagios sms', ['k1', 'k2', 'k3']],
      ['nagios text alert', ['k4', 'k5']],
      ['email to sms', ['k6', 'k7']],
      [OTHER_KEYWORDS, ['k8']]
    ])
  })

  test('is the same every time, whatever the input order of equal groups', () => {
    const texts = ['sms api pricing', 'sms api free', 'text alert app', 'text alert service']
    const once = wordGroups(kw(texts))
    expect(wordGroups(kw(texts))).toEqual(once)
    // Ties go to the shorter phrase first, then A to Z.
    expect(once.map((group) => group.label)).toEqual(['sms api', 'text alert'])
  })

  test('the AT&T keywords share "email to text"; a keyword joins one group only', () => {
    const groups = wordGroups(
      kw([
        'txt.att.net not working',
        'att email to text alternative',
        'email to sms gateway comparison',
        'business email to text service pricing'
      ])
    )
    expect(groups.map((group) => [group.label, group.ids])).toEqual([
      ['email to text', ['k2', 'k4']],
      [OTHER_KEYWORDS, ['k1', 'k3']]
    ])
    const index = wordGroupIndex(groups)
    expect(index.get('k3')).toBe(OTHER_KEYWORDS)
    expect(index.size).toBe(4)
  })

  test('no keywords, or none shared, leave no named group', () => {
    expect(wordGroups([])).toEqual([])
    expect(wordGroups(kw(['alpha beta', 'gamma delta']))).toEqual([
      { label: OTHER_KEYWORDS, ids: ['k1', 'k2'] }
    ])
  })
})
