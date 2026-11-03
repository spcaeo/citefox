import type { AccountDetails, AccountRole } from '@shared/account'

/**
 * The form's working copy: role stays empty until the person picks one. A new person starts
 * with both email boxes ticked (the owner's choice, 2026-11-03); someone who already joined
 * keeps what they chose.
 */
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
    : { name: fallbackName, email: '', company: '', role: '', productUpdates: true, news: true }
}

/** One line under the form, the same in the Join step and the account card. */
export const PRIVACY_NOTE =
  'Your SEO data stays on this computer. Only these details and an anonymous daily version check are sent. Questions: getcitifox@gmail.com'
