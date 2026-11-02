import { useId, type JSX } from 'react'
import { TEMPLATE_PROMPT_COUNT_MAX } from '@shared/domain'
import {
  PROMPT_COUNT_MIN,
  languageOptions,
  modelOptions,
  readPromptCount,
  settingsFields,
  toneHint,
  toneOptions,
  type SettingOption,
  type SettingsDraft
} from '../utils/settingsForm'

/**
 * Model, Output language, Questions to write and Tone (FR-26.3), only where they
 * apply to the step. Saved with the template body as one version.
 */
export function SettingsForm({
  kind,
  draft,
  disabled,
  onChange
}: {
  kind: string
  draft: SettingsDraft
  disabled: boolean
  onChange: (next: SettingsDraft) => void
}): JSX.Element {
  const fields = settingsFields(kind)
  const countError = fields.promptCount ? readPromptCount(draft.promptCount).error : null
  const countErrorId = useId()
  const countHintId = useId()
  const toneHintId = useId()
  const countId = useId()
  const toneId = useId()
  const hint = toneHint(kind)
  const patch = (field: keyof SettingsDraft, value: string): void =>
    onChange({ ...draft, [field]: value })

  return (
    <div className="tpl-settings" role="group" aria-label="Template settings">
      <SelectField
        label="Model"
        value={draft.model}
        options={modelOptions(draft.model)}
        hint="Default uses the model set in Settings"
        disabled={disabled}
        onChange={(value) => patch('model', value)}
      />
      {fields.language ? (
        <SelectField
          label="Output language"
          value={draft.language}
          options={languageOptions(draft.language)}
          hint="Market's language writes for each market in its own language"
          disabled={disabled}
          onChange={(value) => patch('language', value)}
        />
      ) : null}
      {fields.promptCount ? (
        <div className="field">
          <label className="field-label" htmlFor={countId}>
            Questions to write
          </label>
          <input
            id={countId}
            className="ob-input mono"
            type="number"
            inputMode="numeric"
            min={PROMPT_COUNT_MIN}
            max={TEMPLATE_PROMPT_COUNT_MAX}
            placeholder="Page's count"
            value={draft.promptCount}
            disabled={disabled}
            aria-invalid={countError ? true : undefined}
            aria-describedby={countError ? `${countHintId} ${countErrorId}` : countHintId}
            onChange={(event) => patch('promptCount', event.target.value)}
          />
          <span id={countHintId} className="hint">
            Per page and market. Empty uses the page&apos;s count.
          </span>
          {countError ? (
            <span id={countErrorId} className="field-error" role="alert">
              {countError}
            </span>
          ) : null}
        </div>
      ) : null}
      {fields.tones.length > 0 ? (
        <div className="field">
          <label className="field-label" htmlFor={toneId}>
            Tone
          </label>
          <select
            id={toneId}
            className="ob-input"
            value={draft.tone}
            disabled={disabled}
            aria-describedby={hint ? toneHintId : undefined}
            onChange={(event) => patch('tone', event.target.value)}
          >
            {toneOptions(kind).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {hint ? (
            <span id={toneHintId} className="hint">
              {hint}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  hint,
  disabled,
  onChange
}: {
  label: string
  value: string
  options: readonly SettingOption[]
  hint: string
  disabled: boolean
  onChange: (value: string) => void
}): JSX.Element {
  const hintId = useId()
  const selectId = useId()
  return (
    <div className="field">
      <label className="field-label" htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        className="ob-input"
        value={value}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span id={hintId} className="hint">
        {hint}
      </span>
    </div>
  )
}
