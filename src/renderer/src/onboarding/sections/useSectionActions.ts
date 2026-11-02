import { useCallback, useEffect, useRef, useState } from 'react'
import type { SetupSectionId } from '@shared/ipc'
import { withRule } from '../setupApply'
import type { SectionEnv } from './types'
import type { AiMode, SectionAi } from './useSectionAi'
import type { SectionUrl } from './useSectionUrl'

/** How the "Your own ChatGPT" panel was opened: what it asks for and how the answer merges. */
export interface ChatbotSpec {
  mode: AiMode
  instruction: string | null
  /** Prompt text in place of the default. */
  edited: string | null
  intro: string
}

export interface Removal {
  /** "Removed “Twilio”." */
  message: string
  undo: () => void
}

/** How long Undo stays after ✕ Remove. */
export const UNDO_MS = 8000

export interface SectionActions {
  /** The Redo box's words. */
  instruction: string
  setInstruction: (value: string) => void
  /** "Save as a project rule" under the Redo box: on by default. */
  saveRule: boolean
  setSaveRule: (value: boolean) => void
  chatbot: ChatbotSpec
  /** ✦ Find more: runs on Claude, or opens the ChatGPT way without it. */
  findMore: () => void
  redo: () => void
  /** Opens the ChatGPT panel for `mode`, with the user's words or an edited prompt. */
  openChatbot: (mode: AiMode, instruction?: string | null, edited?: string | null) => void
  runPrompt: (prompt: string, edited: boolean) => void
  resetPrompt: () => void
  readChatbot: (text: string) => void
  /** The last ✕ Remove, while its Undo lasts. */
  removal: Removal | null
  offerUndo: (removal: Removal) => void
  clearUndo: () => void
}

const INTRO_MORE = 'Copy the prompt into your own chatbot, then paste its answer here.'

/**
 * The ✦ actions of one section card, wired to its URL panels: what each
 * button does with Claude, and what it does without (the ChatGPT way).
 * A panel closes once its run worked; on an error it stays open.
 */
export function useSectionActions(
  env: SectionEnv,
  section: SetupSectionId,
  ai: SectionAi,
  url: SectionUrl
): SectionActions {
  const { onDraft } = env
  const saved = env.draft.prompts[section] ?? null
  const [instruction, setInstruction] = useState('')
  const [saveRule, setSaveRule] = useState(true)
  const [chat, setChat] = useState<ChatbotSpec | null>(null)
  const [removal, setRemoval] = useState<Removal | null>(null)
  const timer = useRef<number | null>(null)

  const clearUndo = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setRemoval(null)
  }, [])

  const offerUndo = useCallback((next: Removal) => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    setRemoval(next)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setRemoval(null)
    }, UNDO_MS)
  }, [])

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  const openChatbot = useCallback(
    (mode: AiMode, words: string | null = null, edited: string | null = null) => {
      const trimmed = words && words.trim().length > 0 ? words.trim() : null
      setChat({
        mode,
        instruction: trimmed,
        edited: edited ?? saved,
        intro:
          mode === 'redo'
            ? `Redo with your own chatbot${trimmed ? `, with your words: “${trimmed}”` : ''}. Your edits, own items and ticks are kept.`
            : INTRO_MORE
      })
      url.openPanel('chatgpt')
    },
    [saved, url]
  )

  const findMore = useCallback(() => {
    if (!ai.available) {
      openChatbot('more')
      return
    }
    url.closePanel()
    void ai.run('more', null)
  }, [ai, url, openChatbot])

  const redo = useCallback(() => {
    // The words become a project rule: every later AI prompt for the project keeps them.
    if (saveRule && instruction.trim().length > 0) {
      onDraft((draft) => withRule(draft, instruction))
    }
    if (!ai.available) {
      openChatbot('redo', instruction)
      return
    }
    void ai.run('redo', instruction).then((ok) => {
      if (!ok) return
      setInstruction('')
      url.closePanel()
    })
  }, [ai, url, instruction, openChatbot, saveRule, onDraft])

  const runPrompt = useCallback(
    (prompt: string, edited: boolean) => {
      onDraft((draft) => {
        const prompts = { ...draft.prompts }
        if (edited) prompts[section] = prompt
        else delete prompts[section]
        return { ...draft, prompts }
      })
      void ai.run('redo', null, edited ? prompt : null).then((ok) => {
        if (ok) url.closePanel()
      })
    },
    [ai, url, onDraft, section]
  )

  const resetPrompt = useCallback(() => {
    onDraft((draft) => {
      if (draft.prompts[section] === undefined) return draft
      const prompts = { ...draft.prompts }
      delete prompts[section]
      return { ...draft, prompts }
    })
  }, [onDraft, section])

  const chatbot: ChatbotSpec = chat ?? {
    mode: 'more',
    instruction: null,
    edited: saved,
    intro: INTRO_MORE
  }

  const readChatbot = useCallback(
    (text: string) => {
      void ai.read(text, chatbot.mode).then((ok) => {
        if (ok) url.closePanel()
      })
    },
    [ai, url, chatbot.mode]
  )

  return {
    instruction,
    setInstruction,
    saveRule,
    setSaveRule,
    chatbot,
    findMore,
    redo,
    openChatbot,
    runPrompt,
    resetPrompt,
    readChatbot,
    removal,
    offerUndo,
    clearUndo
  }
}
