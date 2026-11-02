import { describe, expect, test } from 'vitest'
import { DEFAULT_TEMPLATE_SETTINGS } from '@shared/domain'
import {
  BUYER_PROMPTS_TONE_HINT,
  PROMPT_COUNT_ERROR,
  fromSettingsDraft,
  modelOptions,
  readPromptCount,
  settingsDifferences,
  settingsDraftError,
  settingsFields,
  toSettingsDraft,
  toneHint,
  toneOptions
} from './settingsForm'

describe('settings form', () => {
  test('buyer prompts never offer Search-style short, and say why', () => {
    const values = toneOptions('buyer_prompts').map((option) => option.value)
    expect(values).toEqual(['', 'plain', 'conversational'])
    expect(values).not.toContain('search_short')
    expect(toneHint('buyer_prompts')).toBe(BUYER_PROMPTS_TONE_HINT)
    expect(toneHint('brand_prompts')).toBeNull()
    expect(toneOptions('brand_prompts').map((option) => option.value)).toContain('search_short')
  })

  test('a search-style tone is dropped when saving buyer prompts', () => {
    const draft = { model: '', language: '', promptCount: '', tone: 'search_short' }
    expect(fromSettingsDraft('buyer_prompts', draft).tone).toBeNull()
  })

  test('prompt count is empty or a whole number from 1 to 30', () => {
    expect(readPromptCount('')).toEqual({ value: null, error: null })
    expect(readPromptCount(' 12 ')).toEqual({ value: 12, error: null })
    expect(readPromptCount('1').value).toBe(1)
    expect(readPromptCount('30').value).toBe(30)
    for (const bad of ['0', '31', '2.5', '-3', 'ten']) {
      expect(readPromptCount(bad)).toEqual({ value: null, error: PROMPT_COUNT_ERROR })
    }
    const draft = { model: '', language: '', promptCount: '40', tone: '' }
    expect(settingsDraftError('buyer_prompts', draft)).toBe(PROMPT_COUNT_ERROR)
    // Coverage has no prompt count, so its field never blocks a save.
    expect(settingsDraftError('coverage', draft)).toBeNull()
  })

  test('only settings that apply to the kind are shown and saved', () => {
    expect(settingsFields('coverage')).toEqual({ language: true, promptCount: false, tones: [] })
    expect(settingsFields('buyer_prompts').promptCount).toBe(true)
    const draft = { model: 'claude-opus-5-5', language: 'es', promptCount: '8', tone: 'plain' }
    expect(fromSettingsDraft('coverage', draft)).toEqual({
      model: 'claude-opus-5-5',
      language: 'es',
      promptCount: null,
      tone: null
    })
    expect(fromSettingsDraft('buyer_prompts', draft)).toEqual({
      model: 'claude-opus-5-5',
      language: 'es',
      promptCount: 8,
      tone: 'plain'
    })
  })

  test('drafts round-trip through the stored settings', () => {
    const settings = {
      model: null,
      language: 'fr',
      promptCount: 5,
      tone: 'conversational' as const
    }
    expect(fromSettingsDraft('buyer_prompts', toSettingsDraft(settings))).toEqual(settings)
    expect(toSettingsDraft(DEFAULT_TEMPLATE_SETTINGS)).toEqual({
      model: '',
      language: '',
      promptCount: '',
      tone: ''
    })
  })

  test('a stored model the list does not know stays selectable', () => {
    expect(modelOptions('claude-old-1').map((option) => option.value)).toContain('claude-old-1')
    expect(modelOptions('')[0]).toEqual({ value: '', label: 'Default' })
    // R12: a reader sees CiteFox AI, never the model id behind it.
    expect(modelOptions('claude-old-1').map((option) => option.label)).toEqual([
      'Default',
      'CiteFox AI · balanced',
      'CiteFox AI · most careful',
      'CiteFox AI · fastest',
      'CiteFox AI · other model'
    ])
  })

  test('settings differences name each changed setting with its default', () => {
    expect(
      settingsDifferences(
        'buyer_prompts',
        { ...DEFAULT_TEMPLATE_SETTINGS, tone: 'conversational' },
        DEFAULT_TEMPLATE_SETTINGS
      )
    ).toEqual(['Tone Conversational (default: As written)'])
    expect(
      settingsDifferences(
        'coverage',
        { ...DEFAULT_TEMPLATE_SETTINGS, promptCount: 9 },
        DEFAULT_TEMPLATE_SETTINGS
      )
    ).toEqual([])
  })
})
