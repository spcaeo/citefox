import { useState, type JSX } from 'react'
import type { AssistItem } from '@shared/ipc'
import type { AssistClient } from '../../assist/client'
import { AiMenu, SuggestionCard, useAiSuggestion } from '../../ui'
import { mergeImproveLines } from '../utils/mergeImprove'
import { IMPROVE_APPLIED_NOTE } from '../utils/stepCopy'

/** The editor's one AI action, its menu line and the suggestion card's title. */
export const IMPROVE_LABEL = 'Improve this template with CiteFox AI'

/**
 * "Improve this template with Claude" (FR-26.7) as the editor's one AI menu.
 * Claude proposes lines to add or remove; nothing changes until Apply. Apply
 * merges the ticked lines into the draft (not a save) and Undo puts the
 * previous draft back.
 */
export function useImproveMenu({
  kind,
  projectId,
  body,
  disabled,
  assistClient,
  onBody
}: {
  kind: string
  projectId: string | null
  body: string
  disabled: boolean
  assistClient?: AssistClient
  onBody: (next: string) => void
}): { menu: JSX.Element; card: JSX.Element | null } {
  const [applied, setApplied] = useState(false)
  const [before, setBefore] = useState<string | null>(null)
  const suggestion = useAiSuggestion(
    {
      assistId: 'template.improve',
      projectId,
      inputs: { kind, body },
      ...(assistClient ? { client: assistClient } : {}),
      onResult: () => setApplied(false)
    },
    IMPROVE_LABEL
  )
  const { assist } = suggestion

  function apply(ids: readonly string[]): void {
    const items: readonly AssistItem[] = (assist.result?.items ?? []).filter(
      (item) => ids.length === 0 || ids.includes(item.id)
    )
    setBefore(body)
    onBody(mergeImproveLines(body, items))
    setApplied(true)
  }

  function undo(): void {
    if (before !== null) onBody(before)
    setBefore(null)
    setApplied(false)
  }

  const menu = (
    <AiMenu
      label="AI actions for this template"
      actions={[
        {
          id: 'template.improve',
          label: IMPROVE_LABEL,
          ...(assist.description ? { seconds: assist.description.label.expectedSeconds } : {}),
          disabled,
          onSelect: () => assist.run()
        }
      ]}
    />
  )

  const card = suggestion.open ? (
    <div className="tpl-improve">
      <SuggestionCard
        {...suggestion.card}
        title={IMPROVE_LABEL}
        onApply={apply}
        onUndo={undo}
        onClose={() => {
          assist.close()
          setApplied(false)
          setBefore(null)
        }}
      />
      {applied ? (
        <p className="tpl-saved" role="status">
          {IMPROVE_APPLIED_NOTE}
        </p>
      ) : null}
    </div>
  ) : null

  return { menu, card }
}
