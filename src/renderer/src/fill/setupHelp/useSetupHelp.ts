import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  HelpFillEstimate,
  HelpFillPrompt,
  HelpFillResult,
  HelpFillSetupSite
} from '@shared/ipc'
import { errorText } from '../../components/errorText'
import type { SetupHelpSource } from './source'

export interface SetupHelpState {
  /** Null while it loads. */
  estimate: HelpFillEstimate | null
  prompt: HelpFillPrompt | null
  promptError: string | null
  reading: boolean
  error: string | null
  /** The last answer read. */
  result: HelpFillResult | null
}

export interface SetupHelpActions {
  read: (text: string) => Promise<HelpFillResult | null>
  reloadPrompt: () => void
}

/** A domain the prompt can use: a bare host with a dot. */
export function usableDomain(domain: string): boolean {
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/iu.test(domain.trim())
}

/**
 * The setup helper's calls: the "Read my website" cost on open, the prompt while
 * the chatbot way is open (again when the domain, brand names or market change),
 * and reading the pasted answer.
 */
export function useSetupHelp(
  source: SetupHelpSource,
  site: HelpFillSetupSite,
  chatbotOpen: boolean
): [SetupHelpState, SetupHelpActions] {
  const [estimate, setEstimate] = useState<HelpFillEstimate | null>(null)
  const [prompt, setPrompt] = useState<HelpFillPrompt | null>(null)
  const [promptError, setPromptError] = useState<string | null>(null)
  const [promptTry, setPromptTry] = useState(0)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<HelpFillResult | null>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  useEffect(() => {
    let current = true
    source['helpfill:setupEstimate']().then(
      (value) => {
        if (current) setEstimate(value)
      },
      () => {
        // Without an estimate the website card cannot say the cost; picking it still checks Claude.
        if (current) {
          setEstimate({ kind: 'project', available: true, calls: 0, costText: '', reason: null })
        }
      }
    )
    return () => {
      current = false
    }
  }, [source])

  const siteKey = JSON.stringify(site)
  useEffect(() => {
    if (!chatbotOpen) return
    const parsed = JSON.parse(siteKey) as HelpFillSetupSite
    if (!usableDomain(parsed.domain)) return
    let current = true
    source['helpfill:setupPrompt']({ site: parsed }).then(
      (value) => {
        if (!current) return
        setPrompt(value)
        setPromptError(null)
      },
      (cause: unknown) => {
        if (current) setPromptError(errorText(cause, 'Could not write the prompt.'))
      }
    )
    return () => {
      current = false
    }
  }, [source, siteKey, chatbotOpen, promptTry])

  const read = useCallback(
    async (text: string): Promise<HelpFillResult | null> => {
      setReading(true)
      setError(null)
      try {
        const value = await source['helpfill:setupRead']({
          site: JSON.parse(siteKey) as HelpFillSetupSite,
          text
        })
        if (!live.current) return null
        setResult(value)
        return value
      } catch (cause) {
        if (live.current) setError(errorText(cause, 'Could not read the answer.'))
        return null
      } finally {
        if (live.current) setReading(false)
      }
    },
    [source, siteKey]
  )

  const reloadPrompt = useCallback(() => {
    setPromptError(null)
    setPromptTry((value) => value + 1)
  }, [])

  // No domain yet: the prompt waits for one (and an old prompt for another site is not shown).
  const hasDomain = usableDomain(site.domain)
  return [
    {
      estimate,
      prompt: hasDomain ? prompt : null,
      promptError: hasDomain ? promptError : null,
      reading,
      error,
      result
    },
    { read, reloadPrompt }
  ]
}
