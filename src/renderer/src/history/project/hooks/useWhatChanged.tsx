import type { JSX } from 'react'
import type { AssistClient } from '../../../assist/client'
import { AiMenu, SuggestionCard } from '../../../ui'
import { useAiSuggestion } from '../../../ui/useAiSuggestion'
import { ChangedBody } from '../components/WhatChangedBody'

export const WHAT_CHANGED_ASSIST = 'history.whatChanged'

/** The honest label on the answer: it is AI-written, from saved checks, numbers checked. */
export const WHAT_CHANGED_META =
  'Written by AI from your saved checks. CiteFox checks every number against them.'

/** What "What changed" reads: the screen's page or topic, market and scope filters. */
export interface WhatChangedScope {
  projectId: string
  pageId: string | null
  marketId: string | null
  scope: 'pages' | 'topics' | null
  /** Tests only. Production picks the client from the client mode. */
  client?: AssistClient
}

/**
 * Check history's one AI menu: "What changed" asks Claude to sum up the last
 * two full checks of each page or topic in view. Main counts the pairs and
 * takes out any sentence whose number is not in the saved checks (it says so
 * in the warning row). Read-only: nothing is applied.
 */
export function useWhatChanged(scope: WhatChangedScope): {
  menu: JSX.Element
  card: JSX.Element | null
} {
  const suggestion = useAiSuggestion(
    {
      assistId: WHAT_CHANGED_ASSIST,
      projectId: scope.projectId,
      pageId: scope.pageId,
      marketId: scope.marketId,
      promptId: null,
      inputs: scope.scope === null ? {} : { scope: scope.scope },
      ...(scope.client ? { client: scope.client } : {})
    },
    'What changed'
  )
  const { run, close, result } = suggestion.assist
  const menu = (
    <AiMenu
      label="AI actions for Check history"
      footer="Written by AI from your saved checks. Uses no searches."
      actions={[
        { id: WHAT_CHANGED_ASSIST, label: 'What changed', seconds: 10, onSelect: () => run() }
      ]}
    />
  )
  const view = suggestion.card
  const card = suggestion.open ? (
    <SuggestionCard
      title="What changed"
      meta={WHAT_CHANGED_META}
      status={view.status}
      error={view.error ?? null}
      {...(view.progress ? { progress: view.progress } : {})}
      {...(view.reads ? { reads: view.reads } : {})}
      {...(view.expectedSeconds ? { expectedSeconds: view.expectedSeconds } : {})}
      {...(view.footnote ? { footnote: view.footnote } : {})}
      {...(result ? { body: <ChangedBody result={result} /> } : {})}
      {...(result?.caution ? { recheck: result.caution } : {})}
      onRetry={(instruction) => run(instruction ?? null)}
      onClose={close}
    />
  ) : null
  return { menu, card }
}
