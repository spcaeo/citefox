import { useCallback, useEffect, useState } from 'react'
import type { FillFromWebsiteResult } from '@shared/ipc'
import type { FillClient } from './types'
import { errorText } from '../components/errorText'
import { useAssistProgress, type AssistProgressView } from '../ui/useAssistProgress'

/** The market chosen on the form: country (ISO 3166-1 alpha-2) and language tag. */
export interface FillMarket {
  country: string
  language: string
}

export interface FillState {
  result: FillFromWebsiteResult | null
  error: string | null
  filling: boolean
  /** The latest progress line, or null before the first push. */
  progress: string | null
  /** Live steps of the read (`assist:progress`): each page, the Claude call, the checks. */
  live: AssistProgressView
  /**
   * Reads `domain` for a project that does not exist yet. `market` is the market chosen
   * on the form: competitors are searched for buyers there (batch 2 row 5).
   */
  run: (domain: string, market?: FillMarket | null) => Promise<FillFromWebsiteResult | null>
  /** Where `result` came from: "Read my website", or a chatbot's answer read on New project. */
  origin: 'website' | 'chatbot'
  /** Shows suggestions read elsewhere (a chatbot's answer) in the same card; null clears it. */
  adopt: (result: FillFromWebsiteResult | null) => void
}

/** Host only: no scheme, no path. `https://Example.com/pricing` becomes `example.com`. */
export function cleanDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

export function useFillFromWebsite(
  client: FillClient,
  missingDomain: string,
  /** A read shown before, such as one restored with the onboarding draft. */
  initialResult: FillFromWebsiteResult | null = null
): FillState {
  const [result, setResult] = useState<FillFromWebsiteResult | null>(initialResult)
  const [error, setError] = useState<string | null>(null)
  const [filling, setFilling] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [scope, setScope] = useState<string | null>(null)
  const [origin, setOrigin] = useState<FillState['origin']>('website')
  const live = useAssistProgress(filling, 'projects:fillFromWebsite', scope)

  useEffect(() => client.onFillProgress((payload) => setProgress(payload.detail)), [client])

  const run = useCallback(
    async (domain: string, market?: FillMarket | null): Promise<FillFromWebsiteResult | null> => {
      const host = cleanDomain(domain)
      setResult(null)
      setError(null)
      setProgress(null)
      setOrigin('website')
      if (!host) {
        setError(missingDomain)
        return null
      }
      setScope(host)
      setFilling(true)
      try {
        const next = await client.fillFromWebsite(
          market ? { projectId: null, domain: host, market } : { projectId: null, domain: host }
        )
        setResult(next)
        return next
      } catch (cause) {
        setError(errorText(cause, 'Could not read that website.'))
        return null
      } finally {
        setFilling(false)
      }
    },
    [client, missingDomain]
  )

  const adopt = useCallback((next: FillFromWebsiteResult | null) => {
    setResult(next)
    setError(null)
    setOrigin('chatbot')
  }, [])

  return { result, error, filling, progress, live, run, origin, adopt }
}
