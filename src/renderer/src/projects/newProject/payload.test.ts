import { describe, expect, test } from 'vitest'
import type { ApiKeyMetadata } from '@shared/domain'
import {
  claudeOptions,
  clientUsesClaudeCode,
  createOptions,
  INITIAL_CHOICES,
  parseCap
} from './payload'

describe('New project choices (FR-10.4, FR-11.4, FR-11.7)', () => {
  test('a blank form sends none of the optional fields', () => {
    expect(createOptions(INITIAL_CHOICES)).toEqual({ ok: true, options: {} })
  })

  test('copy, a shared cap with a rule, and a named API key are sent', () => {
    expect(
      createOptions({
        ...INITIAL_CHOICES,
        copyFrom: 'textbolt',
        cap: '1,500',
        capRule: 'allow_10',
        claude: 'key-anthropic'
      })
    ).toEqual({
      ok: true,
      options: {
        copySettingsFrom: 'textbolt',
        search: { source: 'shared', cap: 1500, capRule: 'allow_10', dedicatedKeyId: null },
        claude: {
          connection: 'api_key',
          keyId: 'key-anthropic',
          fallback: 'wait',
          fallbackKeyId: null,
          model: null
        }
      }
    })
  })

  test('a dedicated key needs a key and ignores the cap field', () => {
    expect(createOptions({ ...INITIAL_CHOICES, source: 'dedicated' })).toEqual({
      ok: false,
      error: 'Choose the dedicated SerpApi key.'
    })
    expect(
      createOptions({ ...INITIAL_CHOICES, source: 'dedicated', dedicatedKeyId: 'k9', cap: 'x' })
    ).toEqual({
      ok: true,
      options: {
        search: { source: 'dedicated', cap: null, capRule: 'pause', dedicatedKeyId: 'k9' }
      }
    })
  })

  test('the cap must be a whole number', () => {
    expect(parseCap('')).toEqual({ ok: true, cap: null })
    expect(parseCap('500')).toEqual({ ok: true, cap: 500 })
    expect(parseCap('5.5').ok).toBe(false)
    expect(createOptions({ ...INITIAL_CHOICES, cap: '-1' }).ok).toBe(false)
  })

  test('Claude choices list each Anthropic key, and a client project on Claude Code warns', () => {
    const keys = [
      { id: 'a1', provider: 'anthropic', name: 'My key', rotationOrder: 0 },
      { id: 's1', provider: 'serpapi', name: 'Plan', rotationOrder: 0 }
    ] as unknown as ApiKeyMetadata[]
    expect(claudeOptions(keys).map((option) => option.label)).toEqual([
      'App default (from Settings)',
      'Claude Code on this computer',
      'Anthropic API · My key'
    ])
    expect(clientUsesClaudeCode('Acme Inc.', 'claude_code')).toBe(true)
    expect(clientUsesClaudeCode('', 'claude_code')).toBe(false)
    expect(clientUsesClaudeCode('Acme Inc.', 'a1')).toBe(false)
  })
})
