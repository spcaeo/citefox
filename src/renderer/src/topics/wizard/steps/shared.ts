import { useCallback, useState } from 'react'
import type { TopicDraft, TopicWizardStep } from '@shared/domain'
import type { GenerateTopicKeywordsResult, StartTopicResult, TopicDraftPatch } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import type { TopicsClient } from '../client'
import type { WizardProject, WizardStepDef } from '../types'
import { promptInput } from '../utils/patch'

/** What every step screen gets from the wizard. */
export interface StepProps {
  draft: TopicDraft
  project: WizardProject
  client: TopicsClient
  steps: readonly WizardStepDef[]
  step: TopicWizardStep
  patch: (patch: TopicDraftPatch) => void
  replace: (draft: TopicDraft) => void
  flush: () => Promise<TopicDraft | null>
  /** Opens a done step (stepper) or the next one. Saves first. */
  goTo: (step: TopicWizardStep) => void
  /** The previous step, or the chooser from the first one. */
  back: () => void
  onStarted: (result: StartTopicResult, draft: TopicDraft) => void
}

export interface PrimaryAction {
  busy: boolean
  error: string | null
  /**
   * Saves, runs `prepare` (a Claude step that returns the new draft) if given,
   * then moves to `step`.
   */
  advance: (
    step: TopicWizardStep,
    prepare?: (draftId: string) => Promise<TopicDraft>
  ) => Promise<void>
  setError: (message: string | null) => void
}

/** The footer primary's busy and error state for one step. */
export function usePrimary(
  props: Pick<StepProps, 'draft' | 'patch' | 'replace' | 'flush'>
): PrimaryAction {
  const { draft, patch, replace, flush } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const advance = useCallback<PrimaryAction['advance']>(
    async (step, prepare) => {
      setBusy(true)
      setError(null)
      try {
        await flush()
        if (prepare) replace(await prepare(draft.id))
        patch({ step })
        await flush()
      } catch (cause) {
        setError(errorText(cause, 'CiteFox AI could not finish this. Try again.'))
      } finally {
        setBusy(false)
      }
    },
    [draft.id, flush, patch, replace]
  )
  return { busy, error, advance, setError }
}

/**
 * The patch that puts prompts back the way they were in `before` (Undo after
 * Apply): lines added since are removed, changed or removed ones restored.
 * Works whatever ids main gave the added lines.
 */
export function restorePrompts(before: TopicDraft, now: TopicDraft): TopicDraftPatch {
  const beforeIds = new Map(before.prompts.map((prompt) => [prompt.id, prompt]))
  const nowIds = new Map(now.prompts.map((prompt) => [prompt.id, prompt]))
  const removePromptIds = now.prompts.filter((prompt) => !beforeIds.has(prompt.id)).map((p) => p.id)
  const upsertPrompts = before.prompts
    .filter((prompt) => {
      const current = nowIds.get(prompt.id)
      return (
        !current ||
        current.text !== prompt.text ||
        current.stage !== prompt.stage ||
        current.included !== prompt.included ||
        current.kwGroup !== prompt.kwGroup
      )
    })
    .map((prompt) => {
      const input = promptInput(prompt)
      // A removed line comes back as a new one: main gives it a fresh id.
      if (!nowIds.has(prompt.id)) delete input.id
      return input
    })
  const patch: TopicDraftPatch = {}
  if (removePromptIds.length > 0) patch.removePromptIds = removePromptIds
  if (upsertPrompts.length > 0) patch.upsertPrompts = upsertPrompts
  return patch
}

/**
 * Generate keywords (spec §3, Keywords & groups). Main expands kept core
 * terms, so a draft with none first runs "Discover core terms & synonyms"
 * and keeps what Claude found; the user can change them on Depth settings.
 */
export async function generateKeywords(
  client: TopicsClient,
  projectId: string,
  draftId: string,
  replace = false
): Promise<GenerateTopicKeywordsResult> {
  const draft = await client['topics:getDraft']({ projectId, draftId })
  if (!draft.keywordTerms.some((term) => term.kept)) {
    const found = await client['topics:discoverTerms']({ projectId, draftId })
    await client['topics:updateDraft']({
      projectId,
      draftId,
      patch: { keywordTerms: found.terms.map((term) => ({ ...term, kept: true })) }
    })
  }
  return client['topics:generateKeywords']({ projectId, draftId, replace })
}
