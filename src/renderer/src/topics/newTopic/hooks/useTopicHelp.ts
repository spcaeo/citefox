import { useCallback, useEffect, useRef, useState } from 'react'
import type { HelpFillBot, HelpFillWay } from '@shared/helpfill'
import type { HelpFillEstimate, HelpFillPrompt, HelpFillResult } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { rememberBot, rememberedBot, type HelpFillSource } from '../../../ui'
import type { NewTopicUrl } from '../utils/url'
import type { NewTopicUrlPatch } from './useNewTopicUrl'

/** The reply columns main reads for a new topic (src/main/helpfill/kinds/topic.ts). */
export const TOPIC_HELP_KIND = 'topic'

export interface TopicHelpState {
  /** Null until the estimate says whether Claude is set up. */
  available: boolean | null
  reason: string | null
  /**
   * The URL's way, else Describe (the box, as before) unless the estimate says Claude
   * is not set up, then the chatbot way.
   */
  way: HelpFillWay
  bot: HelpFillBot
  prompt: HelpFillPrompt | null
  promptError: string | null
  reading: boolean
  error: string | null
  /** The last answer read, for the summary banner. */
  result: HelpFillResult | null
}

export interface TopicHelpActions {
  setWay: (way: HelpFillWay) => void
  setBot: (bot: HelpFillBot) => void
  reloadPrompt: () => void
  /** Reads a pasted answer; the rows go to `onAnswer`. */
  read: (text: string) => Promise<void>
}

/**
 * ✦ Help me fill under "A buyer problem" (HelpFill.dc.html panel 7, New topic). Describe
 * stays the dialog's own box (its draft and `topics:generateQuestions`); this hook runs the
 * other way: the chatbot prompt for kind `topic` (project-wide: the topic does not exist
 * yet) and reading the pasted answer. Whether Describe is offered comes from the helper's
 * estimate for buyer questions, the same Claude connection the box uses. The way and the bot
 * are on the URL (`nt.help`, `nt.bot`): a way is a history entry, a bot rewrites it.
 */
export function useTopicHelp(options: {
  source: HelpFillSource
  projectId: string
  url: NewTopicUrl
  setUrl: (patch: NewTopicUrlPatch, options?: { replace?: boolean }) => void
  /** True while "A buyer problem" is the way picked (the prompt loads only then). */
  open: boolean
  onAnswer: (result: HelpFillResult) => Promise<void>
}): [TopicHelpState, TopicHelpActions] {
  const { source, projectId, url, setUrl, open, onAnswer } = options
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
    // The questions kind's estimate: is in-app Claude set up for this project.
    source['helpfill:estimate']({ kind: 'questions', projectId }).then(
      (value) => {
        if (current) setEstimate(value)
      },
      () => {
        if (current) setEstimate(null)
      }
    )
    return () => {
      current = false
    }
  }, [source, projectId])

  const available = estimate?.available ?? null
  const way: HelpFillWay = url.help ?? (available === false ? 'chatbot' : 'describe')

  // A link that names Describe for a project without Claude opens the free way instead.
  useEffect(() => {
    if (available === false && url.help === 'describe') {
      setUrl({ help: 'chatbot' }, { replace: true })
    }
  }, [available, url.help, setUrl])

  useEffect(() => {
    if (!open || way !== 'chatbot') return
    let current = true
    source['helpfill:prompt']({
      kind: TOPIC_HELP_KIND,
      projectId,
      scope: { pageId: null },
      count: null
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
  }, [source, projectId, open, way, promptTry])

  const read = useCallback(
    async (text: string) => {
      setReading(true)
      setError(null)
      try {
        const value = await source['helpfill:read']({
          kind: TOPIC_HELP_KIND,
          projectId,
          scope: { pageId: null },
          text
        })
        if (!live.current) return
        setResult(value)
        if (value.rows.length > 0) await onAnswer(value)
      } catch (cause) {
        if (live.current) setError(errorText(cause, 'Could not read the answer.'))
      } finally {
        if (live.current) setReading(false)
      }
    },
    [source, projectId, onAnswer]
  )

  const state: TopicHelpState = {
    available,
    reason: estimate?.reason ?? null,
    way,
    bot: url.bot ?? rememberedBot() ?? 'chatgpt',
    prompt,
    promptError,
    reading,
    error,
    result
  }
  const actions: TopicHelpActions = {
    setWay: (next) => setUrl({ help: next }),
    setBot: (next) => {
      rememberBot(next)
      setUrl({ bot: next }, { replace: true })
    },
    reloadPrompt: () => {
      setPromptError(null)
      setPromptTry((value) => value + 1)
    },
    read
  }
  return [state, actions]
}
