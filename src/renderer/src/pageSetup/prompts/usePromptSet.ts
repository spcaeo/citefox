import { useCallback, useEffect, useState } from 'react'
import type { BuyerProfile, BuyerPrompt, CoverageLevel, PromptSetView } from '@shared/domain'
import type { AssistItem, PageDetail } from '@shared/ipc'
import { errorText as loadErrorText } from '../../components/errorText'
import type { ShellClient } from '../../projects/client'
import { pageGenerationRequest } from '../../templates/model'
import { onTopicsChanged } from '../../topics/clusters/events'
import { promptFromItem } from '../assistMapping'
import { validatePromptCount } from '../promptCount'
import { errorText } from '../text'

type Undo = () => Promise<void>

export interface PromptSetState {
  view: PromptSetView | null
  profile: BuyerProfile | null
  coverage: ReadonlyMap<string, CoverageLevel>
  loadError: string | null
  error: string | null
  reload: () => void
  setView: (next: PromptSetView) => void
  edit: (prompt: BuyerPrompt, marketId: string, text: string) => Promise<boolean>
  setEnabled: (ids: readonly string[], enabled: boolean) => Promise<void>
  remove: (ids: readonly string[]) => Promise<void>
  move: (promptId: string, delta: number) => Promise<void>
  addOwn: (text: string) => Promise<boolean>
  addSuggested: (item: AssistItem) => Promise<Undo | void>
  applyRephrase: (prompt: BuyerPrompt, marketId: string, text: string) => Promise<Undo>
  save: () => Promise<void>
  discard: () => Promise<void>
  regenerate: (templateId: string) => Promise<boolean>
  saveCount: (text: string) => Promise<string | null>
}

/**
 * The Prompts tab's data: the active prompt set, the buyer profile summary, and
 * each prompt's coverage from Content gaps, with every edit the review allows.
 * Edits stay a draft until Save writes the next version (the before/after baseline).
 */
export function usePromptSet(
  client: ShellClient,
  projectId: string,
  page: PageDetail,
  onChanged: () => void
): PromptSetState {
  const [view, setViewState] = useState<PromptSetView | null>(null)
  const [profile, setProfile] = useState<BuyerProfile | null>(null)
  const [coverage, setCoverage] = useState<ReadonlyMap<string, CoverageLevel>>(new Map())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const pageId = page.id

  // Questions added elsewhere (Ask CiteFox, the Questions screen) show at once.
  useEffect(() => onTopicsChanged(() => setAttempt((value) => value + 1)), [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      client.listPrompts({ projectId, pageId }),
      client.getGaps({ projectId, pageId }),
      client.getBuyerProfile({ projectId, pageId }).catch(() => null)
    ]).then(
      ([prompts, gaps, buyer]) => {
        if (cancelled) return
        setViewState(prompts)
        setCoverage(new Map((gaps?.rows ?? []).map((row) => [row.promptId, row.coverage])))
        setProfile(buyer)
        setLoadError(null)
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(loadErrorText(cause, 'Could not load questions.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, pageId, attempt])

  const setView = useCallback(
    (next: PromptSetView): void => {
      setViewState(next)
      onChanged()
    },
    [onChanged]
  )

  async function run(action: () => Promise<PromptSetView>, fallback: string): Promise<boolean> {
    setError(null)
    try {
      setView(await action())
      return true
    } catch (cause: unknown) {
      setError(errorText(cause, fallback))
      return false
    }
  }

  const prompts = view?.prompts ?? []

  return {
    view,
    profile,
    coverage,
    loadError,
    error,
    reload: () => setAttempt((current) => current + 1),
    setView,
    edit: (prompt, marketId, text) =>
      run(
        () =>
          client.editPrompt({
            projectId,
            pageId,
            promptId: prompt.id,
            variant: { marketId, text }
          }),
        'Could not edit the question.'
      ),
    async setEnabled(ids, enabled) {
      for (const promptId of ids) {
        const ok = await run(
          () => client.setPromptEnabled({ projectId, pageId, promptId, enabled }),
          'Could not update the question.'
        )
        if (!ok) return
      }
    },
    async remove(ids) {
      for (const promptId of ids) {
        const ok = await run(
          () => client.removePrompt({ projectId, pageId, promptId }),
          'Could not delete the question.'
        )
        if (!ok) return
      }
    },
    async move(promptId, delta) {
      const ids = prompts.map((prompt) => prompt.id)
      const index = ids.indexOf(promptId)
      const next = index + delta
      if (index < 0 || next < 0 || next >= ids.length) return
      const swapped = [...ids]
      const moving = swapped[index]
      const target = swapped[next]
      if (!moving || !target) return
      swapped[index] = target
      swapped[next] = moving
      await run(
        () => client.reorderPrompts({ projectId, pageId, promptIds: swapped }),
        'Could not reorder questions.'
      )
    },
    addOwn: (text) =>
      run(
        () =>
          client.addPrompt({
            projectId,
            pageId,
            label: text.slice(0, 60),
            text,
            source: 'written_by_user',
            intentStage: 'unset',
            mappedElement: ''
          }),
        'Could not add the question.'
      ),
    async addSuggested(item) {
      const before = new Set(prompts.map((prompt) => prompt.id))
      const next = await client.addPrompt({ projectId, pageId, ...promptFromItem(item) })
      setView(next)
      const added = next.prompts.find((prompt) => !before.has(prompt.id))
      if (!added) return
      return async () => {
        setView(await client.removePrompt({ projectId, pageId, promptId: added.id }))
      }
    },
    async applyRephrase(prompt, marketId, text) {
      const previous =
        prompt.variants.find((variant) => variant.marketId === marketId)?.text ??
        prompt.variants[0]?.text ??
        ''
      const write = (value: string): Promise<PromptSetView> =>
        client.editPrompt({
          projectId,
          pageId,
          promptId: prompt.id,
          variant: { marketId, text: value }
        })
      setView(await write(text))
      return async () => {
        setView(await write(previous))
      }
    },
    save: async () => {
      await run(() => client.savePrompts({ projectId, pageId }), 'Could not save questions.')
    },
    discard: async () => {
      await run(() => client.discardPrompts({ projectId, pageId }), 'Could not discard changes.')
    },
    regenerate: (templateId) =>
      run(
        () => client.generatePrompts(pageGenerationRequest(projectId, pageId, templateId)),
        'Could not write the questions again.'
      ),
    async saveCount(text) {
      const parsed = validatePromptCount(text)
      if (!parsed.ok) return parsed.error
      try {
        await client.updatePage({ projectId, pageId, promptCount: parsed.count })
        onChanged()
        return null
      } catch (cause: unknown) {
        return errorText(cause, 'Could not save the question count.')
      }
    }
  }
}
