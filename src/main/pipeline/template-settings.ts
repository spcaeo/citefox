import {
  settingsForKind,
  templateLanguageLabel,
  type TemplateSettings,
  type TemplateTone
} from '@shared/domain'

/**
 * FR-26.3. How a template's settings reach Claude. Model is passed to the
 * provider; language and tone become instruction lines after the rendered
 * template; prompt count replaces the page's count when set. A null setting
 * adds nothing, so a template with default settings renders exactly as before.
 */

const TONE_LINE: Readonly<Record<TemplateTone, string>> = {
  plain: 'Tone: plain, direct sentences. No marketing language.',
  conversational: 'Tone: conversational, the way a person would ask a colleague.',
  search_short:
    'Tone: search-style short, the way people type into Google. A few words each, no full sentences.'
}

/** Buyer prompts stay long situational questions whatever the tone (owner method, FR-8.3). */
const BUYER_PROMPT_TONE_LINE: Readonly<Partial<Record<TemplateTone, string>>> = {
  plain: 'Tone: plain words. Each prompt is still one long situational question in full sentences.',
  conversational:
    'Tone: conversational, the way a buyer would say it to a colleague. Each prompt is still one long situational question.'
}

/** Lines to append after the rendered template. Empty when every setting is the default. */
export function settingsInstructions(kind: string, settings: TemplateSettings): string {
  const applied = settingsForKind(kind, settings)
  const lines: string[] = []
  if (applied.language !== null) {
    const label = templateLanguageLabel(applied.language)
    lines.push(
      kind === 'buyer_prompts'
        ? `Write the prompts in ${label} (${applied.language}), whatever the market language.`
        : `Write every sentence of the output in ${label} (${applied.language}).`
    )
  }
  if (applied.tone !== null) {
    const line =
      kind === 'buyer_prompts' ? BUYER_PROMPT_TONE_LINE[applied.tone] : TONE_LINE[applied.tone]
    if (line !== undefined) lines.push(line)
  }
  return lines.join('\n')
}

/** `text` with the settings lines appended, or `text` unchanged when there are none. */
export function withSettingsInstructions(
  text: string,
  kind: string,
  settings: TemplateSettings
): string {
  const lines = settingsInstructions(kind, settings)
  return lines.length === 0 ? text : `${text}\n${lines}`
}

/** The model a step runs with: the template's own, else the caller's default. */
export function modelFor(
  settings: TemplateSettings,
  fallback: string | null | undefined
): string | null {
  return settings.model ?? fallback ?? null
}
