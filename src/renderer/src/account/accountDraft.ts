import type { AccountDetails, AccountRole } from '@shared/account'

/** The form's working copy: role stays empty until the person picks one. */
export interface AccountDraft {
  name: string
  email: string
  company: string
  role: AccountRole | ''
  productUpdates: boolean
  news: boolean
}

export function draftFrom(details: AccountDetails | null, fallbackName = ''): AccountDraft {
  return details
    ? { ...details }
    : { name: fallbackName, email: '', company: '', role: '', productUpdates: false, news: false }
}

/** One line under the form, the same in the Join step and the account card. */
export const PRIVACY_NOTE =
  'Your SEO data stays on this computer. Only these details and an anonymous daily version check are sent. Questions: getcitifox@gmail.com'
