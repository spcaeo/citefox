/** Email sending accounts. */

import type { EmailAccount, EmailMode, EmailSettings, EmailTestResult } from '../domain'
import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'

/** `email:setMode`. */
export interface EmailModeRequest {
  mode: EmailMode
}

/**
 * `email:saveAccount`. `password` is write-only (FR-23.3, FR-11.11, NFR-5).
 * Null `id` creates an account. Null `password` on an update keeps the stored password.
 * A create requires a password. The password is never a field on {@link EmailAccount}.
 */
export interface SaveEmailAccountRequest {
  id: string | null
  provider: EmailAccount['provider']
  fromName: string
  fromAddress: string
  replyTo: string | null
  host: string
  port: number
  security: EmailAccount['security']
  username: string
  password: string | null
  isDefault: boolean
}

export interface EmailAccountIdRequest {
  id: string
}

/**
 * `email:test`.
 * `to`, when present, is one address and the test is sent there.
 * When `to` is omitted, the test is sent to the account's from address.
 */
export interface EmailTestRequest {
  id: string
  to?: string
}

export interface RemoveEmailAccountResult {
  id: string
}

/** Invoke channels for this area. Each one is declared here only. */
export const emailChannels = {
  'email:getSettings': invoke<EmailSettings>(),
  'email:setMode': invokeWith<EmailModeRequest, EmailSettings>(),
  'email:saveAccount': invokeWith<SaveEmailAccountRequest, EmailAccount>(),
  'email:removeAccount': invokeWith<EmailAccountIdRequest, RemoveEmailAccountResult>(),
  'email:test': invokeWith<EmailTestRequest, EmailTestResult>()
} as const satisfies InvokeChannelSpecs
