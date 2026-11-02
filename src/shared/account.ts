/**
 * "Join CiteFox": who uses the app, and what they agreed to hear about
 * (Docs/PRIVACY.md). Main and the renderer check details with the same rules;
 * the Apps Script backend (server/apps-script/Code.gs) checks them again.
 */

/** Who the reports are for. */
export type AccountRole = 'agency' | 'in-house' | 'solo'

export const ACCOUNT_ROLES: readonly { id: AccountRole; label: string; hint: string }[] = [
  { id: 'agency', label: 'Clients', hint: 'An agency or freelancer' },
  { id: 'in-house', label: 'My company', hint: 'An in-house team' },
  { id: 'solo', label: 'My own sites', hint: 'Just me' }
]

export interface AccountDetails {
  name: string
  email: string
  company: string
  role: AccountRole
  /** "Product updates": new versions and changes. Unticked until the person ticks it (CASL, GDPR). */
  productUpdates: boolean
  /** "Occasional news and offers". A separate, unticked consent. */
  news: boolean
}

export const ACCOUNT_LIMITS = { name: 100, email: 254, company: 120 } as const

/** A plain email shape: something@domain.tld, no spaces. */
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/

export type AccountErrors = Partial<Record<'name' | 'email' | 'company' | 'role', string>>

export function isAccountRole(value: unknown): value is AccountRole {
  return value === 'agency' || value === 'in-house' || value === 'solo'
}

/** Trimmed details, or the field errors to show. Company may be empty for "My own sites". */
export function checkAccountDetails(
  input: unknown
): { ok: true; details: AccountDetails } | { ok: false; errors: AccountErrors } {
  const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
  const name = text(raw.name)
  const email = text(raw.email).toLowerCase()
  const company = text(raw.company)
  const errors: AccountErrors = {}
  if (name === '') errors.name = 'Enter your name.'
  else if (name.length > ACCOUNT_LIMITS.name) errors.name = 'Use a shorter name.'
  if (email === '') errors.email = 'Enter your email.'
  else if (email.length > ACCOUNT_LIMITS.email || !EMAIL.test(email))
    errors.email = 'Enter an email like you@example.com.'
  if (company.length > ACCOUNT_LIMITS.company) errors.company = 'Use a shorter company name.'
  if (!isAccountRole(raw.role)) errors.role = 'Choose who the reports are for.'
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    details: {
      name,
      email,
      company,
      role: raw.role as AccountRole,
      productUpdates: raw.productUpdates === true,
      news: raw.news === true
    }
  }
}
