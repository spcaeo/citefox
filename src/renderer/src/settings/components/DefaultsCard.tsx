import type { JSX } from 'react'
import { INTERVAL_DAYS, intervalDaysText } from '@shared/domain'
import { describedBy } from '../../onboarding/copy'
import { FieldError } from '../../onboarding/parts'
import { CountryOptions, LanguageOptions } from '../../onboarding/MarketOptions'
import { LANGUAGE_OPTIONS, marketSummary } from '../../onboarding/markets'
import { Panel } from '../../ui'
import type { SettingsDraft, SettingsErrors } from '../validate'

/** Defaults for new pages: name, market, re-check interval, samples and prompt count. */
export function DefaultsCard({
  draft,
  errors,
  patch
}: {
  draft: SettingsDraft
  errors: SettingsErrors
  patch: (partial: Partial<SettingsDraft>) => void
}): JSX.Element {
  const languageKnown = LANGUAGE_OPTIONS.some((option) => option.value === draft.defaultLanguage)
  return (
    <Panel title="Defaults for new pages" className="stg-span-8">
      <div className="field">
        <label className="field-label" htmlFor="user-name">
          Your name
        </label>
        <input
          id="user-name"
          className="ob-input"
          value={draft.userName}
          aria-invalid={errors.userName ? true : undefined}
          aria-describedby={errors.userName ? 'user-name-error' : undefined}
          onChange={(event) => patch({ userName: event.target.value })}
        />
        {errors.userName ? <FieldError id="user-name-error">{errors.userName}</FieldError> : null}
      </div>
      <fieldset>
        <legend>Default market</legend>
        <div className="grid3">
          <div className="field">
            <label className="field-label" htmlFor="d-country">
              Country
            </label>
            <select
              id="d-country"
              className="select"
              value={draft.defaultCountry}
              aria-invalid={errors.defaultCountry ? true : undefined}
              aria-describedby={errors.defaultCountry ? 'd-country-error' : undefined}
              onChange={(event) => patch({ defaultCountry: event.target.value })}
            >
              <option value="">Choose a country</option>
              <CountryOptions current={draft.defaultCountry} />
            </select>
            {errors.defaultCountry ? (
              <FieldError id="d-country-error">{errors.defaultCountry}</FieldError>
            ) : null}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="d-language">
              Language
            </label>
            <select
              id="d-language"
              className="select"
              value={draft.defaultLanguage}
              aria-invalid={errors.defaultLanguage ? true : undefined}
              aria-describedby={errors.defaultLanguage ? 'd-language-error' : undefined}
              onChange={(event) => patch({ defaultLanguage: event.target.value })}
            >
              <option value="">Choose a language</option>
              <LanguageOptions />
              {!languageKnown && draft.defaultLanguage ? (
                <option value={draft.defaultLanguage}>{draft.defaultLanguage}</option>
              ) : null}
            </select>
            {errors.defaultLanguage ? (
              <FieldError id="d-language-error">{errors.defaultLanguage}</FieldError>
            ) : null}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="d-city">
              City <span className="opt">(optional)</span>
            </label>
            <input
              id="d-city"
              className="ob-input"
              value={draft.defaultLocation}
              placeholder="For local results, e.g. Austin, Texas"
              onChange={(event) => patch({ defaultLocation: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="d-device">
              Device
            </label>
            <select
              id="d-device"
              className="select"
              value={draft.defaultDevice}
              onChange={(event) =>
                patch({ defaultDevice: event.target.value === 'mobile' ? 'mobile' : 'desktop' })
              }
            >
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>
          </div>
        </div>
        <p className="hint">
          Current default:{' '}
          {draft.defaultCountry && draft.defaultLanguage
            ? marketSummary(draft.defaultCountry, draft.defaultLanguage)
            : 'not set'}
          .
        </p>
      </fieldset>
      <div className="grid3">
        <div className="field">
          <label className="field-label" htmlFor="d-interval">
            Re-check every
          </label>
          <select
            id="d-interval"
            className="select"
            value={draft.defaultIntervalDays}
            aria-invalid={errors.defaultIntervalDays ? true : undefined}
            aria-describedby={errors.defaultIntervalDays ? 'd-interval-error' : undefined}
            onChange={(event) => patch({ defaultIntervalDays: event.target.value })}
          >
            {INTERVAL_DAYS.map((days) => (
              <option key={days} value={String(days)}>
                {intervalDaysText(days)}
              </option>
            ))}
          </select>
          {errors.defaultIntervalDays ? (
            <FieldError id="d-interval-error">{errors.defaultIntervalDays}</FieldError>
          ) : null}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="d-samples">
            Samples per question
          </label>
          <input
            id="d-samples"
            className="ob-input mono"
            inputMode="numeric"
            value={draft.defaultSamples}
            aria-invalid={errors.defaultSamples ? true : undefined}
            aria-describedby={describedBy([
              'd-samples-hint',
              errors.defaultSamples ? 'd-samples-error' : false
            ])}
            onChange={(event) => patch({ defaultSamples: event.target.value })}
          />
          <p className="hint" id="d-samples-hint">
            Changing samples for an existing page starts a new baseline.
          </p>
          {errors.defaultSamples ? (
            <FieldError id="d-samples-error">{errors.defaultSamples}</FieldError>
          ) : null}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="d-prompts">
            Questions per page
          </label>
          <input
            id="d-prompts"
            className="ob-input mono"
            inputMode="numeric"
            value={draft.defaultPromptCount}
            aria-invalid={errors.defaultPromptCount ? true : undefined}
            aria-describedby={errors.defaultPromptCount ? 'd-prompts-error' : undefined}
            onChange={(event) => patch({ defaultPromptCount: event.target.value })}
          />
          {errors.defaultPromptCount ? (
            <FieldError id="d-prompts-error">{errors.defaultPromptCount}</FieldError>
          ) : null}
        </div>
      </div>
    </Panel>
  )
}
