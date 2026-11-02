import { describe, expect, test } from 'vitest'
import {
  TEXTBOLT_URL,
  coverageOutput,
  pageFacts,
  profileOutput,
  promptOutput
} from '../mocks/m2/textbolt'
import { countLevels, parseCoverageMatrix, parseProfileParts, parsePromptLines } from './output'

describe('playground output parsers', () => {
  test('reads numbered questions and refuses a mixed block', () => {
    const lines = parsePromptLines(promptOutput(10))
    expect(lines).toHaveLength(10)
    expect(lines?.[0]?.n).toBe(1)
    expect(parsePromptLines('1. One\nnot a question')).toBeNull()
  })

  test('reads the coverage matrix and the six profile parts', () => {
    const facts = pageFacts(TEXTBOLT_URL, null)
    const matrix = parseCoverageMatrix(coverageOutput(facts))
    expect(matrix?.rows).toHaveLength(10)
    expect(matrix ? countLevels(matrix.rows) : null).toEqual({
      Strong: 5,
      Partial: 4,
      Weak: 1,
      None: 0
    })
    expect(matrix?.findings).toHaveLength(3)
    expect(parseProfileParts(profileOutput(facts))?.map((part) => part.heading)).toEqual([
      'Who',
      'Environment',
      'Strongest segments',
      'Trigger events',
      'What they value',
      'Poor fit'
    ])
  })
})
