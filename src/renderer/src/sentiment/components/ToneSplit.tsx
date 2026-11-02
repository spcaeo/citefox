import type { JSX } from 'react'
import type { ClaimTone, SentimentClaim, SentimentOverview } from '@shared/domain'
import {
  formatNet,
  mentionShares,
  netSentiment,
  ownClaims,
  toneBuckets,
  toneCounts
} from '@shared/sentiment-metrics'
import { DrillButton, DrillNumber, useDrill, type ItemDrill } from '../../drill'
import { SectionHead } from '../../ui'
import { TONE_LABEL } from '../constants'
import type { SentimentDrills } from '../drills'
import { countNoun, pct } from '../utils/model'
import { MarkButton } from './drillBits'
import { pluralize } from '@shared/pluralize'

const TONES: readonly ClaimTone[] = ['positive', 'neutral', 'negative']
const RADIUS = 54
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Tone split donut (FR-16.4) and share of brand mentions against the competitors. */
export function ToneSplit({
  brand,
  competitors,
  marketText,
  overviews,
  claims,
  drills
}: {
  brand: string
  competitors: readonly string[]
  marketText: string
  overviews: readonly SentimentOverview[]
  claims: readonly SentimentClaim[]
  drills: SentimentDrills
}): JSX.Element {
  const { open } = useDrill()
  const own = ownClaims(claims)
  const counts = toneCounts(own)
  const buckets = toneBuckets(own)
  const net = netSentiment(counts)
  const shares = mentionShares(overviews, claims, brand, competitors)
  const mentionTotal = shares.reduce((sum, row) => sum + row.mentions, 0)
  const segments = donutSegments(buckets, counts.total)
  const aria = `${counts.positive} positive, ${counts.neutral} neutral, ${counts.negative} negative claims about ${brand}. Net ${formatNet(net)}. Select an arc, or a count below, to list its claims.`
  const toneDrill = (tone: ClaimTone): ItemDrill =>
    drills.claims(
      { id: `claims:tone:${tone}`, title: `${TONE_LABEL[tone]} claims about ${brand}` },
      buckets[tone].claimIds
    )
  const ownDrill = drills.claims(
    {
      id: 'claims:own',
      title: `Claims about ${brand}`,
      description: `Every claim about ${brand} in the latest check. Net sentiment = (positive − negative) ÷ all claims × 100.`
    },
    own.map((claim) => claim.id)
  )
  const shareDrill = (row: (typeof shares)[number]): ItemDrill =>
    drills.overviews(
      {
        id: `overviews:brand:${row.brand}`,
        title: `Overviews that name ${row.brand}`,
        description: `Overviews in the latest check with at least one claim about ${row.brand}.`
      },
      row.overviewIds
    )

  return (
    <div className="st-two">
      <section className="st-card" aria-labelledby="st-tone-h">
        <SectionHead
          id="st-tone-h"
          title="Tone split"
          description={`${marketText} · ${countNoun(counts.total, 'claim', 'claims')} about ${brand}`}
        />
        <div className="st-donut-row">
          <svg width="148" height="148" viewBox="0 0 148 148" role="img" aria-label={aria}>
            <circle cx="74" cy="74" r={RADIUS} className="st-donut-track" />
            {segments.map((segment) => (
              <circle
                key={segment.tone}
                cx="74"
                cy="74"
                r={RADIUS}
                className={`st-donut-${segment.tone} st-donut-hit`}
                strokeDasharray={`${segment.length} ${CIRCUMFERENCE - segment.length}`}
                strokeDashoffset={-segment.offset}
                transform="rotate(-90 74 74)"
                onClick={() => open(toneDrill(segment.tone))}
              >
                <title>{`${countNoun(buckets[segment.tone].count, `${segment.tone} claim`, `${segment.tone} claims`)}`}</title>
              </circle>
            ))}
            <g className="st-donut-hit" onClick={() => open(ownDrill)}>
              <title>{`All ${countNoun(counts.total, 'claim', 'claims')} about ${brand}`}</title>
              <circle cx="74" cy="74" r={RADIUS - 12} className="st-donut-core" />
              <text x="74" y="76" textAnchor="middle" className="st-donut-net">
                {net === null ? '—' : formatNet(net)}
              </text>
              <text x="74" y="96" textAnchor="middle" className="st-donut-label">
                net
              </text>
            </g>
          </svg>
          <ul className="st-legend">
            {TONES.map((tone) => (
              <li key={tone}>
                <span className={`st-swatch st-swatch-${tone}`} aria-hidden="true" />
                <DrillNumber
                  drill={toneDrill(tone)}
                  label={`${buckets[tone].count} ${tone} claims, ${pct(buckets[tone].count, counts.total)}%, show them`}
                />
                <span>{TONE_LABEL[tone]}</span>
                <span className="faint">{pct(buckets[tone].count, counts.total)}%</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="st-note">
          Net = (positive − negative) ÷{' '}
          <DrillNumber
            drill={ownDrill}
            suffix={counts.total === 1 ? ' claim' : ' claims'}
            label={`${countNoun(counts.total, 'claim', 'claims')} about ${brand}, show them`}
          />{' '}
          × 100
        </p>
      </section>
      <section className="st-card" aria-labelledby="st-share-h">
        <SectionHead
          id="st-share-h"
          title="Share of brand mentions"
          description="Overviews that name each brand. One overview can name several."
        />
        {mentionTotal === 0 ? (
          <p className="muted">No overview in this check names a tracked brand.</p>
        ) : (
          <ul className="st-shares">
            {shares.map((row) => {
              const drill = shareDrill(row)
              return (
                <li key={row.brand} className={row.isOwn ? 'st-share st-share-own' : 'st-share'}>
                  <DrillButton
                    drill={drill}
                    untracked
                    label={`Show the overviews that name ${row.brand}`}
                    className="st-drill st-share-name"
                  >
                    {row.brand}
                  </DrillButton>
                  <span className="st-share-bar" aria-hidden="true">
                    <MarkButton
                      drill={drill}
                      style={{ width: `${row.share ?? 0}%` }}
                      title={`${row.brand}: ${countNoun(row.mentions, 'overview', 'overviews')}`}
                    />
                  </span>
                  <DrillNumber
                    drill={drill}
                    label={`${row.brand}: ${pluralize(row.mentions, 'mention')}, ${row.share ?? 0}%, show them`}
                  />
                  <span className="faint st-share-pct">{row.share ?? 0}%</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

/** Arc length and start of each non-empty tone, in legend order. */
function donutSegments(
  buckets: Record<ClaimTone, { count: number }>,
  total: number
): { tone: ClaimTone; length: number; offset: number }[] {
  const segments: { tone: ClaimTone; length: number; offset: number }[] = []
  let offset = 0
  for (const tone of TONES) {
    const length = total === 0 ? 0 : (buckets[tone].count / total) * CIRCUMFERENCE
    if (length > 0) segments.push({ tone, length, offset })
    offset += length
  }
  return segments
}
