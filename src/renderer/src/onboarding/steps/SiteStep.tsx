import { useState, type JSX } from 'react'
import type { SetupSiteDraft } from '@shared/ipc'
import { CountryOptions, LanguageOptions } from '../MarketOptions'
import { FieldError } from '../parts'
import { SETUP_NEXT_NOTE, siteErrors, siteValid, stepKicker } from '../setupSteps'
import { StepPage } from '../StepPage'
import type { SetupStepProps } from './types'
import './setup-steps.css'

type Field = 'domain' | 'country' | 'language'

function describedBy(ids: readonly (string | false | undefined)[]): string | undefined {
  const list = ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
  return list.length > 0 ? list.join(' ') : undefined
}

/**
 * Step 1, "Which website should AI answers cite?": only the required basics. Website,
 * country and language are required (*); the name is optional. Continue stays off
 * until the three are valid; a field says what is wrong once the user has left it.
 */
export function SiteStep({
  draft,
  onDraft,
  onBack,
  onContinue,
  busy,
  alert
}: SetupStepProps): JSX.Element {
  const site = draft.site
  const [touched, setTouched] = useState<ReadonlySet<Field>>(new Set())
  const errors = siteErrors(site)
  const shown = (field: Field): string | undefined =>
    touched.has(field) ? errors[field] : undefined
  const valid = siteValid(site)

  function patch(next: Partial<SetupSiteDraft>): void {
    onDraft((current) => ({ ...current, site: { ...current.site, ...next } }))
  }

  function touch(field: Field): void {
    setTouched((current) => (current.has(field) ? current : new Set([...current, field])))
  }

  function submit(): void {
    if (!valid) {
      setTouched(new Set<Field>(['domain', 'country', 'language']))
      return
    }
    onContinue()
  }

  const domainError = shown('domain')
  const countryError = shown('country')
  const languageError = shown('language')

  return (
    <StepPage
      kicker={stepKicker('site')}
      title="Which website should AI answers cite?"
      sub={<p>Three things. Everything else, CiteFox works out with you next.</p>}
      onSubmit={submit}
      onBack={onBack}
      note={SETUP_NEXT_NOTE.site}
      primary={{ label: 'Continue', onClick: submit, disabled: !valid || busy, busy }}
      alert={alert}
    >
      <section className="ob-card stack" aria-label="Your site">
        <div className="field">
          <label className="field-label" htmlFor="s1-domain">
            Your website <span className="obs-req">*</span>
          </label>
          <input
            className="ob-input mono"
            id="s1-domain"
            type="text"
            value={site.domain}
            placeholder="example.com"
            spellCheck={false}
            autoComplete="url"
            required
            aria-invalid={domainError ? true : undefined}
            aria-describedby={describedBy([domainError && 's1-domain-error'])}
            onChange={(event) => patch({ domain: event.target.value })}
            onBlur={() => touch('domain')}
          />
          {domainError ? <FieldError id="s1-domain-error">{domainError}</FieldError> : null}
        </div>
        <div className="grid2">
          <div className="field">
            <label className="field-label" htmlFor="s1-country">
              Where are your buyers? <span className="obs-req">*</span>
            </label>
            <select
              className="ob-input"
              id="s1-country"
              value={site.country}
              required
              aria-invalid={countryError ? true : undefined}
              aria-describedby={describedBy([countryError && 's1-country-error'])}
              onChange={(event) => {
                patch({ country: event.target.value })
                touch('country')
              }}
              onBlur={() => touch('country')}
            >
              {site.country === '' ? <option value="">Choose a country</option> : null}
              <CountryOptions current={site.country === 'other' ? '' : site.country} />
              {site.country === 'other' ? <option value="other">Other code…</option> : null}
            </select>
            {site.country === 'other' ? (
              <input
                className="ob-input"
                id="s1-country-code"
                type="text"
                value={site.countryCode}
                aria-label="Country code"
                placeholder="GB"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => patch({ countryCode: event.target.value })}
              />
            ) : null}
            {countryError ? <FieldError id="s1-country-error">{countryError}</FieldError> : null}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="s1-language">
              Language <span className="obs-req">*</span>
            </label>
            <select
              className="ob-input"
              id="s1-language"
              value={site.language}
              required
              aria-invalid={languageError ? true : undefined}
              aria-describedby={describedBy([languageError && 's1-language-error'])}
              onChange={(event) => {
                patch({ language: event.target.value })
                touch('language')
              }}
              onBlur={() => touch('language')}
            >
              {site.language === '' ? <option value="">Choose a language</option> : null}
              <LanguageOptions />
              <option value="other">Other code…</option>
            </select>
            {site.language === 'other' ? (
              <input
                className="ob-input"
                id="s1-language-code"
                type="text"
                value={site.languageCode}
                aria-label="Language code"
                placeholder="pt-BR"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => patch({ languageCode: event.target.value })}
              />
            ) : null}
            {languageError ? <FieldError id="s1-language-error">{languageError}</FieldError> : null}
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="s1-name">
            Your name <span className="opt">(optional, for reports)</span>
          </label>
          <input
            className="ob-input"
            id="s1-name"
            type="text"
            value={site.userName}
            autoComplete="given-name"
            onChange={(event) => patch({ userName: event.target.value })}
          />
        </div>
      </section>
    </StepPage>
  )
}
