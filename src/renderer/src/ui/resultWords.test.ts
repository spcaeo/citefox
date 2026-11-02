import { describe, expect, test } from 'vitest'
import { ENGINE_IDS } from '@shared/domain'
import { resultBarText, NO_RESULTS } from './resultTones'
import { GOOGLE_WORDS, resultWords } from './resultWords'

describe('resultWords', () => {
  test('Google AI Overview, All and nothing keep "No AI Overview"', () => {
    for (const engine of ['google_aio', 'all', null, undefined] as const) {
      expect(resultWords(engine)).toBe(GOOGLE_WORDS)
    }
    expect(GOOGLE_WORDS.none).toBe('No AI Overview')
    expect(GOOGLE_WORDS.noneYet).toBe('No AI Overview yet')
    expect(GOOGLE_WORDS.answered).toBe('AI Overview')
  })

  test('an answer engine says "No answer", and names itself where it counts answers', () => {
    const words = resultWords('chatgpt')
    expect(words).toMatchObject({
      engine: 'ChatGPT',
      none: 'No answer',
      noneLegend: 'no answer',
      noneYet: 'No answer yet',
      answered: 'Answered',
      withAnswer: 'ChatGPT answered',
      noneTodo: 'Nothing to do: ChatGPT gave no answer.'
    })
  })

  test('no answer engine ever says AI Overview', () => {
    for (const engine of ENGINE_IDS.filter((id) => id !== 'google_aio')) {
      const words = resultWords(engine)
      expect(JSON.stringify(words)).not.toMatch(/AI Overview/)
    }
  })

  test('the bar legend follows the words', () => {
    const counts = { ...NO_RESULTS, no_overview: 3 }
    expect(resultBarText(counts)).toContain('3 no AI Overview')
    expect(resultBarText(counts, resultWords('perplexity'))).toContain('3 no answer')
  })
})
