import { useEffect, useState, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { AssistClient } from '../../assist/client'
import { marketLabel } from '../../shell/model'
import { SuggestionCard, useAiSuggestion } from '../../ui'

export type MarketAssistId = 'markets.whatsDifferent' | 'markets.localPrompts'

function titleOf(assistId: MarketAssistId, market: Market): string {
  const name = marketLabel(market)
  return assistId === 'markets.whatsDifferent'
    ? `What's different in ${name}?`
    : `Local questions for ${name}`
}

/**
 * The per-market assists a market row's `⋯` menu runs (FR-25): "What's different"
 * and "Write local prompts" for one market. The answer shows as one dismissible
 * suggestion card. Uses the checks already saved; changes nothing.
 */
export function useMarketAssist({
  projectId,
  pageId,
  client
}: {
  projectId: string
  pageId: string
  client?: AssistClient
}): {
  start: (assistId: MarketAssistId, market: Market) => void
  card: JSX.Element | null
} {
  const [active, setActive] = useState<{
    assistId: MarketAssistId
    market: Market
    run: number
  } | null>(null)
  const suggestion = useAiSuggestion(
    {
      assistId: active?.assistId ?? 'markets.whatsDifferent',
      projectId,
      pageId,
      marketId: active?.market.id ?? null,
      ...(client ? { client } : {})
    },
    active ? titleOf(active.assistId, active.market) : undefined
  )
  const { run, close } = suggestion.assist
  const runCount = active?.run ?? 0

  // Runs after the render that switched the assist and market, so the run reads them.
  useEffect(() => {
    if (runCount > 0) run()
  }, [runCount, run])

  const card =
    active && suggestion.open ? (
      <SuggestionCard
        {...suggestion.card}
        title={titleOf(active.assistId, active.market)}
        onClose={() => {
          close()
          setActive(null)
        }}
      />
    ) : null

  return {
    start: (assistId, market) =>
      setActive((current) => ({ assistId, market, run: (current?.run ?? 0) + 1 })),
    card
  }
}
