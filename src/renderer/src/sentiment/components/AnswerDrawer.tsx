import type { JSX } from 'react'
import type { SentimentClaim, SentimentOverview } from '@shared/domain'
import { rankLabel, type AnswerRow } from '@shared/sentiment-metrics'
import { openTarget, type DrillTarget } from '../../drill'
import { Drawer, DrawerGrid, DrawerMain, DrawerRail, DrawerSection } from '../../ui'
import { SOURCE_KIND_LABEL, TONE_LABEL } from '../constants'
import { ClaimSource } from './ClaimSource'
import { SourceUrl } from './drillBits'

/**
 * One answer in the shared Drawer (`drawer=st-answer&sa.id=<overview>`),
 * opened from Answer by answer: why the brand sits where it does and every
 * claim about it with its tone on the left; the brands named in rank order
 * and the sources Google listed on the right.
 */
export function AnswerDrawer({
  brand,
  row,
  overview,
  claims,
  promptTarget,
  onClose
}: {
  brand: string
  /** Null: the answer on the URL is not in this check or filter (a stale link). */
  row: AnswerRow | null
  overview: SentimentOverview | undefined
  /** The own-brand claims in this answer. */
  claims: readonly SentimentClaim[]
  promptTarget: DrillTarget | null
  onClose: () => void
}): JSX.Element {
  const answers = { label: 'Answers', onSelect: onClose }
  if (row === null || overview === undefined) {
    return (
      <Drawer
        id="st-answer"
        title="Answer"
        trail={[answers]}
        testId="st-answer-drawer"
        error={{ message: 'This answer is not in this check or filter.' }}
        onClose={onClose}
      />
    )
  }
  const kind = row.source === 'brand' ? 'Brand question' : 'Buyer question'
  return (
    <Drawer
      id="st-answer"
      title={row.promptText}
      trail={[answers]}
      subtitle={`${kind} · ${brand} ${rankLabel(row) === 'Named' ? 'is named' : `ranks ${rankLabel(row)}`} · ${TONE_LABEL[row.tone]}`}
      testId="st-answer-drawer"
      focusOnOpen="close"
      onClose={onClose}
      footer={{
        summary: (
          <>
            <strong className="num">{claims.length}</strong>{' '}
            {claims.length === 1 ? 'claim' : 'claims'} about {brand} ·{' '}
            <span className="num">{overview.references.length}</span>{' '}
            {overview.references.length === 1 ? 'source' : 'sources'}
          </>
        ),
        ...(promptTarget
          ? {
              cancel: 'Close',
              secondary: {
                label: 'Open question detail',
                icon: 'external' as const,
                onClick: () => openTarget(promptTarget)
              }
            }
          : {})
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection title={`Why ${brand} sits there`}>
            <p className="st-small">
              {overview.reason ?? 'CiteFox AI has not read this overview yet.'}
            </p>
          </DrawerSection>
          <DrawerSection
            title={`Claims about ${brand}`}
            count={claims.length}
            description="Word for word from the overview, with the tone CiteFox AI gave each one."
          >
            {claims.length === 0 ? (
              <p className="st-note">No claim about {brand} in this answer.</p>
            ) : (
              <ul className="st-sentences" aria-label={`Claims about ${brand}`}>
                {claims.map((claim) => (
                  <li key={claim.id}>
                    <p className="st-meta">
                      <span className={`st-tone st-tone-${claim.tone}`}>
                        {TONE_LABEL[claim.tone]}
                      </span>
                      <span>
                        {claim.theme} · {claim.attribute}
                      </span>
                    </p>
                    <p className="st-quote">&ldquo;{claim.sentence}&rdquo;</p>
                    <p className="st-note">
                      <ClaimSource claim={claim} />
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="About this answer">
          <DrawerSection title="Brands named, in rank order" count={overview.brandsNamed.length}>
            {overview.brandsNamed.length > 0 ? (
              <ol className="st-ranked">
                {overview.brandsNamed.map((name) => (
                  <li key={name} className={name === brand ? 'st-ranked-own' : undefined}>
                    {name}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="st-note">No tracked brand is ranked in this answer.</p>
            )}
          </DrawerSection>
          <DrawerSection title="Sources Google listed" count={overview.references.length}>
            {overview.references.length > 0 ? (
              <ol className="st-sources">
                {overview.references.map((ref) => (
                  <li key={`${ref.position}:${ref.url}`} className="st-source-card">
                    <SourceUrl url={ref.url} />
                    <span className="st-note">{SOURCE_KIND_LABEL[ref.sourceType]}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="st-note">Google listed no sources for this overview.</p>
            )}
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}
