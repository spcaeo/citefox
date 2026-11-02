/** Site icons next to domains in lists (Overview, Competitors, citations). */

import { invokeWith, type InvokeChannelSpecs } from './contract'

/** At most this many domains per `favicons:get`. */
export const FAVICON_BATCH_MAX = 24

/**
 * `favicons:get`. Bare hostnames (`example.com`); anything else is skipped.
 * Main answers from its cache and fetches the rest in the background with a
 * short timeout; the renderer shows a letter tile until an icon arrives.
 */
export interface FaviconRequest {
  domains: readonly string[]
}

export interface FaviconEntry {
  /** The hostname as asked for, lower-cased. */
  domain: string
  /** A `data:image/…;base64,…` URI, or null when the site has no usable icon. */
  dataUri: string | null
}

/** One entry per valid domain asked for. Offline or switched off: an empty list. */
export interface FaviconResult {
  icons: readonly FaviconEntry[]
}

/** Invoke channels for this area. Each one is declared here only. */
export const faviconsChannels = {
  'favicons:get': invokeWith<FaviconRequest, FaviconResult>()
} as const satisfies InvokeChannelSpecs
