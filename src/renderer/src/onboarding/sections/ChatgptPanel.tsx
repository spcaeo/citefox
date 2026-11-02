import { useCallback, useEffect, useState, type JSX } from 'react'
import type { HelpFillBot } from '@shared/helpfill'
import type { HelpFillPrompt, SetupSectionPrompt } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { botParam, IconButton, openInBrowser, rememberBot, rememberedBot } from '../../ui'
import { useQueryState } from '../../utils/queryState'
import { ChatbotSteps } from '../../ui/HelpFill/ChatbotSteps'
import { chatbotText } from './useSectionAi'

/**
 * "Your own ChatGPT" for one section: pick the chatbot, copy the section's
 * prompt (the user's edit when they made one), paste the answer back. The
 * answer goes through `onboarding:sectionRead` and is merged the same way as
 * ✦ Find more (or as Redo, when the panel was opened from the Redo box).
 * Reuses the Help me fill chatbot steps, so it looks the same everywhere.
 */
export function ChatgptPanel({
  title,
  intro,
  edited,
  tracked,
  reading,
  loadPrompt,
  onRead,
  onClose
}: {
  title: string
  /** One line above the steps (why it is here: no Claude, or the user's words). */
  intro: string
  /** The prompt text to send in place of the default (an edit or the editor's text). */
  edited: string | null
  /** Rows the section holds, so the prompt says how many it lists. */
  tracked: number
  reading: boolean
  loadPrompt: () => Promise<SetupSectionPrompt>
  onRead: (text: string) => void
  onClose: () => void
}): JSX.Element {
  // The chatbot pick is in the URL (`bot=`), like Help me fill's.
  const [botValue, setBotValue] = useQueryState('bot')
  const [fallbackBot] = useState<HelpFillBot>(() => rememberedBot() ?? 'chatgpt')
  const bot = botParam(botValue) ?? fallbackBot
  const [prompt, setPrompt] = useState<HelpFillPrompt | null>(null)
  const [promptError, setPromptError] = useState<string | null>(null)

  const load = useCallback(() => {
    loadPrompt()
      .then((next) => {
        setPromptError(null)
        setPrompt({
          kind: next.section,
          prompt: chatbotText(next, edited),
          columns: next.columns,
          tracked
        })
      })
      .catch((cause: unknown) => {
        setPromptError(errorText(cause, 'CiteFox could not write the prompt.', { sentence: true }))
      })
  }, [loadPrompt, edited, tracked])

  useEffect(() => {
    load()
    // Written once when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="osc-panel osc-chatbot" data-testid="chatgpt-panel">
      <div className="osc-panel-head">
        <span className="osc-panel-title">Your own ChatGPT · {title}</span>
        <span className="osc-hint">· free, about 1 minute</span>
        <span className="osc-grow" />
        <IconButton icon="x" size="sm" label="Close your own ChatGPT" onClick={onClose} />
      </div>
      <p className="osc-hint">{intro}</p>
      <ChatbotSteps
        bot={bot}
        prompt={prompt}
        promptError={promptError}
        reading={reading}
        disabled={false}
        tip="CSV, a table or a plain list: all read the same. New rows arrive at the top, marked new."
        onBot={(next) => {
          setBotValue(next)
          rememberBot(next)
        }}
        onRetryPrompt={() => {
          setPromptError(null)
          load()
        }}
        onRead={onRead}
        openLink={openInBrowser}
      />
    </div>
  )
}
