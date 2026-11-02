import type { JSX } from 'react'
import { ACCOUNT_LIMITS, ACCOUNT_ROLES, type AccountErrors } from '@shared/account'
import { FieldError } from '../onboarding/parts'
import type { AccountDraft } from './accountDraft'

/**
 * Name, email, company, who the reports are for, and the two consents
 * (separate and unticked, for CASL and GDPR). Shared by "Join CiteFox" and
 * Settings › Data & about › Your CiteFox account.
 */
export function AccountFields({
  draft,
  errors,
  onChange,
  idPrefix
}: {
  draft: AccountDraft
  errors: AccountErrors
  onChange: (patch: Partial<AccountDraft>) => void
  idPrefix: string
}): JSX.Element {
  const id = (name: string): string => `${idPrefix}-${name}`
  const text = (
    field: 'name' | 'email' | 'company',
    label: string,
    options: { type?: string; autoComplete: string; optional?: boolean }
  ): JSX.Element => (
    <div className="field">
      <label className="field-label" htmlFor={id(field)}>
        {label}
        {options.optional ? <span className="opt"> (optional)</span> : null}
      </label>
      <input
        id={id(field)}
        className="ob-input"
        type={options.type ?? 'text'}
        autoComplete={options.autoComplete}
        maxLength={ACCOUNT_LIMITS[field]}
        value={draft[field]}
        aria-invalid={errors[field] ? true : undefined}
        aria-describedby={errors[field] ? id(`${field}-error`) : undefined}
        onChange={(event) => onChange({ [field]: event.target.value })}
      />
      {errors[field] ? <FieldError id={id(`${field}-error`)}>{errors[field]}</FieldError> : null}
    </div>
  )
  return (
    <div className="acct-fields">
      <div className="acct-row">
        {text('name', 'Your name', { autoComplete: 'name' })}
        {text('email', 'Work email', { type: 'email', autoComplete: 'email' })}
      </div>
      {text('company', 'Company', { autoComplete: 'organization', optional: true })}
      <fieldset
        className="acct-roles"
        aria-invalid={errors.role ? true : undefined}
        aria-describedby={errors.role ? id('role-error') : undefined}
      >
        <legend className="field-label">Who are the reports for?</legend>
        <div className="acct-role-list">
          {ACCOUNT_ROLES.map((role) => (
            <label key={role.id} className="radio acct-role" htmlFor={id(`role-${role.id}`)}>
              <input
                id={id(`role-${role.id}`)}
                type="radio"
                name={id('role')}
                value={role.id}
                checked={draft.role === role.id}
                onChange={() => onChange({ role: role.id })}
              />
              <span className="stack-tight">
                <span className="acct-role-name">{role.label}</span>
                <span className="hint">{role.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.role ? <FieldError id={id('role-error')}>{errors.role}</FieldError> : null}
      </fieldset>
      <div className="acct-consents">
        <label className="radio" htmlFor={id('updates')}>
          <input
            id={id('updates')}
            type="checkbox"
            checked={draft.productUpdates}
            onChange={(event) => onChange({ productUpdates: event.target.checked })}
          />
          <span className="field-label">Product updates</span>
        </label>
        <label className="radio" htmlFor={id('news')}>
          <input
            id={id('news')}
            type="checkbox"
            checked={draft.news}
            onChange={(event) => onChange({ news: event.target.checked })}
          />
          <span className="field-label">Occasional news and offers</span>
        </label>
      </div>
    </div>
  )
}
