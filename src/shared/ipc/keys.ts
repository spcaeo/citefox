/** API keys. A secret is sent only on `keys:add` and `keys:replace` and is never returned. */

import type { ApiKeyMetadata, ApiKeyProvider, KeyTestReason } from '../domain'
import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'

/**
 * Renderer to main when adding a key. `secret` is sent once and is never
 * part of any result (FR-11.11, NFR-5).
 */
export interface AddApiKeyRequest {
  provider: ApiKeyProvider
  /**
   * FR-11.1. Onboarding does not ask for a name; the renderer supplies one.
   */
  name: string
  secret: string
  /** Null means no cap. */
  cap: number | null
  /** Empty means available to every project. */
  projectIds: readonly string[]
  /**
   * FR-11.2. When omitted, the key is appended after that provider's current order.
   */
  rotationOrder?: number
}

export interface KeyIdRequest {
  id: string
}

export interface RenameKeyRequest {
  id: string
  name: string
}

export interface SetKeyOnRequest {
  id: string
  on: boolean
}

export interface SetKeyCapRequest {
  id: string
  /** Null clears the cap. */
  cap: number | null
}

/** Settings "Replace key". The new secret is sent once and is not returned. */
export interface ReplaceKeyRequest {
  id: string
  secret: string
}

/**
 * `keys:update`. Omitted fields stay as they are.
 * `projectIds: []` means the key serves every project.
 * There is no `keys:setProjects` channel.
 */
export interface UpdateKeyRequest {
  id: string
  name?: string
  /** Null clears the user-entered plan. */
  plan?: string | null
  /** Null clears the monthly cap. */
  monthlyCap?: number | null
  enabled?: boolean
  projectIds?: readonly string[]
}

/**
 * `keys:reorder`. `ids` must be exactly that provider's current ids, once each.
 * `provider` may be omitted when every id belongs to one provider.
 */
export interface ReorderKeysRequest {
  provider?: ApiKeyProvider
  ids: readonly string[]
}

export interface RemoveKeyResult {
  id: string
}

/**
 * Result of testing a stored key. The secret stays in the keychain.
 * `message` says what happened and, on failure, the next step (NFR-10).
 * It must not contain the secret (NFR-5).
 * `reason` is null when the test is `ok`.
 */
export interface KeyTestResult {
  key: ApiKeyMetadata
  message: string
  reason: KeyTestReason | null
}

/** Invoke channels for this area. Each one is declared here only. */
export const keysChannels = {
  'keys:add': invokeWith<AddApiKeyRequest, ApiKeyMetadata>(),
  'keys:test': invokeWith<KeyIdRequest, KeyTestResult>(),
  'keys:rename': invokeWith<RenameKeyRequest, ApiKeyMetadata>(),
  'keys:setOn': invokeWith<SetKeyOnRequest, ApiKeyMetadata>(),
  'keys:setCap': invokeWith<SetKeyCapRequest, ApiKeyMetadata>(),
  'keys:replace': invokeWith<ReplaceKeyRequest, ApiKeyMetadata>(),
  'keys:update': invokeWith<UpdateKeyRequest, ApiKeyMetadata>(),
  'keys:reorder': invokeWith<ReorderKeysRequest, ApiKeyMetadata[]>(),
  'keys:list': invoke<ApiKeyMetadata[]>(),
  'keys:remove': invokeWith<KeyIdRequest, RemoveKeyResult>()
} as const satisfies InvokeChannelSpecs
