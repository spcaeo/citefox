import { useState } from 'react'
import type { ApiKeyMetadata, ApiKeyProvider } from '@shared/domain'
import type { UpdateKeyRequest } from '@shared/ipc'
import type { AdminClient } from '../../admin/client'
import type { OnboardingClient } from '../../onboarding/client'
import { keyWarningReason, warningCopy, WORKING_KEY_NOTE } from '../../keys/health'
import { movedIds, plainError } from '../utils/model'

/** A section's latest result, shown in one status panel. */
export interface SectionMessage {
  text: string
  tone: 'ok' | 'warn'
  /** Out of searches: the key works, the plan is empty. */
  note: string | null
  /** True when the message is an error the user should notice at once. */
  alert: boolean
}

export interface KeyActions {
  busy: boolean
  message: SectionMessage | null
  say: (message: SectionMessage | null) => void
  test: (key: ApiKeyMetadata) => Promise<void>
  toggle: (key: ApiKeyMetadata) => Promise<void>
  move: (keys: readonly ApiKeyMetadata[], key: ApiKeyMetadata, direction: -1 | 1) => Promise<void>
  save: (key: ApiKeyMetadata, patch: Omit<UpdateKeyRequest, 'id'>) => Promise<boolean>
  replace: (key: ApiKeyMetadata, secret: string) => Promise<boolean>
  remove: (key: ApiKeyMetadata) => Promise<boolean>
  run: (work: () => Promise<SectionMessage | null>, secret?: string) => Promise<boolean>
}

export function okMessage(text: string): SectionMessage {
  return { text, tone: 'ok', note: null, alert: false }
}

export function warnMessage(text: string, alert = true): SectionMessage {
  return { text, tone: 'warn', note: null, alert }
}

/**
 * Key actions for one provider section. Every action reloads the overview
 * (`onChanged`) so the table, the capsule, and the activity strip agree.
 */
export function useKeyActions(input: {
  client: OnboardingClient
  admin?: AdminClient
  provider: ApiKeyProvider
  onChanged: () => Promise<void>
}): KeyActions {
  const { client, admin, provider, onChanged } = input
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<SectionMessage | null>(null)

  async function run(work: () => Promise<SectionMessage | null>, secret = ''): Promise<boolean> {
    setBusy(true)
    try {
      const next = await work()
      if (next !== null) setMessage(next)
      await onChanged()
      return true
    } catch (error) {
      setMessage(warnMessage(plainError(error, secret)))
      return false
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    message,
    say: setMessage,
    run,
    test: async (key) => {
      await run(async () => {
        const tested = await client.testKey({ id: key.id })
        const reason = keyWarningReason(tested)
        if (reason === null) return okMessage(tested.message)
        return {
          text: warningCopy(provider, reason),
          tone: 'warn',
          note: reason === 'out_of_searches' ? WORKING_KEY_NOTE : null,
          alert: reason !== 'out_of_searches'
        }
      })
    },
    toggle: async (key) => {
      await run(async () => {
        await client.setKeyOn({ id: key.id, on: !key.on })
        return okMessage(key.on ? `${key.name} is off.` : `${key.name} is on.`)
      })
    },
    move: async (keys, key, direction) => {
      const ids = movedIds(keys, key.id, direction)
      if (ids === null) return
      await run(async () => {
        if (!admin) throw new Error('Reordering keys is not available here.')
        await admin.reorderKeys({ provider, ids })
        return okMessage(`${key.name} moved ${direction < 0 ? 'up' : 'down'} in rotation order.`)
      })
    },
    save: (key, patch) =>
      run(async () => {
        if (admin) {
          await admin.updateKey({ id: key.id, ...patch })
        } else {
          if (patch.name !== undefined) await client.renameKey({ id: key.id, name: patch.name })
          if (patch.monthlyCap !== undefined) {
            await client.setKeyCap({ id: key.id, cap: patch.monthlyCap })
          }
        }
        return okMessage(`${patch.name ?? key.name} saved.`)
      }),
    replace: (key, secret) =>
      run(async () => {
        const replaced = await client.replaceKey({ id: key.id, secret })
        if (provider === 'anthropic' && replaced.state === 'warning') {
          return warnMessage(warningCopy('anthropic', 'rejected'))
        }
        return okMessage(
          provider === 'anthropic'
            ? 'Key replaced and tested. It works.'
            : 'Key replaced. Test it to see if it works.'
        )
      }, secret),
    remove: (key) =>
      run(async () => {
        await client.removeKey({ id: key.id })
        return okMessage(`${key.name} removed. Its searches this month still count.`)
      })
  }
}
