import { useState } from 'react'
import { checkAccountDetails, type AccountErrors } from '@shared/account'
import type { AccountDetails, AccountStatus } from '@shared/ipc'
import type { AccountClient } from './client'
import { draftFrom, type AccountDraft } from './accountDraft'

export interface AccountForm {
  draft: AccountDraft
  errors: AccountErrors
  busy: boolean
  /** A save that failed for another reason than a field ("could not save"). */
  failure: string | null
  patch: (partial: Partial<AccountDraft>) => void
  /** Checks, saves and returns the new status; null when something must be fixed first. */
  submit: () => Promise<AccountStatus | null>
}

export function useAccountForm(
  client: AccountClient,
  initial: AccountDetails | null,
  fallbackName?: string
): AccountForm {
  const [draft, setDraft] = useState<AccountDraft>(() => draftFrom(initial, fallbackName))
  const [errors, setErrors] = useState<AccountErrors>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  return {
    draft,
    errors,
    busy,
    failure,
    patch: (partial) => {
      setDraft((current) => ({ ...current, ...partial }))
      setErrors((current) => {
        const next = { ...current }
        for (const key of Object.keys(partial)) delete next[key as keyof AccountErrors]
        return next
      })
    },
    async submit() {
      const checked = checkAccountDetails(draft)
      if (!checked.ok) {
        setErrors(checked.errors)
        return null
      }
      setErrors({})
      setFailure(null)
      setBusy(true)
      try {
        const result = await client.save(checked.details)
        if (!result.ok) {
          setErrors(result.errors)
          return null
        }
        return result.status
      } catch {
        setFailure('CiteFox could not save your details. Try again.')
        return null
      } finally {
        setBusy(false)
      }
    }
  }
}
