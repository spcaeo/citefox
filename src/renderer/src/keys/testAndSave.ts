import type { ApiKeyMetadata, ApiKeyProvider, KeyTestReason } from '@shared/domain'
import type { AddApiKeyRequest, KeyIdRequest, KeyTestResult, RemoveKeyResult } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { providerTitle, warningCopy } from './health'

/** The key channels "Test and save" uses: the same ones the forms used before. */
export interface TestAndSaveClient {
  addKey(request: AddApiKeyRequest): Promise<ApiKeyMetadata>
  testKey(request: KeyIdRequest): Promise<KeyTestResult>
  removeKey(request: KeyIdRequest): Promise<RemoveKeyResult>
}

export type TestAndSaveOutcome =
  /** Saved and the test passed. */
  | { kind: 'saved'; key: ApiKeyMetadata; message: string }
  /** Saved, but the test could not say yes (busy, out of searches, timed out, offline). */
  | { kind: 'warning'; key: ApiKeyMetadata; message: string }
  /** The provider turned the key down: it was taken off again, so nothing is saved. */
  | { kind: 'rejected'; message: string }

/**
 * "Test and save" (the 3-step key card). The key goes through the existing
 * `keys:add` (the keychain, rotation and project scope are unchanged); a provider
 * whose key is not tested on save (SerpApi, Jina) is tested once straight after.
 * A key the provider rejects is removed again, so a mistyped paste never stays in
 * the rotation. Any other failed test keeps the key, with the reason. Messages never
 * repeat the secret.
 */
export async function testAndSave(
  client: TestAndSaveClient,
  request: AddApiKeyRequest
): Promise<TestAndSaveOutcome> {
  const secret = request.secret
  const added = await client.addKey(request)
  let key = added
  let reason: KeyTestReason | null =
    added.state === 'warning' ? (added.lastReason ?? 'other') : null
  let tested: string | null = null
  if (added.state === 'unchecked') {
    try {
      const result = await client.testKey({ id: added.id })
      key = result.key
      reason = result.reason
      tested = result.message
    } catch (cause) {
      const why = errorText(cause, 'The test did not finish.', { secret, sentence: true })
      return { kind: 'warning', key: added, message: `${added.name} saved. ${why}` }
    }
  }
  if (reason === 'rejected') {
    await client.removeKey({ id: added.id }).catch(() => undefined)
    return { kind: 'rejected', message: rejectedText(request.provider) }
  }
  if (reason !== null) {
    return {
      kind: 'warning',
      key,
      message: `${key.name} saved. ${tested ?? warningCopy(request.provider, reason)}`
    }
  }
  return { kind: 'saved', key, message: savedText(key, tested) }
}

function rejectedText(provider: ApiKeyProvider): string {
  const name = providerTitle(provider)
  return `${name} did not accept this key, so nothing was saved. Copy it again from your ${name} dashboard (step 2) and paste it here.`
}

function savedText(key: ApiKeyMetadata, tested: string | null): string {
  const credits = key.cloroCredits?.remaining
  const left =
    credits === undefined || credits === null
      ? ''
      : ` ${credits.toLocaleString('en-US')} credits left.`
  if (tested !== null) return `${key.name} tested and saved. ${tested}`
  return `${key.name} tested and saved. It works.${left}`
}
