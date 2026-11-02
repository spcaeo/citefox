import { describe, expect, test } from 'vitest'
import { claudeReadyExtra } from './copy'

describe('claudeReadyExtra', () => {
  test('adds nothing when the engine message already names the plan', () => {
    expect(
      claudeReadyExtra(
        'CiteFox AI is ready. CiteFox will run its analysis on your CiteFox AI Max plan.',
        'CiteFox AI Max'
      )
    ).toBeNull()
  })

  test('adds the plan sentence to a bare ready message', () => {
    expect(claudeReadyExtra('CiteFox AI is ready.', 'CiteFox AI Pro')).toBe(
      'CiteFox will run its analysis on your CiteFox AI Pro plan.'
    )
  })

  test('does not double "plan" and adds nothing without a plan', () => {
    expect(claudeReadyExtra('CiteFox AI is ready.', 'Team Plan')).toBe(
      'CiteFox will run its analysis on your Team Plan.'
    )
    expect(claudeReadyExtra('CiteFox AI is ready.', null)).toBeNull()
  })
})
