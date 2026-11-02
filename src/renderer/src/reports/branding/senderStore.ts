import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { ReportBranding } from '@shared/report/review/extras'
import {
  brandingMode,
  NO_SENDER,
  reportByline,
  type BrandingMode,
  type ReportByline,
  type ReportSender
} from '@shared/report/review/sender'

/**
 * Who the reports are from (Settings › Reports), read once and shared by every screen:
 * `useReportSender()` for the details, `useBrandingMode()` for screens that only adapt
 * their words ("Pitch a new client" for an agency, "Brief your leadership" in-house).
 * Tests swap the client with `configureSenderClient`, or set a value with `primeReportSender`.
 */
export interface SenderClient {
  get(): Promise<ReportSender>
  set(sender: ReportSender): Promise<ReportSender>
}

export function createLiveSenderClient(): SenderClient {
  return {
    async get() {
      const api = window.citefox
      if (!api) throw new Error('The preload bridge is missing.')
      return api['reports:getSender']()
    },
    async set(sender) {
      const api = window.citefox
      if (!api) throw new Error('The preload bridge is missing.')
      return api['reports:setSender'](sender)
    }
  }
}

let client: SenderClient = createLiveSenderClient()
let current: ReportSender | null = null
let loading: Promise<ReportSender> | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Tests and the dev harness: read and save through `next` from now on. */
export function configureSenderClient(next: SenderClient | null): void {
  client = next ?? createLiveSenderClient()
  current = null
  loading = null
  notify()
}

/** Sets the shared value without a read (tests, and after a save). */
export function primeReportSender(value: ReportSender | null): void {
  current = value
  loading = null
  notify()
}

/** Reads the sender once; a failed read is "no branding" (today's look). */
export function loadReportSender(): Promise<ReportSender> {
  if (current !== null) return Promise.resolve(current)
  loading ??= client.get().then(
    (value) => {
      current = value
      notify()
      return value
    },
    () => {
      current = NO_SENDER
      notify()
      return NO_SENDER
    }
  )
  return loading
}

/** The sender (null while it loads) and a save that updates every screen. */
export function useReportSender(): {
  sender: ReportSender | null
  save: (next: ReportSender) => Promise<ReportSender>
} {
  const sender = useSyncExternalStore(subscribe, () => current)
  useEffect(() => {
    void loadReportSender()
  }, [])
  const save = useCallback(async (next: ReportSender) => {
    const saved = await client.set(next)
    primeReportSender(saved)
    return saved
  }, [])
  return { sender, save }
}

/** `agency`, `company` or `none` (also while it loads), for screens that adapt their words. */
export function useBrandingMode(): BrandingMode {
  return brandingMode(useReportSender().sender)
}

/** The byline for the open project: the app-wide sender and the project's "Prepared for". */
export function useByline(
  branding: ReportBranding | null | undefined,
  brand: string
): {
  loaded: boolean
  byline: ReportByline | null
} {
  const { sender } = useReportSender()
  return {
    loaded: sender !== null,
    byline: sender === null ? null : reportByline(sender, branding ?? NO_LINE, brand)
  }
}

const NO_LINE: ReportBranding = { preparedFor: '', logo: null }
