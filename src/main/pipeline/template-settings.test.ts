import { describe, expect, test } from 'vitest'
import { DEFAULT_TEMPLATE_SETTINGS, type TemplateSettings } from '@shared/domain'
import { modelFor, settingsInstructions, withSettingsInstructions } from './template-settings'

function settings(partial: Partial<TemplateSettings>): TemplateSettings {
  return { ...DEFAULT_TEMPLATE_SETTINGS, ...partial }
}

describe('template settings instructions (FR-26.3)', () => {
  test('default settings add nothing for any kind', () => {
    for (const kind of ['buyer_profile', 'buyer_prompts', 'coverage', 'aio_gap', 'run_summary']) {
      expect(settingsInstructions(kind, DEFAULT_TEMPLATE_SETTINGS)).toBe('')
      expect(withSettingsInstructions('Rendered body', kind, DEFAULT_TEMPLATE_SETTINGS)).toBe(
        'Rendered body'
      )
    }
  })

  test('a language writes the output line for analysis steps and the prompt line for buyer prompts', () => {
    expect(settingsInstructions('aio_gap', settings({ language: 'es' }))).toBe(
      'Write every sentence of the output in Spanish (es).'
    )
    expect(settingsInstructions('coverage', settings({ language: 'fr' }))).toBe(
      'Write every sentence of the output in French (fr).'
    )
    expect(settingsInstructions('buyer_prompts', settings({ language: 'de' }))).toBe(
      'Write the prompts in German (de), whatever the market language.'
    )
    expect(settingsInstructions('run_summary', settings({ language: 'xx' }))).toBe(
      'Write every sentence of the output in xx (xx).'
    )
  })

  test('tone lines follow the kind, and buyer prompts stay long situational questions', () => {
    expect(settingsInstructions('buyer_profile', settings({ tone: 'plain' }))).toBe(
      'Tone: plain, direct sentences. No marketing language.'
    )
    expect(settingsInstructions('buyer_profile', settings({ tone: 'conversational' }))).toBe(
      'Tone: conversational, the way a person would ask a colleague.'
    )
    const promptPlain = settingsInstructions('buyer_prompts', settings({ tone: 'plain' }))
    expect(promptPlain).toContain('still one long situational question')
    const promptChat = settingsInstructions('buyer_prompts', settings({ tone: 'conversational' }))
    expect(promptChat).toContain('still one long situational question')
    expect(settingsInstructions('buyer_prompts', settings({ tone: 'search_short' }))).toBe('')
    for (const tone of ['plain', 'conversational', 'search_short'] as const) {
      expect(settingsInstructions('buyer_prompts', settings({ tone }))).not.toContain(
        'search-style'
      )
    }
  })

  test('settings that do not apply to a kind add nothing', () => {
    expect(settingsInstructions('coverage', settings({ promptCount: 5 }))).toBe('')
    expect(settingsInstructions('aio_gap', settings({ tone: 'plain' }))).toBe('')
    expect(settingsInstructions('run_summary', settings({ tone: 'search_short' }))).toBe('')
    expect(settingsInstructions('buyer_profile', settings({ promptCount: 3 }))).toBe('')
    expect(settingsInstructions('aio_gap', settings({ model: 'claude-opus-5-5' }))).toBe('')
  })

  test('language and tone lines are appended in order after the rendered text', () => {
    expect(
      withSettingsInstructions(
        'Body',
        'buyer_profile',
        settings({ language: 'es', tone: 'plain', promptCount: 4 })
      )
    ).toBe(
      [
        'Body',
        'Write every sentence of the output in Spanish (es).',
        'Tone: plain, direct sentences. No marketing language.'
      ].join('\n')
    )
  })

  test('modelFor prefers the template model, then the fallback, then null', () => {
    expect(modelFor(settings({ model: 'claude-opus-5-5' }), 'claude-sonnet-5-5')).toBe(
      'claude-opus-5-5'
    )
    expect(modelFor(DEFAULT_TEMPLATE_SETTINGS, 'claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
    expect(modelFor(DEFAULT_TEMPLATE_SETTINGS, null)).toBeNull()
    expect(modelFor(DEFAULT_TEMPLATE_SETTINGS, undefined)).toBeNull()
  })
})
