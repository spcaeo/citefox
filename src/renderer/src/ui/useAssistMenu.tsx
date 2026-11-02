import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { AssistInputs, AssistResult } from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import { AiMenu } from './AiMenu'
import { SuggestionCard } from './SuggestionCard'
import type { UiIconName } from './UiIcon'
import { useAiSuggestion } from './useAiSuggestion'

/** Who an assist runs for. Pass the ids the assist needs; leave the rest out. */
export interface AssistMenuScope {
  projectId: string | null
  pageId?: string | null
  marketId?: string | null
  promptId?: string | null
  /** Tests only. Production picks the client from the client mode. */
  client?: AssistClient
}

/** One line in the section's AI menu, run through the assist channels (FR-25). */
export interface AssistMenuAction {
  assistId: string
  /** Menu text and the suggestion card's title, such as "Explain this change". */
  label: string
  /** Typical run time, shown as "15 s". */
  seconds?: number
  icon?: UiIconName
  disabled?: boolean
  inputs?: AssistInputs
  /** Shows Apply on the card. Nothing is written until the user presses it. */
  onApply?: (result: AssistResult, ids: string[]) => void
  applyLabel?: string
  /** Runs when an answer arrives, for an assist that saves where the screen reads. */
  onResult?: (result: AssistResult) => void
}

export interface AssistMenu {
  /** The section's one `AI` button. Put it in the toolbar or section header. */
  menu: JSX.Element
  /** The open suggestion card, or null while nothing has run. */
  card: JSX.Element | null
  /** The assist that ran last, while its card is open. */
  activeId: string | null
}

/**
 * The one AI menu of a section wired to the assist channels: picking a line
 * runs that assist and its answer shows as one dismissible suggestion card
 * ("Claude · about N s · no searches"). Read-only assists need no `onApply`.
 */
export function useAssistMenu({
  scope,
  actions,
  label,
  footer
}: {
  scope: AssistMenuScope
  actions: readonly AssistMenuAction[]
  /** Accessible name of the menu button. Default "AI actions". */
  label?: string
  footer?: ReactNode
}): AssistMenu {
  const [active, setActive] = useState<{ id: string; run: number } | null>(null)
  const action = actions.find((item) => item.assistId === active?.id) ?? null
  const suggestion = useAiSuggestion(
    {
      assistId: action?.assistId ?? actions[0]?.assistId ?? '',
      projectId: scope.projectId,
      pageId: scope.pageId ?? null,
      marketId: scope.marketId ?? null,
      promptId: scope.promptId ?? null,
      ...(action?.inputs ? { inputs: action.inputs } : {}),
      ...(scope.client ? { client: scope.client } : {}),
      onResult: (result: AssistResult) =>
        actions.find((item) => item.assistId === result.assistId)?.onResult?.(result)
    },
    action?.label
  )
  const { run, close } = suggestion.assist
  const runCount = active?.run ?? 0

  // Runs after the render that switched the assist id, so the run reads it.
  useEffect(() => {
    if (runCount > 0) run()
  }, [runCount, run])

  const menu = (
    <AiMenu
      {...(label ? { label } : {})}
      {...(footer !== undefined ? { footer } : {})}
      actions={actions.map((item) => ({
        id: item.assistId,
        label: item.label,
        ...(item.seconds !== undefined ? { seconds: item.seconds } : {}),
        ...(item.icon ? { icon: item.icon } : {}),
        ...(item.disabled ? { disabled: true } : {}),
        onSelect: () =>
          setActive((current) => ({ id: item.assistId, run: (current?.run ?? 0) + 1 }))
      }))}
    />
  )

  const result = suggestion.assist.result
  const card =
    action && suggestion.open ? (
      <SuggestionCard
        {...suggestion.card}
        title={action.label}
        {...(action.onApply && result
          ? {
              onApply: (ids: string[]) => action.onApply?.(result, ids),
              ...(action.applyLabel ? { applyLabel: action.applyLabel } : {})
            }
          : {})}
        onClose={() => {
          close()
          setActive(null)
        }}
      />
    ) : null

  return { menu, card, activeId: card ? (action?.assistId ?? null) : null }
}
