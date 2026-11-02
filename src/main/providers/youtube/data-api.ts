import type { ConnectionState, KeyTestReason } from '@shared/domain'
import type { Logger } from '../../logging/logger'
import type { SecretStore } from '../../secrets/secret-store'
import { keyTestReasonForCode, wrapProviderError } from '../errors'
import { CITEFOX_USER_AGENT, requestWithRetry, type HttpTransport } from '../http'
import { isRecord } from '../json-schema'
import { logProvider, resolveSecretList } from '../log'

/** One public video. The test reads its id only: a read-only call that costs 1 quota unit. */
export const YOUTUBE_PROBE_VIDEO = 'jNQXAC9IVRw'
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos'

export interface YouTubeKeyTest {
  state: ConnectionState
  message: string
  nextStep: string | null
  /** Null when `state` is `ok`. */
  reason: KeyTestReason | null
}

/** The probe URL. The key is a query value, so every log line goes through the redactor. */
export function youtubeProbeUrl(secret: string): string {
  const url = new URL(YOUTUBE_VIDEOS_URL)
  url.searchParams.set('part', 'id')
  url.searchParams.set('id', YOUTUBE_PROBE_VIDEO)
  url.searchParams.set('key', secret)
  return url.toString()
}

/**
 * FR-11.9. A read-only YouTube Data API key test: one `videos.list` call for a public
 * video. The key is read from the keychain and never logged (NFR-5).
 */
export async function testYouTubeKey(options: {
  transport: HttpTransport
  logger: Logger
  secretStore: SecretStore
  keychainRef: string
  secrets?: readonly string[] | (() => readonly string[])
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}): Promise<YouTubeKeyTest> {
  let secret: string | null
  try {
    secret = options.secretStore.get(options.keychainRef)
  } catch (error) {
    const wrapped = wrapProviderError(error, resolveSecretList(options.secrets))
    return {
      state: 'warning',
      message: wrapped.message,
      nextStep: wrapped.nextStep,
      reason: keyTestReasonForCode(wrapped.code)
    }
  }
  if (secret === null) {
    return {
      state: 'warning',
      message: 'The YouTube key is missing from the keychain.',
      nextStep: 'Add the YouTube Data API key again.',
      reason: 'other'
    }
  }
  const secrets = resolveSecretList(options.secrets, [secret])
  try {
    const response = await requestWithRetry(
      options.transport,
      {
        method: 'GET',
        url: youtubeProbeUrl(secret),
        headers: { accept: 'application/json', 'user-agent': CITEFOX_USER_AGENT }
      },
      {
        timeoutMs: options.timeoutMs ?? 20_000,
        label: 'YouTube Data API',
        secrets,
        sleep: options.sleep
      }
    )
    const interpreted = interpretYouTube(response.status, response.body)
    logProvider(
      options.logger,
      'info',
      'youtube key test finished',
      { endpoint: YOUTUBE_VIDEOS_URL, status: response.status, state: interpreted.state },
      secrets
    )
    return interpreted
  } catch (error) {
    const wrapped = wrapProviderError(error, secrets)
    logProvider(
      options.logger,
      'error',
      'youtube key test failed',
      { endpoint: YOUTUBE_VIDEOS_URL, message: wrapped.message },
      secrets
    )
    return {
      state: 'warning',
      message: wrapped.message,
      nextStep: wrapped.nextStep,
      reason: keyTestReasonForCode(wrapped.code)
    }
  }
}

/** Google API error reasons: keyInvalid, quotaExceeded, accessNotConfigured, and so on. */
export function interpretYouTube(status: number, bodyText: string): YouTubeKeyTest {
  const reason = errorReason(bodyText)
  if (status === 200) {
    return {
      state: 'ok',
      message: 'Key works. CiteFox can add view counts and publish dates to cited videos.',
      nextStep: null,
      reason: null
    }
  }
  if (status === 429 || reason === 'quotaExceeded' || reason === 'rateLimitExceeded') {
    return {
      state: 'warning',
      message: "The key works, but today's YouTube quota is used up.",
      nextStep: 'Test again tomorrow. Cited videos are still listed without views.',
      reason: 'rate_limited'
    }
  }
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') {
    return {
      state: 'warning',
      message: 'YouTube Data API v3 is not turned on for this key.',
      nextStep: 'Turn on YouTube Data API v3 in the Google Cloud console, then test again.',
      reason: 'rejected'
    }
  }
  if (status === 400 || status === 401 || status === 403) {
    return {
      state: 'warning',
      message: 'YouTube rejected this key.',
      nextStep: 'Check the key in the Google Cloud console and paste it again.',
      reason: 'rejected'
    }
  }
  return {
    state: 'warning',
    message: 'YouTube returned a response CiteFox could not read.',
    nextStep: 'Test the key again.',
    reason: 'other'
  }
}

function errorReason(bodyText: string): string | null {
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (!isRecord(parsed) || !isRecord(parsed.error)) return null
    const errors = parsed.error.errors
    if (Array.isArray(errors)) {
      const first: unknown = errors[0]
      if (isRecord(first) && typeof first.reason === 'string') return first.reason
    }
    const details = parsed.error.details
    if (Array.isArray(details)) {
      for (const detail of details) {
        if (isRecord(detail) && typeof detail.reason === 'string') return detail.reason
      }
    }
    return null
  } catch {
    return null
  }
}
