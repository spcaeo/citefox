import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HelpFillWay } from '@shared/helpfill'
import type { HelpFillEstimate, HelpFillPrompt, HelpFillResult, HelpFillScope } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import type { HelpFillSource } from './types'

export interface HelpFillState {
  /** Null while it loads. */
  estimate: HelpFillEstimate | null
  /**
   * The way open: the URL's, else Describe when Claude is set up and the chatbot
   * way when it is not. Null until the estimate says which.
   */
  way: HelpFillWay | null
  /** The chatbot prompt, loaded when the chatbot way opens. */
  prompt: HelpFillPrompt | null
  promptError: string | null
  /** Which call is running. */
  busy: 'describe' | 'read' | null
  error: string | null
  /** The last answer read, with the way it came from (for the banner). */
  result: { result: HelpFillResult; way: HelpFillWay } | null
}

export interface HelpFillActions {
  describe: (sentence: string, count: number) => Promise<HelpFillResult | null>
  read: (text: string) => Promise<HelpFillResult | null>
  /** Loads the prompt again (after a failure). */
  reloadPrompt: () => void
}

/**
 * The helper's calls: the Describe estimate on open (which also picks the way
 * when the URL names none), the chatbot prompt when that way opens (again for
 * another page or topic), and Describe or Read the answer.
 * A new page or topic clears the last answer.
 */
export function useHelpFill(
  source: HelpFillSource,
  kind: string,
  projectId: string,
  scope: HelpFillScope,
  wayParam: HelpFillWay | null,
  promptCount: number | null,
  items?: readonly string[]
): [HelpFillState, HelpFillActions] {
  const [estimate, setEstimate] = useState<HelpFillEstimate | null>(null)
  const [prompt, setPrompt] = useState<HelpFillPrompt | null>(null)
  const [promptError, setPromptError] = useState<string | null>(null)
  const [promptTry, setPromptTry] = useState(0)
  const [busy, setBusy] = useState<HelpFillState['busy']>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<HelpFillState['result']>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const available = estimate?.available ?? null
  const way: HelpFillWay | null =
    wayParam ?? (available === null ? null : available ? 'describe' : 'chatbot')
  const pageId = scope.pageId
  // The rows by value, so a new array with the same questions does not ask again.
  const itemsKey = items === undefined ? null : JSON.stringify(items)
  const sent = useMemo(
    () => (itemsKey === null ? {} : { items: JSON.parse(itemsKey) as string[] }),
    [itemsKey]
  )
  const promptId = scope.promptId ?? null
  const subject = scope.subject ?? null
  // The scope as sent: optional keys only when set, so a rows kind sends `{ pageId }`.
  const scopeKey = `${pageId ?? ''}|${promptId ?? ''}|${subject ?? ''}`
  const [shownFor, setShownFor] = useState(scopeKey)
  if (shownFor !== scopeKey) {
    setShownFor(scopeKey)
    setResult(null)
    setError(null)
    setPrompt(null)
  }

  useEffect(() => {
    let current = true
    source['helpfill:estimate']({ kind, projectId }).then(
      (value) => {
        if (current) setEstimate(value)
      },
      () => {
        // Without an estimate the Describe card says it cannot tell the cost; the chatbot way still works.
        if (current) {
          setEstimate({ kind, available: false, calls: 1, costText: '1 AI call', reason: null })
        }
      }
    )
    return () => {
      current = false
    }
  }, [source, kind, projectId])

  useEffect(() => {
    if (way !== 'chatbot') return
    let current = true
    source['helpfill:prompt']({
      kind,
      projectId,
      scope: sentScope(pageId, promptId, subject),
      count: promptCount,
      ...sent
    }).then(
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
  }, [source, kind, projectId, pageId, promptId, subject, way, promptCount, promptTry, sent])

  const run = useCallback(
    async (
      which: 'describe' | 'read',
      call: () => Promise<HelpFillResult>,
      fallback: string
    ): Promise<HelpFillResult | null> => {
      setBusy(which)
      setError(null)
      try {
        const value = await call()
        if (!live.current) return null
        setResult({ result: value, way: which === 'describe' ? 'describe' : 'chatbot' })
        return value
      } catch (cause) {
        if (live.current) setError(errorText(cause, fallback))
        return null
      } finally {
        if (live.current) setBusy(null)
      }
    },
    []
  )

  const describe = useCallback(
    (sentence: string, count: number) =>
      run(
        'describe',
        () =>
          source['helpfill:describe']({
            kind,
            projectId,
            scope: sentScope(pageId, promptId, subject),
            sentence,
            count,
            ...sent
          }),
        'CiteFox AI could not write them. Try again.'
      ),
    [run, source, kind, projectId, pageId, promptId, subject, sent]
  )

  const read = useCallback(
    (text: string) =>
      run(
        'read',
        () =>
          source['helpfill:read']({
            kind,
            projectId,
            scope: sentScope(pageId, promptId, subject),
            text,
            ...sent
          }),
        'Could not read the answer.'
      ),
    [run, source, kind, projectId, pageId, promptId, subject, sent]
  )

  const reloadPrompt = useCallback(() => {
    setPromptError(null)
    setPromptTry((value) => value + 1)
  }, [])

  return [
    { estimate, way, prompt, promptError, busy, error, result },
    { describe, read, reloadPrompt }
  ]
}

function sentScope(
  pageId: string | null,
  promptId: string | null,
  subject: string | null
): HelpFillScope {
  return {
    pageId,
    ...(promptId === null ? {} : { promptId }),
    ...(subject === null ? {} : { subject })
  }
}
