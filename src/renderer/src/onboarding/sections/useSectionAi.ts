import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  HelpFillEstimate,
  SetupRow,
  SetupSectionId,
  SetupSectionPrompt,
  SetupSectionResult
} from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { contextFromDraft, rulesOf } from '../setupDraft'
import type { SectionEnv } from './types'

export type AiMode = 'more' | 'redo'

/** What a section does with a result. Returns the line to show and announce. */
export type ApplyResult = (result: SetupSectionResult, mode: AiMode) => string

export interface SectionAi {
  /** Null while it loads. */
  estimate: HelpFillEstimate | null
  /** False when Claude is not set up: every ✦ action then goes the ChatGPT way. */
  available: boolean
  /** "1 Claude call · on your Claude plan", shown before anything runs. */
  costText: string
  /** Why Claude is not available, in plain words. */
  reason: string | null
  /** What is running now. */
  busy: AiMode | 'read' | null
  error: string | null
  /** The last result, in words ("2 competitors added at the top"). */
  note: string | null
  warnings: readonly string[]
  run: (mode: AiMode, instruction: string | null, prompt?: string | null) => Promise<boolean>
  /** A chatbot's pasted answer, merged like `mode`. */
  read: (text: string, mode: AiMode) => Promise<boolean>
  loadPrompt: (mode: AiMode, instruction: string | null) => Promise<SetupSectionPrompt>
  /** Clears the note, the warnings and the error. */
  dismiss: () => void
}

export const COST_LOADING = 'Checking the cost…'

/**
 * One section's Claude work: the cost before anything runs
 * (`onboarding:sectionEstimate`, fetched once), ✦ Find more and ✦ Redo
 * (`sectionRun`), the prompt (`sectionPrompt`) and a pasted ChatGPT answer
 * (`sectionRead`). The rows Claude sees come from the draft at the moment of
 * the call; `current` says which of the section's rows to send.
 */
export function useSectionAi(
  env: SectionEnv,
  section: SetupSectionId,
  current: (mode: AiMode) => SetupRow[],
  apply: ApplyResult
): SectionAi {
  const { client, announce } = env
  const [estimate, setEstimate] = useState<HelpFillEstimate | null>(null)
  const [busy, setBusy] = useState<SectionAi['busy']>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<readonly string[]>([])
  const live = useRef(true)
  // The latest draft, prompts and callbacks, so a slow call never uses stale ones.
  const latest = useRef({ env, current, apply })
  useLayoutEffect(() => {
    latest.current = { env, current, apply }
  })

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    client
      .sectionEstimate({ section })
      .then((next) => {
        if (alive) setEstimate(next)
      })
      .catch((cause: unknown) => {
        if (!alive) return
        setEstimate({
          kind: section,
          available: false,
          calls: 0,
          costText: '',
          reason: errorText(cause, 'CiteFox could not check the AI.', { sentence: true })
        })
      })
    return () => {
      alive = false
    }
  }, [client, section])

  const request = useCallback(
    (mode: AiMode, instruction: string | null) => {
      const { env: now, current: rows } = latest.current
      return {
        section,
        context: contextFromDraft(now.draft),
        mode,
        instruction: instruction && instruction.trim().length > 0 ? instruction.trim() : null,
        current: rows(mode),
        // Redo words saved as project rules go in every later section prompt.
        ...rulesOf(now.draft)
      }
    },
    [section]
  )

  const finish = useCallback(
    (result: SetupSectionResult, mode: AiMode) => {
      const said = latest.current.apply(result, mode)
      setNote(said)
      setWarnings(result.warnings)
      announce(said)
    },
    [announce]
  )

  const fail = useCallback(
    (cause: unknown) => {
      const message = errorText(cause, 'That did not work. Try again.', { sentence: true })
      setError(message)
      announce(message)
    },
    [announce]
  )

  const run = useCallback(
    async (mode: AiMode, instruction: string | null, prompt?: string | null) => {
      setBusy(mode)
      setError(null)
      setNote(null)
      setWarnings([])
      const saved = latest.current.env.draft.prompts[section] ?? null
      try {
        const result = await client.sectionRun({
          ...request(mode, instruction),
          prompt: prompt === undefined ? saved : prompt
        })
        if (!live.current) return false
        finish(result, mode)
        return true
      } catch (cause) {
        if (live.current) fail(cause)
        return false
      } finally {
        if (live.current) setBusy(null)
      }
    },
    [client, section, request, finish, fail]
  )

  const read = useCallback(
    async (text: string, mode: AiMode) => {
      setBusy('read')
      setError(null)
      setNote(null)
      setWarnings([])
      try {
        const base = request(mode, null)
        const result = await client.sectionRead({
          section,
          context: base.context,
          current: base.current,
          text
        })
        if (!live.current) return false
        finish(result, mode)
        return true
      } catch (cause) {
        if (live.current) fail(cause)
        return false
      } finally {
        if (live.current) setBusy(null)
      }
    },
    [client, section, request, finish, fail]
  )

  const loadPrompt = useCallback(
    (mode: AiMode, instruction: string | null) => client.sectionPrompt(request(mode, instruction)),
    [client, request]
  )

  const dismiss = useCallback(() => {
    setNote(null)
    setWarnings([])
    setError(null)
  }, [])

  return {
    estimate,
    available: estimate?.available ?? true,
    costText: estimate === null ? COST_LOADING : estimate.costText || COST_LOADING,
    reason: estimate?.available === false ? estimate.reason : null,
    busy,
    error,
    note,
    warnings,
    run,
    read,
    loadPrompt,
    dismiss
  }
}

/**
 * The text for the user's own chatbot: the prompt (their edit, when they made
 * one) plus the reply line, so the answer comes back in columns CiteFox reads.
 */
export function chatbotText(prompt: SetupSectionPrompt, edited: string | null): string {
  const body = (edited ?? prompt.prompt).trim()
  if (prompt.columns.length === 0) return body
  if (prompt.columns.length === 1 && prompt.columns[0] === 'text') {
    return /^reply\b/imu.test(body) ? body : `${body}\n\nReply with the text only.`
  }
  const header = prompt.columns.join(',')
  return body.includes(header) ? body : `${body}\n\nReply with CSV only, this header: ${header}`
}
