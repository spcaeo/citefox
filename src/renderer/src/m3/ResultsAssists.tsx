import type { JSX } from 'react'
import type { AssistClient } from '../assist/client'
import { useAssistMenu, type AssistMenuAction } from '../ui'

/** Who the results assists run for. Projectless harnesses pass nothing and show none. */
export interface ResultsAssistScope {
  projectId: string
  pageId: string
  marketId: string
  client?: AssistClient
}

/**
 * The summary line's one AI menu (FR-25): "Explain this change" when there is
 * an earlier check to compare with, and "Summarize this run". Both read saved
 * results only; the answer shows as one suggestion card.
 */
export function RunAssists({
  scope,
  hasPrevious
}: {
  scope: ResultsAssistScope
  hasPrevious: boolean
}): JSX.Element {
  const actions: AssistMenuAction[] = [
    ...(hasPrevious
      ? [{ assistId: 'results.explainChange', label: 'Explain this change', seconds: 8 }]
      : []),
    { assistId: 'report.summary', label: 'Summarize this run', seconds: 15 }
  ]
  const { menu, card } = useAssistMenu({
    label: 'AI actions for the summary',
    scope: {
      projectId: scope.projectId,
      pageId: scope.pageId,
      marketId: scope.marketId,
      ...(scope.client ? { client: scope.client } : {})
    },
    actions,
    footer: 'Reads saved results only. Uses no searches.'
  })
  return (
    <>
      <div className="m3-summary-ai">{menu}</div>
      {card ? <div className="m3-summary-card">{card}</div> : null}
    </>
  )
}
