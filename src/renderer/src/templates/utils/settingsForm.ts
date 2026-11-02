import {
  TEMPLATE_LANGUAGES,
  TEMPLATE_MODELS,
  TEMPLATE_PROMPT_COUNT_MAX,
  TEMPLATE_TONE_LABEL,
  isTemplateTone,
  templateKindInfo,
  templateLanguageLabel,
  type TemplateSettings,
  type TemplateTone
} from '@shared/domain'

/**
 * The settings form (FR-26.3). Only the settings that apply to a step are shown:
 * Model always, the rest from `templateKindInfo(kind).settings`. Empty fields mean
 * the default: the model in Settings, the market's language, the page's prompt
 * count, the template's own wording.
 */

export interface SettingsDraft {
  model: string
  language: string
  promptCount: string
  tone: string
}

export interface SettingOption {
  value: string
  label: string
}

export interface SettingsFields {
  language: boolean
  promptCount: boolean
  tones: readonly TemplateTone[]
}

export const PROMPT_COUNT_MIN = 1

export const PROMPT_COUNT_ERROR = `Enter a whole number from ${PROMPT_COUNT_MIN} to ${TEMPLATE_PROMPT_COUNT_MAX}, or leave it empty to use the page's count.`

/** Buyer prompts stay long situational questions (Docs/textbolt-reference.md). */
export const BUYER_PROMPTS_TONE_HINT =
  'Buyer questions stay long situational questions by your method, so Search-style short is not offered.'

export function settingsFields(kind: string): SettingsFields {
  const flags = templateKindInfo(kind).settings
  return { language: flags.language, promptCount: flags.promptCount, tones: flags.tones }
}

export function toSettingsDraft(settings: TemplateSettings): SettingsDraft {
  return {
    model: settings.model ?? '',
    language: settings.language ?? '',
    promptCount: settings.promptCount === null ? '' : String(settings.promptCount),
    tone: settings.tone ?? ''
  }
}

/** Empty is the page's count. Anything else must be a whole number from 1 to 30. */
export function readPromptCount(text: string): { value: number | null; error: string | null } {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { value: null, error: null }
  if (!/^\d+$/.test(trimmed)) return { value: null, error: PROMPT_COUNT_ERROR }
  const value = Number(trimmed)
  if (value < PROMPT_COUNT_MIN || value > TEMPLATE_PROMPT_COUNT_MAX) {
    return { value: null, error: PROMPT_COUNT_ERROR }
  }
  return { value, error: null }
}

export function settingsDraftError(kind: string, draft: SettingsDraft): string | null {
  if (!settingsFields(kind).promptCount) return null
  return readPromptCount(draft.promptCount).error
}

/**
 * Settings to save. Fields that do not apply to the kind are null, and a tone the
 * kind does not offer (Search-style short on buyer prompts) is dropped.
 */
export function fromSettingsDraft(kind: string, draft: SettingsDraft): TemplateSettings {
  const fields = settingsFields(kind)
  const tone = draft.tone
  return {
    model: draft.model.trim().length > 0 ? draft.model.trim() : null,
    language: fields.language && draft.language.length > 0 ? draft.language : null,
    promptCount: fields.promptCount ? readPromptCount(draft.promptCount).value : null,
    tone: isTemplateTone(tone) && fields.tones.includes(tone) ? tone : null
  }
}

/** What each model is to a reader: CiteFox AI and how it trades care for speed (R12). */
const MODEL_LABEL: Readonly<Record<(typeof TEMPLATE_MODELS)[number], string>> = {
  'claude-sonnet-5-5': 'CiteFox AI · balanced',
  'claude-opus-5-5': 'CiteFox AI · most careful',
  'claude-haiku-5-5': 'CiteFox AI · fastest'
}

/** A model's reader name; one CiteFox does not know is "CiteFox AI · other model". */
export function modelLabel(model: string): string {
  return MODEL_LABEL[model as keyof typeof MODEL_LABEL] ?? 'CiteFox AI · other model'
}

export function modelOptions(current: string): SettingOption[] {
  const options: SettingOption[] = [
    { value: '', label: 'Default' },
    ...TEMPLATE_MODELS.map((model) => ({ value: model, label: modelLabel(model) }))
  ]
  if (current.length > 0 && !options.some((option) => option.value === current)) {
    options.push({ value: current, label: modelLabel(current) })
  }
  return options
}

export function languageOptions(current: string): SettingOption[] {
  const options: SettingOption[] = [
    { value: '', label: "Market's language" },
    ...TEMPLATE_LANGUAGES.map((language) => ({ value: language.code, label: language.label }))
  ]
  if (current.length > 0 && !options.some((option) => option.value === current)) {
    options.push({ value: current, label: current })
  }
  return options
}

/** Only the tones the kind offers, after "As written" (the template's own wording). */
export function toneOptions(kind: string): SettingOption[] {
  return [
    { value: '', label: 'As written' },
    ...settingsFields(kind).tones.map((tone) => ({ value: tone, label: TEMPLATE_TONE_LABEL[tone] }))
  ]
}

export function toneHint(kind: string): string | null {
  return kind === 'buyer_prompts' ? BUYER_PROMPTS_TONE_HINT : null
}

/**
 * "Tone Conversational (default: As written)" for each setting that differs from
 * `base`, in form order. Used when the wording matches the default but the
 * settings do not.
 */
export function settingsDifferences(
  kind: string,
  settings: TemplateSettings,
  base: TemplateSettings
): string[] {
  const fields = settingsFields(kind)
  const lines: string[] = []
  if (settings.model !== base.model) {
    lines.push(`Model ${settings.model ?? 'Default'} (default: ${base.model ?? 'Default'})`)
  }
  if (fields.language && settings.language !== base.language) {
    lines.push(
      `Output language ${templateLanguageLabel(settings.language)} (default: ${templateLanguageLabel(base.language)})`
    )
  }
  if (fields.promptCount && settings.promptCount !== base.promptCount) {
    lines.push(
      `Questions to write ${settings.promptCount ?? "page's count"} (default: ${base.promptCount ?? "page's count"})`
    )
  }
  if (fields.tones.length > 0 && settings.tone !== base.tone) {
    lines.push(`Tone ${toneLabel(settings.tone)} (default: ${toneLabel(base.tone)})`)
  }
  return lines
}

function toneLabel(tone: TemplateTone | null): string {
  return tone === null ? 'As written' : TEMPLATE_TONE_LABEL[tone]
}
