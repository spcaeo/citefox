import { describe, expect, test } from 'vitest'
import { claudeModelLabel, DEFAULT_CLAUDE_MODEL_LABEL } from './modelLabel'

describe('claudeModelLabel', () => {
  test('names the default when the setting is empty', () => {
    expect(DEFAULT_CLAUDE_MODEL_LABEL).toBe('Default (Sonnet)')
    expect(claudeModelLabel(null)).toBe('Default (Sonnet)')
    expect(claudeModelLabel(undefined)).toBe('Default (Sonnet)')
    expect(claudeModelLabel('')).toBe('Default (Sonnet)')
    expect(claudeModelLabel('   ')).toBe('Default (Sonnet)')
  })

  test('keeps a model id the user set', () => {
    expect(claudeModelLabel('claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(claudeModelLabel('  claude-sonnet-5  ')).toBe('claude-sonnet-5')
  })
})
