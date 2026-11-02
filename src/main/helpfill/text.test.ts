import { describe, expect, test } from 'vitest'
import { readTextReply } from './text'

describe('readTextReply', () => {
  test('keeps the answer and drops the chatbot’s opening and closing lines', () => {
    const read = readTextReply(
      `Certainly! Here is a tighter version:

AT&T shut down its gateway in June 2025. TextBolt gives you a new address in 2 minutes.

Steps:
1. Sign up.
2. Point your alerts at it.

I hope this helps! Want me to make it shorter?`,
      6000
    )
    expect(read).toEqual({
      text: 'AT&T shut down its gateway in June 2025. TextBolt gives you a new address in 2 minutes.\n\nSteps:\n1. Sign up.\n2. Point your alerts at it.',
      warnings: []
    })
  })

  test('takes the inside of a code fence that holds the answer', () => {
    const read = readTextReply(
      'Here you go:\n\n```markdown\n## Replace AT&T email to text\nAnswer first.\n```\n\nNotes: I kept your facts.',
      6000
    )
    expect(read.text).toBe('## Replace AT&T email to text\nAnswer first.')
  })

  test('takes out Perplexity’s source marks and source list', () => {
    const read = readTextReply(
      'Carrier gateways are closing[1][2]. Use a business text address instead[3].\n\nSources:\n[1] https://example.com/a\n[2] https://example.com/b',
      6000
    )
    expect(read.text).toBe('Carrier gateways are closing. Use a business text address instead.')
  })

  test('a label line goes, a real first line stays (a pitch’s subject, a friendly opener)', () => {
    expect(
      readTextReply('**Your new pitch:**\n\nSubject: Quick idea\n\nHi [Name],', 4000).text
    ).toBe('Subject: Quick idea\n\nHi [Name],')
    expect(
      readTextReply('Great article on SMS gateways!\n\nWe make one that fits.', 4000).text
    ).toBe('Great article on SMS gateways!\n\nWe make one that fits.')
    expect(readTextReply('## Updated pricing\nFrom $29 a month.', 4000).text).toBe(
      '## Updated pricing\nFrom $29 a month.'
    )
  })

  test('nothing to read, and a long answer cut to the kind’s most', () => {
    expect(readTextReply('   \n\n ', 4000)).toEqual({
      text: '',
      warnings: ['No answer was found in the paste. Paste the whole reply.']
    })
    const read = readTextReply('word '.repeat(400), 100)
    expect(read.text).toHaveLength(100)
    expect(read.text.endsWith('…')).toBe(true)
    expect(read.warnings).toEqual(['Only the first 100 characters were kept.'])
  })
})
