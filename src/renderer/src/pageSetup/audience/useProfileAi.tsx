import { useState, type JSX } from 'react'
import type { TriggerSuggestion } from '@shared/ipc'
import type { AssistClient } from '../../assist/client'
import { errorText } from '../../components/errorText'
import { AiMenu, SuggestionCard, useAiSuggestion, type AiAction } from '../../ui'

type Active = 'sharpen' | 'triggers' | null

export interface ProfileAi {
  /** The buyer profile's one AI menu (grid toolbar). */
  menu: JSX.Element
  /** The open suggestion card, or null. */
  card: JSX.Element | null
}

/**
 * The profile's one AI menu (owner feedback 5, TOPICS-SPEC §1): "Sharpen with
 * Claude" (the `audience.sharpen` assist) and "Find more trigger events". Each
 * answer is one dismissible suggestion card; nothing changes until Apply, and
 * Undo puts the profile back.
 */
export function useProfileAi({
  projectId,
  pageId,
  assistClient,
  applySharpen,
  findTriggers,
  addTriggers,
  leadActions = []
}: {
  projectId: string
  pageId: string
  assistClient?: AssistClient
  /** Writes the chosen assist items; resolves to the undo. */
  applySharpen: (itemIds: readonly string[], items: SharpenItems) => Promise<() => Promise<void>>
  findTriggers: () => Promise<readonly TriggerSuggestion[]>
  /** Adds the chosen triggers; resolves to the undo. */
  addTriggers: (texts: readonly string[]) => Promise<() => Promise<void>>
  /** Actions listed first, such as ✦ Help me fill this. */
  leadActions?: readonly AiAction[]
}): ProfileAi {
  const [active, setActive] = useState<Active>(null)
  const [undo, setUndo] = useState<(() => Promise<void>) | null>(null)
  const [triggers, setTriggers] = useState<readonly TriggerSuggestion[] | null>(null)
  const [triggerError, setTriggerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sharpen = useAiSuggestion(
    {
      assistId: 'audience.sharpen',
      projectId,
      pageId,
      ...(assistClient ? { client: assistClient } : {})
    },
    'Sharpen with CiteFox AI'
  )

  function close(): void {
    sharpen.assist.close()
    setActive(null)
    setUndo(null)
    setTriggers(null)
    setTriggerError(null)
  }

  async function loadTriggers(): Promise<void> {
    setTriggers(null)
    setTriggerError(null)
    setBusy(true)
    try {
      setTriggers(await findTriggers())
    } catch (cause) {
      setTriggerError(errorText(cause, 'Could not find trigger events.'))
    } finally {
      setBusy(false)
    }
  }

  const menu = (
    <AiMenu
      label="AI actions for the buyer profile"
      actions={[
        ...leadActions,
        {
          id: 'sharpen',
          label: 'Sharpen with CiteFox AI',
          seconds: 10,
          icon: 'wand',
          onSelect: () => {
            close()
            setActive('sharpen')
            sharpen.assist.run()
          }
        },
        {
          id: 'triggers',
          label: 'Find more trigger events',
          seconds: 10,
          icon: 'compass',
          onSelect: () => {
            close()
            setActive('triggers')
            void loadTriggers()
          }
        }
      ]}
    />
  )

  let card: JSX.Element | null = null
  if (active === 'sharpen' && sharpen.open) {
    const result = sharpen.assist.result
    card = (
      <SuggestionCard
        {...sharpen.card}
        title="Sharpen with CiteFox AI"
        meta="Applying a change doesn’t rewrite saved questions."
        {...(result
          ? {
              onApply: (ids: string[]) => {
                void applySharpen(ids, result.items).then(
                  (restore) => setUndo(() => restore),
                  () => undefined
                )
              }
            }
          : {})}
        {...(undo ? { onUndo: () => void undo().then(() => setUndo(null)) } : {})}
        onClose={close}
      />
    )
  }
  if (active === 'triggers') {
    card = (
      <SuggestionCard
        title="Find more trigger events"
        meta="Adding a trigger doesn’t change saved questions."
        status={busy ? 'running' : triggerError ? 'error' : 'ready'}
        error={triggerError}
        items={(triggers ?? []).map((item) => ({
          id: item.text,
          label: 'Trigger event',
          text: item.text,
          detail: item.reason
        }))}
        footnote="CiteFox AI · on your plan · no searches"
        {...(triggers && triggers.length > 0
          ? {
              onApply: (ids: string[]) => {
                void addTriggers(ids).then(
                  (restore) => setUndo(() => restore),
                  () => undefined
                )
              },
              applyLabel: 'Add'
            }
          : {})}
        {...(undo ? { onUndo: () => void undo().then(() => setUndo(null)) } : {})}
        onRetry={() => void loadTriggers()}
        onClose={close}
      />
    )
  }
  return { menu, card }
}

/** The assist answer's items, as `useAiSuggestion` holds them. */
export type SharpenItems = NonNullable<
  ReturnType<typeof useAiSuggestion>['assist']['result']
>['items']
