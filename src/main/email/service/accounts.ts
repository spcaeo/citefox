import type { EmailAccount } from '@shared/domain'
import type { SaveEmailAccountRequest } from '@shared/ipc'
import { EmailError } from '../errors'
import type { EmailAccountStore } from '../types'
import { bag, mutateSecret, newRef } from './support'
import type { ReadyDeps } from './types'

export function createAccount(deps: ReadyDeps, parsed: SaveEmailAccountRequest): EmailAccount {
  if (parsed.password === null) throw new EmailError('Invalid request', 'invalid')
  const password = parsed.password
  const ref = newRef('smtp', deps.createId)
  mutateSecret(() => deps.secrets.set(ref, password), bag(deps, [password]))
  const account: EmailAccount = {
    id: deps.createId(),
    provider: parsed.provider,
    fromName: parsed.fromName,
    fromAddress: parsed.fromAddress,
    replyTo: parsed.replyTo,
    host: parsed.host,
    port: parsed.port,
    security: parsed.security,
    username: parsed.username,
    keychainRef: ref,
    isDefault: parsed.isDefault,
    lastTestAt: null,
    lastTestOk: null,
    lastTestMessage: null,
    lastTestNextStep: null,
    usedFor: []
  }
  persistAccounts(deps.accounts, assignDefault(deps.accounts.list(), account))
  const saved = deps.accounts.get(account.id)
  if (saved === null) throw new EmailError('Invalid request', 'invalid')
  return saved
}

export function updateAccount(deps: ReadyDeps, parsed: SaveEmailAccountRequest): EmailAccount {
  if (parsed.id === null) throw new EmailError('Invalid request', 'invalid')
  const existing = deps.accounts.get(parsed.id)
  if (existing === null) throw new EmailError('Unknown email account', 'not_found')
  if (parsed.password !== null) {
    const password = parsed.password
    mutateSecret(() => deps.secrets.set(existing.keychainRef, password), bag(deps, [password]))
  }
  const account: EmailAccount = {
    ...existing,
    provider: parsed.provider,
    fromName: parsed.fromName,
    fromAddress: parsed.fromAddress,
    replyTo: parsed.replyTo,
    host: parsed.host,
    port: parsed.port,
    security: parsed.security,
    username: parsed.username,
    isDefault: parsed.isDefault
  }
  persistAccounts(deps.accounts, assignDefault(deps.accounts.list(), account))
  const saved = deps.accounts.get(account.id)
  if (saved === null) throw new EmailError('Unknown email account', 'not_found')
  return saved
}

export function assignDefault(
  existing: readonly EmailAccount[],
  account: EmailAccount
): EmailAccount[] {
  const others = existing.filter((item) => item.id !== account.id)
  const wantsDefault = account.isDefault || others.every((item) => !item.isDefault)
  const saved = { ...account, isDefault: wantsDefault }
  const replaced = existing.some((item) => item.id === account.id)
  if (!replaced) {
    return [
      ...existing.map((item) => ({ ...item, isDefault: wantsDefault ? false : item.isDefault })),
      saved
    ]
  }
  return existing.map((item) => {
    if (item.id === account.id) return saved
    return { ...item, isDefault: wantsDefault ? false : item.isDefault }
  })
}

export function persistAccounts(store: EmailAccountStore, next: readonly EmailAccount[]): void {
  const current = new Set(store.list().map((account) => account.id))
  for (const account of next) {
    if (current.has(account.id)) store.update(account)
    else store.insert(account)
  }
}

export function promoteDefault(store: EmailAccountStore): void {
  const accounts = store.list()
  if (accounts.some((account) => account.isDefault)) return
  const first = accounts[0]
  if (first === undefined) return
  store.update({ ...first, isDefault: true })
}
