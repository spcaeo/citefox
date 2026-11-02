import { describe, expect, it } from 'vitest'
import {
  chatbotOpen,
  HELPFILL_BOTS,
  HELPFILL_PREFILL_MAX,
  helpFillSummary,
  isHelpFillBot,
  isHelpFillWay
} from './helpfill'

describe('chatbotOpen', () => {
  const short = 'Write 15 questions.\nquestion,stage,page'

  it('fills the prompt in for the bots that read ?q=', () => {
    expect(chatbotOpen('chatgpt', short)).toEqual({
      url: `https://chatgpt.com/?q=${encodeURIComponent(short)}`,
      prefilled: true
    })
    expect(chatbotOpen('perplexity', short).url).toMatch(
      /^https:\/\/www\.perplexity\.ai\/search\?q=/u
    )
    expect(chatbotOpen('claude', short).url).toMatch(/^https:\/\/claude\.ai\/new\?q=/u)
    expect(chatbotOpen('copilot', short).url).toMatch(/^https:\/\/copilot\.microsoft\.com\/\?q=/u)
  })

  it('opens Gemini on its home page: it has no prefill link', () => {
    expect(chatbotOpen('gemini', short)).toEqual({
      url: 'https://gemini.google.com/app',
      prefilled: false
    })
  })

  it('opens the home page when the link would be too long', () => {
    const long = 'a buyer question, '.repeat(200)
    for (const bot of HELPFILL_BOTS) {
      const plan = chatbotOpen(bot, long)
      expect(plan.prefilled).toBe(false)
      expect(plan.url.length).toBeLessThanOrEqual(HELPFILL_PREFILL_MAX)
      expect(plan.url).not.toContain('?q=')
    }
  })

  it('only opens https links', () => {
    for (const bot of HELPFILL_BOTS) expect(chatbotOpen(bot, short).url).toMatch(/^https:\/\//u)
  })
})

describe('helpFillSummary', () => {
  const noun = ['question', 'questions'] as const

  it('says what was read, merged, set aside and ready', () => {
    expect(
      helpFillSummary(
        { read: 15, tracked: 2, repeats: 0, setAside: 1, ready: 12 },
        noun,
        'TextBolt'
      )
    ).toBe(
      'Read 15 rows. 2 were close to questions you track and were merged. 1 named TextBolt and was set aside. 12 are ready.'
    )
  })

  it('counts repeats inside the answer and uses singular words for one', () => {
    expect(
      helpFillSummary({ read: 1, tracked: 1, repeats: 1, setAside: 0, ready: 1 }, noun, null)
    ).toBe(
      'Read 1 row. 1 was close to questions you track and was merged. 1 repeated another row and was merged. 1 is ready.'
    )
  })

  it('says none are ready', () => {
    expect(
      helpFillSummary({ read: 0, tracked: 0, repeats: 0, setAside: 0, ready: 0 }, noun, null)
    ).toBe('Read 0 rows. None are ready.')
  })
})

describe('guards', () => {
  it('knows the ways and the bots', () => {
    expect(isHelpFillWay('describe')).toBe(true)
    expect(isHelpFillWay('chatbot')).toBe(true)
    expect(isHelpFillWay('other')).toBe(false)
    expect(isHelpFillBot('gemini')).toBe(true)
    expect(isHelpFillBot('bard')).toBe(false)
  })
})
