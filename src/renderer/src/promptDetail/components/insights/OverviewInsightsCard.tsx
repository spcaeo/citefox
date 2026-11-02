import { useMemo, type JSX } from 'react'
import { observeOverview } from '@shared/aio-observations'
import type { AioOverview } from '@shared/aio-overview'
import { overviewFromText } from '@shared/aio-passages'
import type { OverviewLens, SampleCapture } from '@shared/domain'
import type { AssistClient } from '../../../assist/client'
import { formatStamp } from '../../../m3/model'
import { AiMenu, SuggestionCard } from '../../../ui'
import { Card } from '../OverviewCards'
import { readItems, readMeta } from './model'
import { ObservedFacts } from './ObservedFacts'
import { OVERVIEW_READ_ASSIST, useOverviewRead, type ShownRead } from './useOverviewRead'

/**
 * "What this overview says about you" (owner feedback), below the overview: what
 * code observes in this sample (always shown, no Claude call), and the one AI menu
 * line "Analyse with Claude", whose checked answer is saved per sample.
 */
export function OverviewInsightsCard({
  sample,
  overview,
  lens,
  read,
  onRead,
  projectId,
  pageId,
  marketId,
  promptId,
  assistClient
}: {
  sample: SampleCapture
  /** The parsed overview. Null reads the flattened text, with no citations. */
  overview: AioOverview | null
  lens: OverviewLens
  /** The saved or fresh read of this sample. */
  read: ShownRead | null
  onRead: (read: ShownRead) => void
  projectId: string
  pageId: string
  marketId: string
  promptId: string
  assistClient?: AssistClient
}): JSX.Element {
  const seen = useMemo(
    () =>
      observeOverview({
        overview: overview ?? { ...overviewFromText(sample.aioText ?? ''), sources: [] },
        lens,
        references: sample.references
      }),
    [overview, sample, lens]
  )
  const state = useOverviewRead({
    projectId,
    pageId,
    marketId,
    promptId,
    sampleId: sample.id,
    saved: read,
    onFresh: onRead,
    ...(assistClient ? { client: assistClient } : {})
  })
  const { assist, shown } = state
  const canRead = overview !== null
  return (
    <Card
      headingId="pd-insights-h"
      title="What this overview says about you"
      className="ins-card"
      aside={
        <AiMenu
          label="AI actions for this overview"
          actions={[
            {
              id: OVERVIEW_READ_ASSIST,
              label: 'Analyse with CiteFox AI',
              seconds: 12,
              ...(canRead ? {} : { disabled: true }),
              onSelect: () => state.run()
            }
          ]}
        />
      }
    >
      <ObservedFacts seen={seen} lens={lens} productName={lens.productName} />
      {assist.phase === 'running' || assist.phase === 'error' ? (
        <SuggestionCard
          title="Analysis with CiteFox AI"
          status={assist.phase === 'running' ? 'running' : 'error'}
          error={assist.error}
          progress={assist.progress}
          reads="no new searches"
          {...(assist.description
            ? { expectedSeconds: assist.description.label.expectedSeconds }
            : {})}
          onRetry={(instruction) => state.run(instruction ?? null)}
          onClose={state.dismiss}
        />
      ) : shown ? (
        <SuggestionCard
          title="Analysis with CiteFox AI"
          meta={readMeta(shown.ranAt, shown.read, formatStamp)}
          body={shown.read.positioning}
          items={readItems(shown.read)}
          footnote={shown.footnote ?? 'Saved with this sample · no new call'}
          onRetry={(instruction) => state.run(instruction ?? null)}
          onClose={state.dismiss}
        />
      ) : canRead ? null : (
        <p className="ins-hint">
          Analysis with CiteFox AI needs the overview’s stored search data, which this sample does
          not have.
        </p>
      )}
    </Card>
  )
}
